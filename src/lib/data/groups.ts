import type { SupabaseClient } from "@supabase/supabase-js";

export type StaticGroupOption = { id: string; name: string };

/** Active static groups (the ones people can be assigned to). */
export async function listAssignableGroups(supabase: SupabaseClient): Promise<StaticGroupOption[]> {
  const { data } = await supabase.from("recipient_groups").select("id, name").eq("group_type", "static").eq("status", "active").order("name");
  return (data ?? []) as StaticGroupOption[];
}

export async function contactGroupIds(supabase: SupabaseClient, contactId: string): Promise<string[]> {
  const { data } = await supabase.from("contact_recipient_groups").select("group_id").eq("contact_id", contactId);
  return (data ?? []).map((r: { group_id: string }) => r.group_id);
}
