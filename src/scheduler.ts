import { dispatchEligibleMessages } from "./lib/dispatch.js";
import { sendQueue } from "./lib/queue.js";

let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    const result = await dispatchEligibleMessages();
    for (const messageId of result.messageIds) {
      await sendQueue.add("send", { messageId }, { jobId: messageId });
    }
    console.log(`[scheduler] queued ${result.queued}`);
  } catch (error) {
    console.error("[scheduler] failed", error);
  } finally {
    running = false;
  }
}

await runOnce();
const intervalMs = 60 * 1000;
const timer = setInterval(runOnce, intervalMs);

process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
