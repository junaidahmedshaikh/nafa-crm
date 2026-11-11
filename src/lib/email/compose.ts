import { htmlToText, renderTemplate, recipientVars, type RecipientFacts, type Vars } from "@/lib/email/personalize";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";

export type CampaignContent = {
  subject: string;
  bodyHtml: string;
  fallbacks: Record<string, string>;
  salespersonName: string;
  senderName: string;
};
export type SendSettings = { postalAddress: string; signatureHtml: string };

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://nafa-crm.vercel.app").replace(/\/$/, "");
export const unsubscribeUrl = (token: string) => `${appUrl()}/unsubscribe/${token}`;
export const unsubscribeApiUrl = (token: string) => `${appUrl()}/api/unsubscribe/${token}`;

export type Composed = { subject: string; html: string; text: string; missing: string[]; unsubscribeUrl: string; unsubscribeApiUrl: string };

/**
 * Builds the exact message a recipient receives: personalised subject/body, signature, postal address and unsubscribe link.
 * `missing` lists placeholders that could not be resolved — such a message must not be sent.
 */
export function composeEmail(c: CampaignContent, s: SendSettings, r: RecipientFacts, token: string, custom: Vars = {}): Composed {
  const vars = recipientVars(r, { salespersonName: c.salespersonName, senderName: c.senderName }, custom);
  const subject = renderTemplate(c.subject, vars, c.fallbacks);
  const body = renderTemplate(sanitizeEmailHtml(c.bodyHtml), vars, c.fallbacks, { escape: true });
  const sig = renderTemplate(sanitizeEmailHtml(s.signatureHtml), vars, c.fallbacks, { escape: true });
  const unsub = unsubscribeUrl(token);
  const address = s.postalAddress.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const footer = `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px"><p style="font-size:12px;line-height:1.5;color:#777">${address}<br>You are receiving this business email from NAFA Events &amp; Activations. If you do not wish to receive further emails, <a href="${unsub}">unsubscribe here</a>.</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:640px">${body.text}${sig.text}${footer}</div>`;
  const text = `${htmlToText(body.text)}\n\n${htmlToText(sig.text)}\n\n--\n${s.postalAddress.trim()}\nUnsubscribe: ${unsub}`;
  return { subject: subject.text.replace(/\s+/g, " ").trim(), html, text, missing: [...new Set([...subject.missing, ...body.missing, ...sig.missing])], unsubscribeUrl: unsub, unsubscribeApiUrl: unsubscribeApiUrl(token) };
}
