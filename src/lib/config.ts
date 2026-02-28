export const config = {
  adminToken: process.env.ADMIN_TOKEN || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  mailgunWebhookSigningKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY || "",
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || "",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379"
};
