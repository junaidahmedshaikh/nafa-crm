import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { generateBriefing, runLoggedJob } from "@/lib/bdm/briefing";
import { runDailyBriefing } from "@/lib/briefing/build";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduled morning briefing (vercel.json: 03:00 UTC = 08:30 IST). Works with the browser closed.
 * Idempotent: it only creates today's briefing once, and only after the time configured by the administrator
 * (so a more frequent schedule, e.g. every 15 minutes, honours a custom time).
 */
export async function GET(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  let supabase;
  try {
    supabase = createAdminClient();
  } catch (e) {
    console.error("[cron briefing]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const out = await runLoggedJob(supabase, "daily_briefing", () => generateBriefing(supabase, { trigger: "cron" }));
  // The Daily Business Briefing (meetings, tasks, payments, projects, finance) is a separate, idempotent job.
  const business = await runLoggedJob(supabase, "business_briefing", async () => (await runDailyBriefing(supabase)) as never, 2);
  if (!business.ok) return NextResponse.json({ ...out, business }, { status: 500 });
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
