"use server";

import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail, isUuid, refresh } from "@/lib/actions/util";
import type { ActionResult } from "@/lib/types";

/** Marks the caller's own notifications read (all of them when no ids are given). RLS limits this to their own rows. */
export async function markNotificationsRead(ids?: string[]): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (ids) q = q.in("id", ids.filter(isUuid));
    const { error } = await q;
    if (error) return fail("Could not update notifications.");
    return { ok: true };
  });
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  email_enabled: z.boolean(),
  extra_recipients: z.array(z.string().uuid()).max(100),
  alert_emails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).max(20),
});
export type InstallAlertSettingsInput = z.input<typeof settingsSchema>;

export async function saveInstallAlertSettings(values: InstallAlertSettingsInput): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change notification settings.");
    const parsed = settingsSchema.safeParse(values);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the values.", { alert_emails: "Enter valid email addresses" });
    const d = parsed.data;
    const { data, error } = await supabase
      .from("install_alert_settings")
      .update({ enabled: d.enabled, email_enabled: d.email_enabled, extra_recipients: d.extra_recipients, alert_emails: [...new Set(d.alert_emails)] })
      .eq("id", true)
      .select("id");
    if (error || !data?.length) return fail("Could not save the settings.");
    refresh(["/settings/app-installs"]);
    return { ok: true };
  });
}
