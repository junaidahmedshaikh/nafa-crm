import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { generateBriefing, runLoggedJob } from "@/lib/bdm/briefing";
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

/**
 * Scheduled morning briefing (vercel.json: 03:00 UTC = 08:30 IST). Works with the browser closed.
 * Idempotent: it only creates today's briefing once, and only after the time configured by the administrator
 * (so a more frequent schedule, e.g. every 15 minutes, honours a custom time).
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  let supabase;
  try {
    supabase = createAdminClient();
  } catch (e) {
    console.error("[cron briefing]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const out = await runLoggedJob(supabase, "daily_briefing", () => generateBriefing(supabase, { trigger: "cron" }));
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
