import { NextResponse } from "next/server";
import { isUuid } from "@/lib/actions/util";
import { createClient } from "@/lib/supabase/server";

/** One-click unsubscribe (RFC 8058): mail clients POST here from the List-Unsubscribe header. GET sends people to the confirmation page. */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isUuid(token)) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unsubscribe_by_token", { p_token: token });
  return NextResponse.json({ ok: !error && data === "ok" }, { status: error ? 500 : 200 });
}
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, req.url));
}
