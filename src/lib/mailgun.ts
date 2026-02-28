import type { DomainConfig, Mailbox } from "@prisma/client";
import { config } from "./config.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  unsubscribeUrl: string;
};

export async function sendWithMailgun(
  mailbox: Mailbox & { domain: DomainConfig },
  input: SendEmailInput
) {
  const url = `https://api.mailgun.net/v3/${mailbox.domain.domain}/messages`;
  const params = new URLSearchParams();

  const fromValue = `${mailbox.fromName} <${mailbox.fromEmail}>`;
  params.set("from", fromValue);
  params.set("to", input.to);
  params.set("subject", input.subject);
  params.set("html", input.html);
  if (input.text) params.set("text", input.text);

  params.set("h:List-Unsubscribe", `<${input.unsubscribeUrl}>`);
  params.set("h:List-Unsubscribe-Post", "List-Unsubscribe=One-Click");

  if (mailbox.replyTo) {
    params.set("h:Reply-To", mailbox.replyTo);
  }

  const auth = Buffer.from(`api:${mailbox.apiKey}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mailgun error: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as { id?: string; message?: string };
  return payload;
}

export function makeUnsubscribeUrl(token: string) {
  return `${config.publicBaseUrl}/u/${token}`;
}
