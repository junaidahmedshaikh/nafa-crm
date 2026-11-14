/**
 * Email delivery is optional and off until configured. Phase 2 uses the Resend HTTP API (no SDK needed).
 *   RESEND_API_KEY  – API key from resend.com (server-side secret, never NEXT_PUBLIC_)
 *   EMAIL_FROM      – verified sender, e.g. "NAFA Events <contact@nafaevents.in>"
 * A message is only recorded as "sent" when Resend accepts it and returns a message id.
 */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/** `temporary` = worth retrying later (rate limit, provider outage, network). */
export type EmailResult = { ok: true; providerId: string } | { ok: false; error: string; temporary?: boolean };

export async function sendEmailWithPdf(opts: {
  to: string; cc?: string[]; bcc?: string[]; subject: string; text: string;
  /** Optional PDF attachment. */
  filename?: string; pdf?: Buffer;
  /** Same key => the provider sends at most once, so a double submit or a retry cannot deliver the email twice. */
  idempotencyKey?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "Email is not configured (set RESEND_API_KEY and EMAIL_FROM)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from, to: [opts.to], subject: opts.subject, text: opts.text,
        ...(opts.cc?.length ? { cc: opts.cc } : {}),
        ...(opts.bcc?.length ? { bcc: opts.bcc } : {}),
        ...(opts.pdf && opts.filename ? { attachments: [{ filename: opts.filename, content: opts.pdf.toString("base64") }] } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) return { ok: false, error: body.message ?? `Email provider returned ${res.status}`, ...(res.status === 429 || res.status >= 500 ? { temporary: true } : {}) };
    return { ok: true, providerId: body.id };
  } catch (e) {
    return { ok: false, temporary: true, error: `Could not reach the email provider: ${(e as Error).message}` };
  }
}
