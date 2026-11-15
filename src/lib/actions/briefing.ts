"use server";

import { authorized } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { fail, refresh } from "@/lib/actions/util";
import { loadBriefingSettings, runTestBriefing } from "@/lib/briefing/build";
import { briefingSettingsSchema } from "@/lib/briefing/core";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";
import { fieldErrorsFrom } from "@/lib/validation/common";

const SETUP = "The Daily Business Briefing is not set up yet. Run supabase/migrations/20261121000001_daily_briefing.sql in the Supabase SQL editor.";
const ADMIN_ONLY = "Only an administrator can change or test the Daily Business Briefing.";

export async function saveBriefingSettings(values: unknown): Promise<ActionResult> {
  return authorized(async ({ supabase, user, profile }) => {
    if (profile.role !== "admin") return fail(ADMIN_ONLY);
    const parsed = briefingSettingsSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const d = parsed.data;
    const { data, error } = await supabase.from("daily_briefing_settings")
      .update({ ...d, custom_days: [...new Set(d.custom_days)].sort(), updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true).select("id");
    if (error) return fail(SETUP);
    if (!data?.length) return fail(ADMIN_ONLY);
    refresh(["/settings/briefing", "/briefing", "/"]);
    return { ok: true };
  });
}

/** Builds a briefing from live CRM data and delivers it now, using the saved method and recipient. Does not affect the schedule. */
export async function sendTestBriefing(): Promise<ActionResult<{ id: string; message: string }>> {
  return authorized<{ id: string; message: string }>(async ({ supabase, user, profile }) => {
    if (profile.role !== "admin") return fail(ADMIN_ONLY);
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const s = await loadBriefingSettings(supabase);
    if (!s) return fail(SETUP);
    if (s.method !== "in_app" && !s.recipient_email) return fail("Save a recipient email address first.", { recipient_email: "Required for email delivery" });
    const r = await runTestBriefing(supabase, s, user.id);
    refresh(["/briefing", "/settings/briefing"]);
    const parts = [
      s.method !== "in_app" ? (r.email === "sent" ? `Email accepted by the provider and sent to ${s.recipient_email}` : `Email NOT sent: ${r.error ?? r.email}`) : "",
      s.method !== "email" ? (r.inApp === "sent" ? "in-app notification created" : "in-app notification failed") : "",
    ].filter(Boolean);
    return { ok: true, data: { id: r.id, message: parts.join("; ") } };
  });
}
