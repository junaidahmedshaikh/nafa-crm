"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { generateBriefing } from "@/lib/bdm/briefing";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { istDayBounds } from "@/lib/datetime";
import type { ActionResult } from "@/lib/types";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";

const PATHS = ["/ai-bdm"];

export async function generateBriefingNow(): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const out = await generateBriefing(supabase, { trigger: "manual", userId: user.id });
    if (!out.ok) return fail(out.error ?? "Could not generate the briefing.");
    refresh(PATHS);
    return { ok: true };
  });
}

type Rec = {
  id: string; lead_id: string | null; title: string; action: string; reason: string; channel: string | null;
  follow_up_id: string | null; state: string; suggested_service: string | null; assigned_to: string | null;
};

async function loadRec(supabase: SupabaseClient, id: string): Promise<Rec | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from("bdm_recommendations").select("*").eq("id", id).maybeSingle();
  return (data as Rec | null) ?? null;
}

export async function setRecommendationState(id: string, state: "done" | "open" | "dismissed"): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { data, error } = await supabase.from("bdm_recommendations").update({ state, snoozed_until: null }).eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("That recommendation no longer exists.");
    refresh(PATHS);
    return { ok: true };
  });
}

/** Hides the item until the start of the chosen IST day (1 = tomorrow, 3, 7 days). */
export async function snoozeRecommendation(id: string, days: number): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (![1, 3, 7].includes(days)) return fail("Choose 1, 3 or 7 days.");
    const until = new Date(istDayBounds().start.getTime() + days * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from("bdm_recommendations").update({ state: "snoozed", snoozed_until: until }).eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("That recommendation no longer exists.");
    refresh(PATHS);
    return { ok: true };
  });
}

export async function assignRecommendation(id: string, userId: string | null): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (userId !== null && !isUuid(userId)) return fail("Invalid team member.");
    const { data, error } = await supabase.from("bdm_recommendations").update({ assigned_to: userId }).eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("That recommendation no longer exists.");
    refresh(PATHS);
    return { ok: true };
  });
}

/**
 * Creates a CRM follow-up task from a recommendation — only when the user clicks. Duplicate-safe:
 *  - a recommendation can create at most one task;
 *  - if the lead already has a pending follow-up due the same IST day, that one is linked instead of adding another.
 */
export async function createTaskFromRecommendation(id: string): Promise<ActionResult<{ reused: boolean }>> {
  return authorized(async ({ supabase }) => {
    const rec = await loadRec(supabase, id);
    if (!rec) return fail("That recommendation no longer exists.");
    if (!rec.lead_id) return fail("This recommendation is not linked to a lead.");
    if (rec.follow_up_id) return fail("A CRM task was already created for this recommendation.");

    const now = new Date();
    const { start, end } = istDayBounds(now);
    const istHour = (now.getTime() - start.getTime()) / 3600000;
    const due = istHour < 15 ? new Date(start.getTime() + 17 * 3600000) : new Date(start.getTime() + 34 * 3600000); // today 17:00 or tomorrow 10:00
    const dayStart = istHour < 15 ? start : end;
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);

    const { data: existing } = await supabase.from("follow_ups").select("id")
      .eq("lead_id", rec.lead_id).eq("status", "pending").gte("due_at", dayStart.toISOString()).lt("due_at", dayEnd.toISOString()).limit(1);
    let followUpId = existing?.[0]?.id as string | undefined;
    const reused = !!followUpId;
    if (!followUpId) {
      const { data, error } = await supabase.from("follow_ups").insert({
        lead_id: rec.lead_id,
        title: rec.action.slice(0, 200),
        due_at: due.toISOString(),
        type: rec.channel ?? "general_task",
        notes: `Created from an AI recommendation.\nReason: ${rec.reason}`.slice(0, 1000),
      }).select("id").single();
      if (error || !data) return fail(error ? friendlyDbError(error) : "Could not create the task.");
      followUpId = data.id;
    }
    const { error: linkErr } = await supabase.from("bdm_recommendations").update({ follow_up_id: followUpId }).eq("id", id);
    if (linkErr) return fail(friendlyDbError(linkErr));
    refresh([...PATHS, "/followups"]);
    return { ok: true, data: { reused } };
  });
}

const draftSchema = z.object({ id: z.string().uuid(), channel: z.enum(["email", "whatsapp"]) });

/** Asks Gemini for a draft. The draft is stored on the recommendation for review; nothing is ever sent from here. */
export async function generateDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ subject: string | null; body: string }>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid request.");
    const rec = await loadRec(supabase, parsed.data.id);
    if (!rec || !rec.lead_id) return fail("That recommendation has no linked lead.");

    const [{ data: lead }, { data: acts }, { data: docs }] = await Promise.all([
      supabase.from("lead_list").select("*").eq("id", rec.lead_id).maybeSingle(),
      supabase.from("lead_activities").select("type, summary, created_at").eq("lead_id", rec.lead_id).order("created_at", { ascending: false }).limit(8),
      supabase.from("quotations").select("number, status, sent_at, valid_until, grand_total").eq("lead_id", rec.lead_id).in("status", ["sent", "revised", "accepted"]).limit(3),
    ]);
    if (!lead) return fail("The lead could not be found.");

    const facts = {
      company: lead.company_name, contactPerson: lead.contact_name, designation: lead.contact_designation, leadTitle: lead.title,
      eventName: lead.event_name, eventDate: lead.event_date, city: lead.city, status: lead.status, source: lead.source,
      lastContact: lead.last_contact_at, suggestedNafaService: rec.suggested_service,
      sentQuotations: docs ?? [], recentHistory: (acts ?? []).map((a) => `${a.created_at.slice(0, 10)}: ${a.summary}`),
      recommendedAction: rec.action, whyNow: rec.reason,
    };
    const r = await geminiGenerate({
      system: `${GROUNDING_RULES}\nYou write short, warm, professional outreach for NAFA Events & Activations. Never promise prices, dates or deliverables that are not in the data. Use a [bracketed placeholder] for anything unknown instead of guessing. Sign off as "Team NAFA Events & Activations".`,
      prompt: `Write a ${parsed.data.channel === "email" ? "follow-up email (80-140 words)" : "WhatsApp message (max 60 words, conversational, no subject)"} for this lead. Reply as JSON: {"subject": string|null, "body": string}.\n\nCRM facts:\n${JSON.stringify(facts)}`,
      json: true,
      temperature: 0.6,
    });
    if (!r.ok) return fail(r.code === "not_configured" ? "Gemini is not configured. Ask an administrator to set GEMINI_API_KEY." : "The AI service is unavailable right now. Please try again.");
    let out: { subject?: string | null; body?: string };
    try { out = JSON.parse(r.text); } catch { return fail("The AI returned an unreadable draft. Please try again."); }
    if (!out.body) return fail("The AI returned an empty draft. Please try again.");
    const subject = parsed.data.channel === "email" ? (out.subject ?? null) : null;
    const { error } = await supabase.from("bdm_recommendations")
      .update({ draft_subject: subject, draft_body: out.body, draft_generated_at: new Date().toISOString() }).eq("id", rec.id);
    if (error) return fail(friendlyDbError(error));
    refresh(PATHS);
    return { ok: true, data: { subject, body: out.body } };
  });
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  briefing_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour, IST)"),
  email_enabled: z.boolean(),
  email_recipients: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).max(20),
  inactive_days: z.number().int().min(7).max(365),
  proposal_followup_days: z.number().int().min(1).max(60),
});
export type BdmSettingsInput = z.input<typeof settingsSchema>;

export async function saveBdmSettings(values: BdmSettingsInput): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change the briefing settings.");
    const parsed = settingsSchema.safeParse(values);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the values.");
    const d = parsed.data;
    const { data, error } = await supabase.from("bdm_settings")
      .update({ ...d, email_recipients: [...new Set(d.email_recipients)] }).eq("id", true).select("id");
    if (error || !data?.length) return fail("Could not save the settings.");
    refresh(PATHS);
    return { ok: true };
  });
}

const commSchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(["reply_received", "message_sent"]),
  note: z.string().trim().max(500).optional(),
});

/** Records that the client replied, or that the team sent a message (this is what powers "replied but not answered"). */
export async function logCommunication(input: z.input<typeof commSchema>): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const parsed = commSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid request.");
    const { leadId, type, note } = parsed.data;
    const summary = (type === "reply_received" ? "Client replied" : "Message sent to client") + (note ? `: ${note}` : "");
    const { error } = await supabase.from("lead_activities").insert({ lead_id: leadId, type, summary });
    if (error) return fail(friendlyDbError(error));
    if (type === "message_sent") await supabase.from("leads").update({ last_contact_at: new Date().toISOString() }).eq("id", leadId);
    refresh([...PATHS, `/leads/${leadId}`]);
    return { ok: true };
  });
}
