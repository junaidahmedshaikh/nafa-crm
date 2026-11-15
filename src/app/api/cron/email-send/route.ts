import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runLoggedJob } from "@/lib/bdm/briefing";
import { processEmailQueue } from "@/lib/email/processor";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Email sending queue. Call every few minutes from a scheduler (Vercel Cron on a plan that allows it, or an external
 * pinger sending `Authorization: Bearer $CRON_SECRET`). Each call sends at most one batch, inside the sending window,
 * within the daily limit. Works with the browser closed.
 */
export async function GET(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const supabase = createAdminClient();
    const out = await runLoggedJob(supabase, "email_queue", async () => {
      const r = await processEmailQueue(supabase);
      if (!r.ok) throw new Error(r.error);
      return { ...r, ok: true } as never;
    }, 2);
    return NextResponse.json(out, { status: out.ok ? 200 : 500 });
  } catch (e) {
    console.error("[cron email-send]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
