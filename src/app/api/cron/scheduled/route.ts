import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runLoggedJob } from "@/lib/bdm/briefing";
import { runScheduledJobs } from "@/lib/scheduled/processor";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Scheduled emails, payment reminders and due/overdue alerts. Works with the browser closed.
 * vercel.json runs it once a day (10:00 IST); for emails to leave at the exact minute they were scheduled for, also call it
 * every 5–10 minutes (Vercel Cron on a paid plan, Supabase pg_cron, or any pinger sending `Authorization: Bearer $CRON_SECRET`).
 * Idempotent: a second call sends nothing twice.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const supabase = createAdminClient();
    const out = await runLoggedJob(supabase, "scheduled_emails", async () => (await runScheduledJobs(supabase)) as never, 2);
    return NextResponse.json(out, { status: out.ok ? 200 : 500 });
  } catch (e) {
    console.error("[cron scheduled]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
