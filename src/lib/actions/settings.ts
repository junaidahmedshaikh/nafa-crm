"use server";

import { revalidatePath } from "next/cache";
import { authorized } from "@/lib/auth";
import { fieldErrorsFrom } from "@/lib/validation/common";
import { profileSchema, settingsSchema, type ProfileFormInput, type SettingsFormInput } from "@/lib/validation/schemas";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError } from "./util";

export async function saveSettings(input: SettingsFormInput): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change business settings.");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { data, error } = await supabase
      .from("business_settings").update(parsed.data).eq("id", true).select("id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("Settings could not be saved (no permission).");
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function saveProfile(input: ProfileFormInput): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", user.id);
    if (error) return fail(friendlyDbError(error));
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
