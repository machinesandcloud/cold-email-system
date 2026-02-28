import { dispatchEligibleMessages } from "./lib/dispatch.js";
import { sendQueue } from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";

const result = await dispatchEligibleMessages();

for (const messageId of result.messageIds) {
  await sendQueue.add("send", { messageId }, { jobId: messageId });
}

console.log(`Queued ${result.queued} messages.`);
await prisma.$disconnect();
process.exit(0);
