import crypto from "node:crypto";
import { config } from "./config.js";

export function createUnsubscribeToken(email: string) {
  const hmac = crypto.createHmac("sha256", config.unsubscribeSecret || "dev");
  hmac.update(email);
  const signature = hmac.digest("hex");
  return Buffer.from(`${email}.${signature}`).toString("base64url");
}

export function verifyUnsubscribeToken(token: string) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [email, signature] = decoded.split(".");
    if (!email || !signature) return null;
    const expected = crypto
      .createHmac("sha256", config.unsubscribeSecret || "dev")
      .update(email)
      .digest("hex");
    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return email;
    }
    return null;
  } catch {
    return null;
  }
}
