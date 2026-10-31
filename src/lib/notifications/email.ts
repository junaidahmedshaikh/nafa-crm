import { emailConfigured } from "@/lib/documents/email";

/** Plain-text alert email through Resend (the provider already used for quotation/invoice emails). */
export async function sendAlertEmail(opts: { to: string[]; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured()) return { ok: false, error: "Email is not configured (set RESEND_API_KEY and EMAIL_FROM)." };
  if (!opts.to.length) return { ok: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: opts.to, subject: opts.subject, text: opts.text }),
    });
    if (!res.ok) return { ok: false, error: `Email provider returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
