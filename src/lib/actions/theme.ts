"use server";

import { authorized } from "@/lib/auth";
import { fail } from "@/lib/actions/util";
import { isThemePreference } from "@/lib/theme";
import type { ActionResult } from "@/lib/types";

/** Saves the caller's theme preference (the database function only ever touches their own profile). */
export async function saveThemePreference(theme: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isThemePreference(theme)) return fail("Unknown theme.");
    const { error } = await supabase.rpc("set_theme_preference", { p_theme: theme });
    if (error) return fail("Your theme could not be saved to your profile. It is applied on this device only.");
    return { ok: true };
  });
}
