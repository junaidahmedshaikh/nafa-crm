import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, BusinessSettings, Profile } from "@/lib/types";

export type MemberContext = { supabase: SupabaseClient; user: User; profile: Profile };

/**
 * Resolves the signed-in, *authorised* team member for this request.
 * Returns null reason when there is no session, or when the user has no active profile
 * (they exist in Supabase Auth but were never granted access).
 */
export const getMember = cache(async (): Promise<{ ctx: MemberContext } | { reason: "anonymous" | "no_access" }> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { reason: "anonymous" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return { reason: "no_access" };
  return { ctx: { supabase, user: data.user, profile: profile as Profile } };
});

/** For pages / layouts / route handlers: redirects away unless the user is an authorised member. */
export async function requireMember(): Promise<MemberContext> {
  const result = await getMember();
  if ("reason" in result) redirect(result.reason === "anonymous" ? "/login?reason=expired" : "/no-access");
  return result.ctx;
}

/** Wraps a server action: authorises the caller, and converts unexpected errors into a safe result. */
export async function authorized<T = undefined>(
  fn: (ctx: MemberContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const result = await getMember();
  if ("reason" in result) {
    return {
      ok: false,
      error:
        result.reason === "anonymous"
          ? "Your session has expired. Please sign in again."
          : "Your account has not been granted access to NAFA Business OS.",
    };
  }
  try {
    return await fn(result.ctx);
  } catch (e) {
    console.error("[action error]", e);
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}

export const getSettings = cache(async (): Promise<BusinessSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("business_settings").select("*").maybeSingle();
  return (
    (data as BusinessSettings | null) ?? {
      business_name: "NAFA Events & Activations",
      website: "https://www.nafaevents.in/",
      business_email: null,
      default_country_code: "+91",
      currency: "INR",
      default_follow_up_days: 3,
      default_follow_up_time: "10:00:00",
      default_follow_up_type: "call",
    }
  );
});

export const getTeam = cache(async (): Promise<Pick<Profile, "id" | "full_name">[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  return data ?? [];
});
