import { Worker } from "bullmq";
import { prisma } from "./lib/prisma.js";
import { config } from "./lib/config.js";
import { sendWithMailgun, makeUnsubscribeUrl } from "./lib/mailgun.js";
import { injectOpenPixel, trackLinks } from "./lib/templates.js";
import { createUnsubscribeToken } from "./lib/tokens.js";

const worker = new Worker(
  "send-email",
  async (job) => {
    const messageId = job.data.messageId as string;
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        mailbox: { include: { domain: true } },
        enrollment: { include: { contact: true, sequence: true } }
      }
    });

    if (!message || message.status === "sent") {
      return;
    }

    await prisma.message.update({
      where: { id: message.id },
      data: { status: "sending" }
    });

    const contact = message.enrollment.contact;
    const mailbox = message.mailbox;
    const domainName = mailbox.domain.domain;

    const unsubscribeToken = createUnsubscribeToken(contact.email);
    const unsubscribeUrl = makeUnsubscribeUrl(unsubscribeToken);

    const openPixelUrl = `${config.publicBaseUrl}/track/open/${message.trackingToken}.png`;
    const clickBaseUrl = `${config.publicBaseUrl}/track/click/${message.trackingToken}`;

    const htmlWithTracking = injectOpenPixel(
      trackLinks(message.bodyHtml, clickBaseUrl),
      openPixelUrl
    );

    try {
      const result = await sendWithMailgun(mailbox, {
        to: message.toEmail,
        subject: message.subject,
        html: htmlWithTracking,
        unsubscribeUrl
      });

      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: result.id || null
        }
      });
    } catch (error) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "failed" }
      });
      throw error;
    }
  },
  {
    connection: { url: config.redisUrl }
  }
);

worker.on("failed", (job, err) => {
  if (!job) return;
  console.error("Job failed", job.id, err);
});
