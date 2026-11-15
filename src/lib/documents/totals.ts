import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sum of all non-voided invoice payments. Uses the payments_received_total() database function; before that migration
 * is applied it falls back to adding the rows up here (capped by the API row limit, which is why the function exists).
 */
export async function paymentsReceivedTotal(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("payments_received_total");
  if (!error && data !== null) return Math.round(Number(data) * 100) / 100;
  const { data: rows } = await supabase.from("invoice_payments").select("amount").is("voided_at", null).limit(5000);
  return Math.round((rows ?? []).reduce((a, r) => a + Number(r.amount) * 100, 0)) / 100;
}
