import type { SupabaseClient } from "@supabase/supabase-js";
import { circuitBreaker, nextBatchSize, type SendOutcome } from "./limits";
import type { WhatsAppProvider } from "./provider";

export type WaSettings = {
  mode: "dry_run" | "live";
  daily_limit: number;
  batch_size: number;
  send_gap_ms: number;
  repeat_window_days: number;
  cost_per_message: number | null;
};

export type BatchResult = {
  state: "sent_batch" | "completed" | "paused" | "idle" | "missing";
  sent: number;
  failed: number;
  skipped: number;
  /** Messages still waiting after this batch. */
  queued: number;
  message?: string;
};

type MessageRow = { id: string; contact_id: string; to_phone: string; body: string; params: string[] };

const none = (state: BatchResult["state"], queued = 0, message?: string): BatchResult => ({ state, sent: 0, failed: 0, skipped: 0, queued, message });

/**
 * Sends one safe batch of a campaign:
 *  - respects the rolling 24-hour limit across ALL campaigns,
 *  - claims messages atomically, so a second browser tab can never send the same one,
 *  - re-checks consent at the moment of sending (someone may have opted out since the campaign was built),
 *  - stops the campaign when failures suggest the number or template is in trouble.
 * `budgetMs` stops a batch early before the hosting time limit; unsent messages go back to the queue.
 */
export async function processBatch(
  supabase: SupabaseClient,
  campaignId: string,
  provider: WhatsAppProvider,
  opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<BatchResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (opts.budgetMs ?? 25_000);

  const { data: campaign } = await supabase
    .from("whatsapp_campaigns")
    .select("id, status, mode, started_at, template:whatsapp_templates(name, language, status)")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return none("missing", 0, "This campaign no longer exists.");
  const template = (Array.isArray(campaign.template) ? campaign.template[0] : campaign.template) as { name: string; language: string; status: string } | null;
  if (!template) return none("missing", 0, "The template for this campaign no longer exists.");
  if (campaign.status !== "ready" && campaign.status !== "sending") return none("idle", 0, `This campaign is ${campaign.status}.`);
  if (provider.kind !== campaign.mode) return none("idle", 0, "The sending mode does not match this campaign.");

  const pause = async (reason: string, queued: number, partial: Partial<BatchResult> = {}): Promise<BatchResult> => {
    await supabase.from("whatsapp_campaigns").update({ status: "paused", paused_reason: reason }).eq("id", campaignId);
    return { ...none("paused", queued, reason), ...partial };
  };

  if (campaign.mode === "live" && template.status !== "approved") {
    return pause("This template is not approved by WhatsApp (status: " + template.status + ").", await queuedCount(supabase, campaignId));
  }

  const { data: settingsRow } = await supabase.from("whatsapp_settings").select("*").maybeSingle();
  if (!settingsRow) return none("idle", 0, "WhatsApp settings are missing.");
  const settings = settingsRow as WaSettings;

  await supabase.from("whatsapp_campaigns").update({ status: "sending", paused_reason: null, started_at: campaign.started_at ?? new Date().toISOString() }).eq("id", campaignId);
  await supabase.rpc("whatsapp_reap_stuck", { p_campaign: campaignId });

  const queuedBefore = await queuedCount(supabase, campaignId);
  const { data: sent24 } = await supabase.rpc("whatsapp_sent_last_24h");
  const size = nextBatchSize({ dailyLimit: settings.daily_limit, sentLast24h: Number(sent24 ?? 0), batchSize: settings.batch_size, queued: queuedBefore });
  if (queuedBefore > 0 && size === 0) {
    return pause(`The daily limit of ${settings.daily_limit} messages in 24 hours has been reached. Resume later; the queue is kept.`, queuedBefore);
  }

  const { data: claimed } = await supabase.rpc("whatsapp_claim_messages", { p_campaign: campaignId, p_limit: size });
  const batch = (claimed ?? []) as MessageRow[];
  if (batch.length === 0) return finish(supabase, campaignId);

  const { data: contacts } = await supabase.from("contacts").select("id, whatsapp_consent, archived_at").in("id", batch.map((m) => m.contact_id));
  const ok = new Map((contacts ?? []).map((c) => [c.id as string, c.whatsapp_consent === "opted_in" && !c.archived_at]));

  const outcomes: SendOutcome[] = [];
  let sent = 0, failed = 0, skipped = 0;
  let stopReason: string | null = null;
  let i = 0;
  for (; i < batch.length; i++) {
    if (now() > deadline) break; // out of time: hand the rest back
    const m = batch[i];
    if (!ok.get(m.contact_id)) {
      await supabase.from("whatsapp_messages").update({ status: "skipped", error: "Consent changed or contact archived after the campaign was created." }).eq("id", m.id);
      skipped++;
      continue;
    }
    const res = await provider.send({ to: m.to_phone, template: { name: template.name, language: template.language }, params: m.params ?? [], body: m.body });
    if (res.ok) {
      await supabase.from("whatsapp_messages").update({ status: "sent", provider_message_id: res.providerId, sent_at: new Date().toISOString(), error: null }).eq("id", m.id);
      sent++;
    } else {
      await supabase.from("whatsapp_messages").update({ status: "failed", error: res.error }).eq("id", m.id);
      failed++;
    }
    outcomes.push(res.ok ? { ok: true } : { ok: false, code: res.code });
    const verdict = circuitBreaker(outcomes);
    if (verdict.trip) {
      stopReason = verdict.reason;
      i++;
      break;
    }
    if (i < batch.length - 1 && settings.send_gap_ms > 0) await sleep(settings.send_gap_ms);
  }

  // Anything claimed but not attempted goes back to the queue.
  const rest = batch.slice(i).map((m) => m.id);
  if (rest.length) await supabase.from("whatsapp_messages").update({ status: "queued" }).in("id", rest).eq("status", "sending");

  const queued = await queuedCount(supabase, campaignId);
  if (stopReason) return pause(stopReason, queued, { sent, failed, skipped });
  if (queued === 0) {
    const done = await finish(supabase, campaignId);
    return { ...done, sent, failed, skipped };
  }
  return { state: "sent_batch", sent, failed, skipped, queued };
}

async function queuedCount(supabase: SupabaseClient, campaignId: string): Promise<number> {
  const { count } = await supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "queued");
  return count ?? 0;
}

/** Marks the campaign completed once nothing is queued or in flight. */
async function finish(supabase: SupabaseClient, campaignId: string): Promise<BatchResult> {
  const { count } = await supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("status", ["queued", "sending"]);
  if ((count ?? 0) > 0) return none("sent_batch", count ?? 0);
  await supabase.from("whatsapp_campaigns").update({ status: "completed", completed_at: new Date().toISOString(), paused_reason: null }).eq("id", campaignId);
  return none("completed");
}
