"use server";

import { authorized } from "@/lib/auth";
import { fieldErrorsFrom } from "@/lib/validation/common";
import { followUpSchema, rescheduleSchema, type FollowUpFormInput } from "@/lib/validation/schemas";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, isUuid, refresh } from "./util";

const PATHS = ["/followups", "/leads", "/"];

export async function createFollowUp(leadId: string, input: FollowUpFormInput): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(leadId)) return fail("Lead not found.");
    const parsed = followUpSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { data: lead } = await supabase.from("leads").select("id, status, archived_at").eq("id", leadId).maybeSingle();
    if (!lead) return fail("This lead no longer exists.");
    if (lead.archived_at) return fail("Restore this lead before scheduling follow-ups.");
    if (lead.status === "won" || lead.status === "lost") return fail("This lead is closed. Re-open it to schedule more follow-ups.");
    const { data, error } = await supabase
      .from("follow_ups").insert({ lead_id: leadId, ...parsed.data }).select("id").single();
    if (error) return fail(friendlyDbError(error));
    refresh([...PATHS, `/leads/${leadId}`]);
    return { ok: true, data: { id: data.id } };
  });
}

export async function completeFollowUp(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Follow-up not found.");
    const { data, error } = await supabase
      .from("follow_ups").update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id).eq("status", "pending").select("id, lead_id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This follow-up is no longer pending.");
    refresh([...PATHS, `/leads/${data.lead_id}`]);
    return { ok: true };
  });
}

export async function rescheduleFollowUp(id: string, input: { due_at: string }): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Follow-up not found.");
    const parsed = rescheduleSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { data, error } = await supabase
      .from("follow_ups").update({ due_at: parsed.data.due_at }).eq("id", id).eq("status", "pending").select("id, lead_id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This follow-up is no longer pending.");
    refresh([...PATHS, `/leads/${data.lead_id}`]);
    return { ok: true };
  });
}

export async function cancelFollowUp(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Follow-up not found.");
    const { data, error } = await supabase
      .from("follow_ups").update({ status: "cancelled" }).eq("id", id).eq("status", "pending").select("id, lead_id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This follow-up is no longer pending.");
    refresh([...PATHS, `/leads/${data.lead_id}`]);
    return { ok: true };
  });
}
