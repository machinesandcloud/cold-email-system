import { nanoid } from "nanoid";
import { prisma } from "./prisma.js";
import { renderTemplate } from "./templates.js";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function computeWarmupLimit(
  dailyLimit: number,
  warmupEnabled: boolean,
  warmupStartPerDay: number,
  warmupStepPerDay: number,
  warmupMaxPerDay: number,
  warmupStartedAt: Date
) {
  if (!warmupEnabled) return dailyLimit;
  const days = Math.max(0, Math.floor((Date.now() - warmupStartedAt.getTime()) / (24 * 60 * 60 * 1000)));
  const warmupLimit = warmupStartPerDay + days * warmupStepPerDay;
  return Math.min(dailyLimit, warmupMaxPerDay, warmupLimit);
}

function getLocalMinutes(now: Date, timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function inSendWindow(now: Date, start: string, end: string, timeZone: string) {
  const [startH, startM] = start.split(":").map((v) => Number(v));
  const [endH, endM] = end.split(":").map((v) => Number(v));
  if (Number.isNaN(startH) || Number.isNaN(endH)) return true;
  const localMinutes = getLocalMinutes(now, timeZone);
  if (localMinutes === null) return true;
  const currentMinutes = localMinutes;
  const startMinutes = startH * 60 + (startM || 0);
  const endMinutes = endH * 60 + (endM || 0);
  if (endMinutes >= startMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export async function dispatchEligibleMessages(limit = 500) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const mailboxes = await prisma.mailbox.findMany({
    where: { active: true },
    include: { domain: true }
  });

  if (mailboxes.length === 0) {
    return { queued: 0, reason: "no-mailboxes" };
  }

  const mailboxState = new Map<string, { sent: number; limit: number; domainId: string }>();
  const domainState = new Map<string, { sent: number; limit: number }>();

  for (const mailbox of mailboxes) {
    const sentToday = await prisma.message.count({
      where: {
        mailboxId: mailbox.id,
        sentAt: {
          gte: todayStart,
          lte: todayEnd
        }
      }
    });

    const mailboxLimit = computeWarmupLimit(
      mailbox.dailyLimit,
      mailbox.warmupEnabled,
      mailbox.warmupStartPerDay,
      mailbox.warmupStepPerDay,
      mailbox.warmupMaxPerDay,
      mailbox.warmupStartedAt
    );

    mailboxState.set(mailbox.id, {
      sent: sentToday,
      limit: mailboxLimit,
      domainId: mailbox.domainId
    });

    if (!domainState.has(mailbox.domainId)) {
      const domainLimit = computeWarmupLimit(
        mailbox.domain.dailyLimit,
        mailbox.domain.warmupEnabled,
        mailbox.domain.warmupStartPerDay,
        mailbox.domain.warmupStepPerDay,
        mailbox.domain.warmupMaxPerDay,
        mailbox.domain.warmupStartedAt
      );

      domainState.set(mailbox.domainId, { sent: 0, limit: domainLimit });
    }
  }

  for (const mailbox of mailboxes) {
    const state = domainState.get(mailbox.domainId);
    if (!state) continue;
    const count = mailboxState.get(mailbox.id)?.sent ?? 0;
    state.sent += count;
  }

  const enrollments = await prisma.enrollment.findMany({
    where: {
      status: "active",
      OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
      sequence: { status: "active" }
    },
    include: {
      sequence: { include: { steps: true } },
      contact: true
    },
    take: limit
  });

  let queued = 0;
  const messageIds: string[] = [];
  let mailboxIndex = 0;

  for (const enrollment of enrollments) {
    const contact = enrollment.contact;

    const unsub = await prisma.unsubscribe.findUnique({ where: { email: contact.email } });
    const suppressed = await prisma.suppression.findUnique({ where: { email: contact.email } });
    if (!contact.optedIn || unsub || suppressed) {
      continue;
    }

    const pending = await prisma.message.findFirst({
      where: {
        enrollmentId: enrollment.id,
        status: { in: ["queued", "sending"] }
      }
    });
    if (pending) continue;

    const step = enrollment.sequence.steps.find((s) => s.stepNumber === enrollment.currentStep);
    if (!step) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "completed" }
      });
      continue;
    }

    const timeZone =
      enrollment.sequence.timezonePolicy === "utc"
        ? "UTC"
        : contact.timezone || "UTC";

    if (
      !inSendWindow(
        now,
        enrollment.sequence.sendWindowStart,
        enrollment.sequence.sendWindowEnd,
        timeZone
      )
    ) {
      continue;
    }

    let attempts = 0;
    let selectedMailbox = null as typeof mailboxes[number] | null;

    while (attempts < mailboxes.length) {
      const mailbox = mailboxes[mailboxIndex % mailboxes.length];
      mailboxIndex += 1;
      attempts += 1;

      const mailboxInfo = mailboxState.get(mailbox.id);
      const domainInfo = domainState.get(mailbox.domainId);
      if (!mailboxInfo || !domainInfo) continue;

      if (mailboxInfo.sent >= mailboxInfo.limit) continue;
      if (domainInfo.sent >= domainInfo.limit) continue;

      selectedMailbox = mailbox;
      mailboxInfo.sent += 1;
      domainInfo.sent += 1;
      break;
    }

    if (!selectedMailbox) {
      break;
    }

    const subject = renderTemplate(step.subjectTemplate, contact);
    const body = renderTemplate(step.bodyTemplate, contact);
    const trackingToken = nanoid(24);

    const message = await prisma.message.create({
      data: {
        enrollmentId: enrollment.id,
        mailboxId: selectedMailbox.id,
        toEmail: contact.email,
        subject,
        bodyHtml: body,
        trackingToken,
        scheduledAt: now
      }
    });
    messageIds.push(message.id);

    const nextStep = enrollment.currentStep + 1;
    const delayDays = step.delayDays + enrollment.sequence.daysBetween;
    const nextSendAt = new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000);

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { currentStep: nextStep, nextSendAt }
    });

    queued += 1;
  }

  return { queued, messageIds };
}
