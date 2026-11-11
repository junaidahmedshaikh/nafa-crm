import { emailConfigured } from "@/lib/documents/email";

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string; temporary: boolean };

/**
 * Sends one email through Resend (server-side only; the API key never leaves the server).
 * The Idempotency-Key makes a retry of the same recipient safe: the provider will not send it twice.
 * Includes List-Unsubscribe headers so mail clients can offer one-click unsubscribe.
 */
export async function sendMarketingEmail(opts: {
  from: string; to: string; replyTo?: string; subject: string; html: string; text: string;
  idempotencyKey: string; unsubscribeUrl: string;
}): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, temporary: false, error: "Email is not configured (set RESEND_API_KEY)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": opts.idempotencyKey },
      body: JSON.stringify({
        from: opts.from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        headers: { "List-Unsubscribe": `<${opts.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && body.id) return { ok: true, providerId: body.id };
    const temporary = res.status === 429 || res.status >= 500;
    return { ok: false, temporary, error: body.message ?? `Email provider returned ${res.status}` };
  } catch (e) {
    return { ok: false, temporary: true, error: `Could not reach the email provider: ${(e as Error).message}` };
  }
}

export const formatFrom = (name: string, email: string) => (name.trim() ? `${name.replace(/["<>]/g, "")} <${email}>` : email);
