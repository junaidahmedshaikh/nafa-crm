import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendAlertEmail } from "@/lib/notifications/email";

const bodySchema = z.object({
  device_id: z.string().min(16).max(64),
  platform: z.enum(["android", "ios", "windows", "macos", "linux", "other"]),
  browser: z.string().max(40),
  source: z.enum(["pwa", "home_screen"]),
  event: z.enum(["installed", "launched", "active"]),
});

/** Records an installation / launch for the signed-in user. The database de-duplicates and raises the alerts. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const b = parsed.data;

  const { data, error } = await supabase.rpc("record_app_install", {
    p_device_id: b.device_id, p_platform: b.platform, p_browser: b.browser, p_source: b.source, p_event: b.event,
  });
  if (error) {
    // 42501 = signed in but has no team profile: not an error worth retrying.
    return NextResponse.json({ ok: false }, { status: error.code === "42501" ? 403 : 500 });
  }
  const r = data as { recorded: boolean; created?: boolean; message?: string; email_to?: string[] };
  if (r.created && r.email_to?.length && r.message) {
    // Best effort: a failed email never fails the installation record.
    const sent = await sendAlertEmail({ to: r.email_to, subject: "New CRM App Installation", text: `${r.message}\n\nOpen NAFA Business OS → Settings → App installations for details.` });
    if (!sent.ok) console.error("[app-install email]", sent.error);
  }
  return NextResponse.json({ ok: true, recorded: r.recorded, created: !!r.created });
}
