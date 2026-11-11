import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { normalizeEmail } from "@/lib/email/audience";
import type { InboundMessage } from "@/lib/email/gmail";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { adminIds, notify } from "@/lib/push";

import { POSITIVE, REPLY_CATEGORIES, REPLY_LABEL, type ReplyCategory } from "@/lib/email/reply-categories";

export { POSITIVE, REPLY_CATEGORIES, REPLY_LABEL };
export type { ReplyCategory };

/** Classifies a reply and drafts a suggested response. The draft is stored for a human to edit — it is never sent automatically. */
export async function classifyText(opts: { subject: string; body: string; company?: string | null; ourSubject?: string }): Promise<{ category: ReplyCategory; summary: string; suggestedReply: string } | { error: string }> {
  const r = await geminiGenerate({
    system: `${GROUNDING_RULES}\nYou triage replies to NAFA Events & Activations outreach emails. Classify honestly; if a reply is ambiguous choose the closest category. A request to stop emails is "unsubscribe". Automatic vacation replies are "out_of_office".`,
    prompt: `Categories: ${REPLY_CATEGORIES.join(", ")}.\nOur email subject: ${opts.ourSubject ?? "(unknown)"}\nCompany: ${opts.company ?? "(unknown)"}\n\nReply subject: ${opts.subject}\nReply text:\n"""${opts.body.slice(0, 3000)}"""\n\nReturn JSON: {"category": one of the categories, "summary": one short sentence, "suggested_reply_html": a short polite reply in HTML (<p>, <br>, <ul>, <li> only) that answers only what was asked, uses only facts from this conversation, promises no prices or dates, and for unsubscribe/out_of_office/not_interested is empty string}`,
    json: true, temperature: 0.3,
  });
  if (!r.ok) return { error: r.error };
  try {
    const j = JSON.parse(r.text) as { category?: string; summary?: string; suggested_reply_html?: string };
    if (!REPLY_CATEGORIES.includes(j.category as ReplyCategory)) return { error: "Unrecognised category from the AI" };
    return { category: j.category as ReplyCategory, summary: String(j.summary ?? "").slice(0, 300), suggestedReply: sanitizeEmailHtml(String(j.suggested_reply_html ?? "")) };
  } catch {
    return { error: "The AI returned an unreadable response" };
  }
}

/** An explicit opt-out request is honoured immediately (compliance): suppress the address and cancel anything still queued. */
export async function applyUnsubscribe(supabase: SupabaseClient, email: string, source: string) {
  const n = normalizeEmail(email);
  await supabase.from("email_suppressions").upsert({ email_normalized: n, email, reason: "unsubscribed", source }, { onConflict: "email_normalized", ignoreDuplicates: true });
  await supabase.from("email_recipients").update({ status: "skipped", skip_reason: "unsubscribed" }).eq("email_normalized", n).in("status", ["pending", "sending"]);
  await supabase.from("contacts").update({ email_status: "unsubscribed" }).eq("email_normalized", n);
}

/** Classifies a stored reply and saves the result. Applies the opt-out if that is what the person asked for. */
export async function classifyStoredReply(supabase: SupabaseClient, replyId: string): Promise<{ ok: true; category: ReplyCategory } | { ok: false; error: string }> {
  const { data: rep } = await supabase.from("email_replies").select("*").eq("id", replyId).maybeSingle();
  if (!rep) return { ok: false, error: "Reply not found." };
  const [{ data: camp }, { data: contact }] = await Promise.all([
    rep.campaign_id ? supabase.from("email_campaigns").select("subject").eq("id", rep.campaign_id).maybeSingle() : Promise.resolve({ data: null }),
    rep.contact_id ? supabase.from("contacts").select("company:companies(name)").eq("id", rep.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const co: any = (contact as any)?.company;
  const c = await classifyText({ subject: rep.subject, body: rep.body_text, company: (Array.isArray(co) ? co[0] : co)?.name, ourSubject: camp?.subject });
  if ("error" in c) return { ok: false, error: c.error };
  await supabase.from("email_replies").update({ category: c.category, summary: c.summary, suggested_reply: c.suggestedReply || null }).eq("id", replyId);
  if (c.category === "unsubscribe") await applyUnsubscribe(supabase, rep.from_email, "reply");
  return { ok: true, category: c.category };
}

/**
 * Stores inbound messages that come from someone we emailed (matched by sender address) and classifies them.
 * Messages from unknown senders are ignored and not stored. Safe to re-run: provider_message_id de-duplicates.
 */
export async function ingestReplies(supabase: SupabaseClient, messages: InboundMessage[], source: "gmail" | "manual") {
  let stored = 0, unmatched = 0, classified = 0;
  for (const m of messages) {
    const n = normalizeEmail(m.fromEmail);
    const { data: rcpt } = await supabase.from("email_recipients").select("id, campaign_id, contact_id").eq("email_normalized", n).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (!rcpt) { unmatched++; continue; }
    const { data: ins } = await supabase.from("email_replies").upsert(
      { campaign_id: rcpt.campaign_id, recipient_id: rcpt.id, contact_id: rcpt.contact_id, from_email: m.fromEmail, from_normalized: n, subject: m.subject, body_text: m.text, received_at: m.receivedAt, source, provider_message_id: source === "gmail" ? m.id : null },
      { onConflict: "provider_message_id", ignoreDuplicates: true },
    ).select("id");
    if (!ins?.length) continue;
    stored++;
    const c = await classifyStoredReply(supabase, ins[0].id);
    if (c.ok) classified++;
    if (source === "gmail") {
      const [{ data: camp }, { data: rp }] = await Promise.all([
        rcpt.campaign_id ? supabase.from("email_campaigns").select("name, created_by").eq("id", rcpt.campaign_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("email_recipients").select("full_name").eq("id", rcpt.id).maybeSingle(),
      ]);
      const label = c.ok ? REPLY_LABEL[c.category] : "New reply";
      const who = [...new Set([...(camp?.created_by ? [camp.created_by] : []), ...(await adminIds())])];
      await notify(who, { type: "email_reply", title: `${label}: reply from ${rp?.full_name || m.fromEmail}`, body: camp?.name ? `Campaign: ${camp.name}` : m.subject, url: "/email-marketing/replies", tag: `reply-${rcpt.id}` });
    }
  }
  return { stored, unmatched, classified };
}
