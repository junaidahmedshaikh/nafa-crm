import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runLoggedJob } from "@/lib/bdm/briefing";
import { fetchRecentInbound, gmailConfigured } from "@/lib/email/gmail";
import { ingestReplies } from "@/lib/email/replies";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Checks the reply mailbox (read-only Gmail) and stores replies from people we emailed. Call every 10–15 minutes. */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!gmailConfigured()) return NextResponse.json({ ok: true, skipped: "Gmail reply monitoring is not configured" });
  try {
    const supabase = createAdminClient();
    const out = await runLoggedJob(supabase, "email_replies", async () => ({ ok: true, ...(await ingestReplies(supabase, await fetchRecentInbound(7, 50), "gmail")) }) as never, 2);
    return NextResponse.json(out, { status: out.ok ? 200 : 500 });
  } catch (e) {
    console.error("[cron email-replies]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
