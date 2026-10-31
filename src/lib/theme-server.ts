import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_THEME, isThemePreference, type ThemePreference } from "@/lib/theme";

/**
 * The signed-in user's saved theme. Deliberately tolerant: if the migration has not been applied yet (column missing)
 * or the read fails, the app keeps the light theme instead of breaking.
 */
export async function getThemePreference(supabase: SupabaseClient, userId: string): Promise<ThemePreference> {
  const { data, error } = await supabase.from("profiles").select("theme_preference").eq("id", userId).maybeSingle();
  if (error) return DEFAULT_THEME;
  const v = (data as { theme_preference?: unknown } | null)?.theme_preference;
  return isThemePreference(v) ? v : DEFAULT_THEME;
}
