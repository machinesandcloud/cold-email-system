import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventType, MessageStatus } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { config } from "./lib/config.js";
import { requireAdmin } from "./lib/auth.js";
import { dispatchEligibleMessages } from "./lib/dispatch.js";
import { sendQueue } from "./lib/queue.js";
import { verifyUnsubscribeToken } from "./lib/tokens.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp());
app.use(express.static(path.join(__dirname, "../public")));

const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60 });
app.use("/track", publicLimiter);
app.use("/u", publicLimiter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/webhooks/mailgun", async (req, res) => {
  if (config.mailgunWebhookSigningKey) {
    const timestamp = req.body?.signature?.timestamp;
    const token = req.body?.signature?.token;
    const signature = req.body?.signature?.signature;
    if (!timestamp || !token || !signature) {
      res.status(400).json({ error: "missing-signature" });
      return;
    }
    const hmac = crypto.createHmac("sha256", config.mailgunWebhookSigningKey);
    hmac.update(timestamp + token);
    const digest = hmac.digest("hex");
    if (digest !== signature) {
      res.status(401).json({ error: "invalid-signature" });
      return;
    }
  }

  const event = req.body?.["event-data"];
  if (!event) {
    res.status(400).json({ error: "missing-event" });
    return;
  }

  const recipient = event.recipient as string | undefined;
  const messageId = event.message?.headers?.["message-id"] as string | undefined;
  const eventType = event.event as string | undefined;

  if (recipient && eventType) {
    if (eventType === "bounced" || eventType === "complained") {
      await prisma.suppression.upsert({
        where: { email: recipient },
        update: { reason: eventType },
        create: { email: recipient, reason: eventType }
      });
    }
  }

  if (messageId && eventType) {
    const message = await prisma.message.findFirst({
      where: { providerMessageId: messageId }
    });

    if (message) {
      await prisma.event.create({
        data: {
          messageId: message.id,
          type: eventType === "opened" ? "opened" : eventType === "clicked" ? "clicked" : eventType === "bounced" ? "bounced" : "delivered",
          payload: event
        }
      });

      if (eventType === "bounced") {
        await prisma.message.update({
          where: { id: message.id },
          data: { status: "bounced" }
        });
      }
    }
  }

  res.json({ ok: true });
});

app.get("/track/open/:token.png", async (req, res) => {
  const token = req.params.token;
  const message = await prisma.message.findUnique({ where: { trackingToken: token } });
  if (message) {
    await prisma.event.create({
      data: {
        messageId: message.id,
        type: "opened"
      }
    });
  }
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAFqS8XoAAAAASUVORK5CYII=",
    "base64"
  );
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(pixel);
});

app.get("/track/click/:token", async (req, res) => {
  const token = req.params.token;
  const url = req.query.u as string | undefined;
  const message = await prisma.message.findUnique({ where: { trackingToken: token } });
  if (message) {
    await prisma.event.create({
      data: {
        messageId: message.id,
        type: "clicked",
        url: url ? decodeURIComponent(url) : null
      }
    });
  }
  if (!url) {
    res.status(400).send("Missing url");
    return;
  }
  res.redirect(decodeURIComponent(url));
});

app.get("/u/:token", async (req, res) => {
  const token = req.params.token;
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    res.status(400).send("Invalid unsubscribe token");
    return;
  }
  await prisma.unsubscribe.upsert({
    where: { email },
    update: {},
    create: { email }
  });
  res.send("You have been unsubscribed.");
});

app.use("/admin", requireAdmin);

const paginationSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(500).default(50)
});

const domainSchema = z.object({
  domain: z.string().min(3),
  dailyLimit: z.number().int().positive().optional(),
  warmupEnabled: z.boolean().optional(),
  warmupStartPerDay: z.number().int().positive().optional(),
  warmupStepPerDay: z.number().int().positive().optional(),
  warmupMaxPerDay: z.number().int().positive().optional()
});

app.post("/admin/domains", async (req, res) => {
  const parsed = domainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const domain = await prisma.domainConfig.upsert({
    where: { domain: parsed.data.domain },
    update: parsed.data,
    create: parsed.data
  });
  res.json(domain);
});

app.get("/admin/domains", async (_req, res) => {
  const domains = await prisma.domainConfig.findMany();
  res.json(domains);
});

app.patch("/admin/domains/:id", async (req, res) => {
  const parsed = domainSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const domain = await prisma.domainConfig.update({
    where: { id: req.params.id },
    data: parsed.data
  });
  res.json(domain);
});

const mailboxSchema = z.object({
  name: z.string().min(2),
  domain: z.string().min(3),
  apiKey: z.string().min(5),
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional(),
  dailyLimit: z.number().int().positive().optional(),
  warmupEnabled: z.boolean().optional(),
  warmupStartPerDay: z.number().int().positive().optional(),
  warmupStepPerDay: z.number().int().positive().optional(),
  warmupMaxPerDay: z.number().int().positive().optional()
});

app.post("/admin/mailboxes", async (req, res) => {
  const parsed = mailboxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }

  const domain = await prisma.domainConfig.upsert({
    where: { domain: parsed.data.domain },
    update: {},
    create: { domain: parsed.data.domain }
  });

  const mailbox = await prisma.mailbox.create({
    data: {
      name: parsed.data.name,
      apiKey: parsed.data.apiKey,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo,
      domainId: domain.id,
      dailyLimit: parsed.data.dailyLimit,
      warmupEnabled: parsed.data.warmupEnabled,
      warmupStartPerDay: parsed.data.warmupStartPerDay,
      warmupStepPerDay: parsed.data.warmupStepPerDay,
      warmupMaxPerDay: parsed.data.warmupMaxPerDay
    }
  });

  res.json(mailbox);
});

app.get("/admin/mailboxes", async (_req, res) => {
  const mailboxes = await prisma.mailbox.findMany({ include: { domain: true } });
  res.json(mailboxes);
});

app.patch("/admin/mailboxes/:id", async (req, res) => {
  const parsed = mailboxSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  let domainId: string | undefined;
  if (parsed.data.domain) {
    const domain = await prisma.domainConfig.upsert({
      where: { domain: parsed.data.domain },
      update: {},
      create: { domain: parsed.data.domain }
    });
    domainId = domain.id;
  }
  const mailbox = await prisma.mailbox.update({
    where: { id: req.params.id },
    data: {
      name: parsed.data.name,
      apiKey: parsed.data.apiKey,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo,
      dailyLimit: parsed.data.dailyLimit,
      warmupEnabled: parsed.data.warmupEnabled,
      warmupStartPerDay: parsed.data.warmupStartPerDay,
      warmupStepPerDay: parsed.data.warmupStepPerDay,
      warmupMaxPerDay: parsed.data.warmupMaxPerDay,
      domainId
    }
  });
  res.json(mailbox);
});

const contactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  timezone: z.string().optional(),
  optedIn: z.boolean().optional()
});

app.post("/admin/contacts", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const contact = await prisma.contact.upsert({
    where: { email: parsed.data.email },
    update: parsed.data,
    create: parsed.data
  });
  res.json(contact);
});

app.get("/admin/contacts", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const contacts = await prisma.contact.findMany({
    skip: parsed.data.skip,
    take: parsed.data.take,
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" }
  });
  res.json(contacts);
});

app.patch("/admin/contacts/:id", async (req, res) => {
  const parsed = contactSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const contact = await prisma.contact.update({
    where: { id: req.params.id },
    data: parsed.data
  });
  res.json(contact);
});

app.post("/admin/contacts/import", async (req, res) => {
  const csvText = req.body?.csv as string | undefined;
  const listId = req.body?.listId as string | undefined;
  if (!csvText) {
    res.status(400).json({ error: "missing csv" });
    return;
  }
  const records = parse(csvText, { columns: true, skip_empty_lines: true });
  let imported = 0;
  for (const record of records) {
    if (!record.email) continue;
    const contact = await prisma.contact.upsert({
      where: { email: record.email },
      update: {
        firstName: record.firstName || record.first_name,
        lastName: record.lastName || record.last_name,
        company: record.company,
        timezone: record.timezone,
        optedIn: record.optedIn ? record.optedIn === "true" : true
      },
      create: {
        email: record.email,
        firstName: record.firstName || record.first_name,
        lastName: record.lastName || record.last_name,
        company: record.company,
        timezone: record.timezone,
        optedIn: record.optedIn ? record.optedIn === "true" : true
      }
    });
    if (listId) {
      await prisma.listMember.upsert({
        where: { listId_contactId: { listId, contactId: contact.id } },
        update: {},
        create: { listId, contactId: contact.id }
      });
    }
    imported += 1;
  }
  res.json({ imported });
});

const listSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional()
});

app.post("/admin/lists", async (req, res) => {
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const list = await prisma.contactList.create({ data: parsed.data });
  res.json(list);
});

app.get("/admin/lists", async (_req, res) => {
  const lists = await prisma.contactList.findMany({ include: { members: true } });
  res.json(lists);
});

app.post("/admin/lists/:id/members", async (req, res) => {
  const listId = req.params.id;
  const contactIds = z.array(z.string()).safeParse(req.body?.contactIds);
  if (!contactIds.success) {
    res.status(400).json({ error: "contactIds must be string[]" });
    return;
  }
  for (const contactId of contactIds.data) {
    await prisma.listMember.upsert({
      where: { listId_contactId: { listId, contactId } },
      update: {},
      create: { listId, contactId }
    });
  }
  res.json({ added: contactIds.data.length });
});

app.get("/admin/lists/:id/members", async (req, res) => {
  const members = await prisma.listMember.findMany({
    where: { listId: req.params.id },
    include: { contact: true }
  });
  res.json(members);
});

const sequenceSchema = z.object({
  name: z.string().min(2),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  timezonePolicy: z.string().optional(),
  sendWindowStart: z.string().optional(),
  sendWindowEnd: z.string().optional(),
  daysBetween: z.number().int().min(0).optional()
});

app.post("/admin/sequences", async (req, res) => {
  const parsed = sequenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const sequence = await prisma.sequence.create({ data: parsed.data });
  res.json(sequence);
});

app.get("/admin/sequences", async (_req, res) => {
  const sequences = await prisma.sequence.findMany({ include: { steps: true } });
  res.json(sequences);
});

app.patch("/admin/sequences/:id", async (req, res) => {
  const parsed = sequenceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const sequence = await prisma.sequence.update({
    where: { id: req.params.id },
    data: parsed.data
  });
  res.json(sequence);
});

const stepSchema = z.object({
  stepNumber: z.number().int().positive(),
  subjectTemplate: z.string().min(1),
  bodyTemplate: z.string().min(1),
  delayDays: z.number().int().min(0).optional()
});

app.post("/admin/sequences/:id/steps", async (req, res) => {
  const sequenceId = req.params.id;
  const parsed = stepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const step = await prisma.sequenceStep.upsert({
    where: { sequenceId_stepNumber: { sequenceId, stepNumber: parsed.data.stepNumber } },
    update: parsed.data,
    create: { ...parsed.data, sequenceId }
  });
  res.json(step);
});

const enrollSchema = z.object({
  sequenceId: z.string().min(1),
  contactId: z.string().min(1)
});

app.post("/admin/enrollments", async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const enrollment = await prisma.enrollment.upsert({
    where: { sequenceId_contactId: parsed.data },
    update: { status: "active" },
    create: parsed.data
  });
  res.json(enrollment);
});

app.get("/admin/enrollments", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const enrollments = await prisma.enrollment.findMany({
    skip: parsed.data.skip,
    take: parsed.data.take,
    include: { contact: true, sequence: true },
    where: q
      ? {
          OR: [
            { contact: { email: { contains: q, mode: "insensitive" } } },
            { sequence: { name: { contains: q, mode: "insensitive" } } }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" }
  });
  res.json(enrollments);
});

app.patch("/admin/enrollments/:id", async (req, res) => {
  const parsed = z
    .object({
      status: z.enum(["active", "paused", "completed", "stopped"]).optional(),
      nextSendAt: z.coerce.date().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const enrollment = await prisma.enrollment.update({
    where: { id: req.params.id },
    data: parsed.data
  });
  res.json(enrollment);
});

app.post("/admin/dispatch", async (_req, res) => {
  const result = await dispatchEligibleMessages();
  for (const messageId of result.messageIds) {
    await sendQueue.add("send", { messageId }, { jobId: messageId });
  }
  res.json(result);
});

app.get("/admin/messages", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
  const status = Object.values(MessageStatus).includes(statusRaw as MessageStatus)
    ? (statusRaw as MessageStatus)
    : undefined;
  const mailboxId = typeof req.query.mailboxId === "string" ? req.query.mailboxId : "";
  const sequenceId = typeof req.query.sequenceId === "string" ? req.query.sequenceId : "";
  const messages = await prisma.message.findMany({
    skip: parsed.data.skip,
    take: parsed.data.take,
    include: { mailbox: true, enrollment: { include: { sequence: true, contact: true } } },
    where: {
      ...(q
        ? {
            OR: [
              { toEmail: { contains: q, mode: "insensitive" } },
              { subject: { contains: q, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(status ? { status } : {}),
      ...(mailboxId ? { mailboxId } : {}),
      ...(sequenceId ? { enrollment: { sequenceId } } : {})
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(messages);
});

app.get("/admin/messages/:id", async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: req.params.id },
    include: {
      mailbox: true,
      enrollment: { include: { contact: true, sequence: true } },
      events: { orderBy: { occurredAt: "desc" } }
    }
  });
  if (!message) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json(message);
});

app.get("/admin/events", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const typeRaw = typeof req.query.type === "string" ? req.query.type : "";
  const type = Object.values(EventType).includes(typeRaw as EventType)
    ? (typeRaw as EventType)
    : undefined;
  const events = await prisma.event.findMany({
    skip: parsed.data.skip,
    take: parsed.data.take,
    include: { message: true },
    where: type ? { type } : undefined,
    orderBy: { occurredAt: "desc" }
  });
  res.json(events);
});

function escapeCsvValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(rows: Record<string, string | number | boolean | null | undefined>[], headers: string[]) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(","));
  }
  return lines.join("\n");
}

app.get("/admin/contacts/export", async (_req, res) => {
  const contacts = await prisma.contact.findMany({ orderBy: { createdAt: "desc" } });
  const headers = ["email", "firstName", "lastName", "company", "timezone", "optedIn", "createdAt"];
  const csv = toCsv(
    contacts.map((c) => ({
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      timezone: c.timezone,
      optedIn: c.optedIn,
      createdAt: c.createdAt.toISOString()
    })),
    headers
  );
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
});

app.get("/admin/messages/export", async (_req, res) => {
  const messages = await prisma.message.findMany({ orderBy: { createdAt: "desc" } });
  const headers = ["toEmail", "subject", "status", "sentAt", "createdAt"];
  const csv = toCsv(
    messages.map((m) => ({
      toEmail: m.toEmail,
      subject: m.subject,
      status: m.status,
      sentAt: m.sentAt ? m.sentAt.toISOString() : "",
      createdAt: m.createdAt.toISOString()
    })),
    headers
  );
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
});

app.get("/admin/events/export", async (_req, res) => {
  const events = await prisma.event.findMany({ orderBy: { occurredAt: "desc" } });
  const headers = ["type", "messageId", "url", "occurredAt"];
  const csv = toCsv(
    events.map((e) => ({
      type: e.type,
      messageId: e.messageId,
      url: e.url,
      occurredAt: e.occurredAt.toISOString()
    })),
    headers
  );
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
});

app.get("/admin/suppressions", async (_req, res) => {
  const suppressions = await prisma.suppression.findMany({ orderBy: { createdAt: "desc" } });
  res.json(suppressions);
});

app.get("/admin/unsubscribes", async (_req, res) => {
  const unsub = await prisma.unsubscribe.findMany({ orderBy: { createdAt: "desc" } });
  res.json(unsub);
});

app.get("/admin/stats", async (_req, res) => {
  const [contacts, sequences, messages] = await Promise.all([
    prisma.contact.count(),
    prisma.sequence.count(),
    prisma.message.count()
  ]);
  res.json({ contacts, sequences, messages });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
