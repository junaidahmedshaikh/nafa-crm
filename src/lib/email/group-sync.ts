import type { SupabaseClient } from "@supabase/supabase-js";

/** Makes the contact belong to exactly `groupIds` among the STATIC groups (dynamic groups are never touched). */
export async function syncContactGroups(supabase: SupabaseClient, contactId: string, groupIds: string[]): Promise<{ added: number; removed: number; error?: string }> {
  const { data: all } = await supabase.from("recipient_groups").select("id").eq("group_type", "static");
  const staticIds = new Set((all ?? []).map((g: { id: string }) => g.id));
  const want = new Set(groupIds.filter((g) => staticIds.has(g)));
  const { data: cur } = await supabase.from("contact_recipient_groups").select("group_id").eq("contact_id", contactId);
  const have = new Set((cur ?? []).map((r: { group_id: string }) => r.group_id));
  const add = [...want].filter((g) => !have.has(g));
  const del = [...have].filter((g) => staticIds.has(g) && !want.has(g));
  if (add.length) {
    const { error } = await supabase.from("contact_recipient_groups").upsert(add.map((group_id) => ({ contact_id: contactId, group_id })), { onConflict: "contact_id,group_id", ignoreDuplicates: true });
    if (error) return { added: 0, removed: 0, error: error.message };
  }
  if (del.length) {
    const { error } = await supabase.from("contact_recipient_groups").delete().eq("contact_id", contactId).in("group_id", del);
    if (error) return { added: 0, removed: 0, error: error.message };
  }
  if (add.length || del.length) await supabase.from("recipient_group_audit").insert({ action: "assign", details: { contacts: 1, added: add.length, removed: del.length, sample: [contactId] } });
  return { added: add.length, removed: del.length };
}
