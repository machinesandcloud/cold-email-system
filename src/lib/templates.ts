import type { Contact } from "@prisma/client";

export function renderTemplate(template: string, contact: Contact) {
  const tokens: Record<string, string> = {
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    company: contact.company || "",
    email: contact.email
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    return tokens[key] ?? "";
  });
}

export function injectOpenPixel(html: string, pixelUrl: string) {
  return `${html}\n<img src=\"${pixelUrl}\" width=\"1\" height=\"1\" style=\"display:none\" alt=\"\" />`;
}

export function trackLinks(html: string, clickBaseUrl: string) {
  return html.replace(/href=\"(https?:\/\/[^\"]+)\"/gi, (match, url) => {
    const encoded = encodeURIComponent(url);
    return `href=\"${clickBaseUrl}?u=${encoded}\"`;
  });
}
