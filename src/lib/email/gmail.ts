/**
 * Read-only Gmail access for reply monitoring (server-side only). Configure with a Google Cloud OAuth client and a refresh
 * token for the mailbox that receives replies (the campaign Reply-To address), scope https://www.googleapis.com/auth/gmail.readonly:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 * This never sends mail and never modifies the mailbox.
 */
export const gmailConfigured = () => !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);

export type InboundMessage = { id: string; fromEmail: string; subject: string; text: string; receivedAt: string };

async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!, client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Gmail authorisation failed (${body.error ?? res.status}). Re-create the refresh token.`);
  return body.access_token;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
const b64 = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function plainText(p: Part): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) { const t = plainText(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return b64(p.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}

/** Drops the quoted original ("On … wrote:", "> …") so only the person's new text is kept. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From:\s.+/i.test(l.trim()) && out.length > 2) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim().slice(0, 4000);
}

export function parseFromHeader(h: string): string {
  const m = /<([^>]+)>/.exec(h);
  return (m ? m[1] : h).trim().toLowerCase();
}

/** Inbox messages from the last `days` days, excluding the mailbox's own sent mail. */
export async function fetchRecentInbound(days = 7, max = 50): Promise<InboundMessage[]> {
  const token = await accessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: `in:inbox newer_than:${days}d -from:me`, maxResults: String(max) })}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (!list.ok) throw new Error(`Gmail returned ${list.status} while listing messages.`);
  const ids = ((await list.json()) as { messages?: { id: string }[] }).messages ?? [];
  const out: InboundMessage[] = [];
  for (const { id } of ids) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    const m = (await res.json()) as { internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } };
    const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    out.push({ id, fromEmail: parseFromHeader(h("from")), subject: h("subject").slice(0, 300), text: stripQuoted(plainText(m.payload ?? {})), receivedAt: new Date(Number(m.internalDate) || Date.now()).toISOString() });
  }
  return out;
}
