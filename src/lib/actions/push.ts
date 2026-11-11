"use server";

import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail } from "@/lib/actions/util";
import { pushConfigured, sendPushToUsers } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

const subSchema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Invalid subscription"),
  p256dh: z.string().min(10).max(300),
  auth: z.string().min(10).max(100),
  platform: z.string().max(40).default(""),
});

/** Registers this device for push notifications (RLS limits it to the caller's own rows). */
export async function savePushSubscription(input: z.input<typeof subSchema>): Promise<ActionResult> {
  return authorized(async ({ user }) => {
    const p = subSchema.safeParse(input);
    if (!p.success) return fail("This browser returned an invalid notification subscription.");
    // The caller is already authenticated as an active team member. The service role is used so a device that was
    // previously registered by another account on the same browser can be re-assigned to the person now signed in.
    const { error } = await createAdminClient().from("push_subscriptions").upsert({ user_id: user.id, ...p.data }, { onConflict: "endpoint" });
    if (error) {
      console.error("[push subscribe]", error.message);
      return fail("Could not save the notification setting. Please try again.");
    }
    return { ok: true };
  });
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user.id);
    return { ok: true };
  });
}

/** Sends a test notification to the caller's own devices only. */
export async function sendTestPush(): Promise<ActionResult<{ sent: number }>> {
  return authorized(async ({ user }) => {
    if (!pushConfigured()) return fail("Push notifications are not configured on the server (VAPID keys).");
    const r = await sendPushToUsers([user.id], { title: "NAFA CRM", body: "Notifications are working on this device.", url: "/", tag: "test" });
    if (!r.sent) return fail("No notification could be delivered. Turn notifications off and on again on this device.");
    return { ok: true, data: { sent: r.sent } };
  });
}
