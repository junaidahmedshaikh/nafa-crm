import { NextResponse } from "next/server";
import { applyProviderEvent, verifySvix } from "@/lib/email/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Resend webhook (Resend dashboard → Webhooks → https://<your-app>/api/webhooks/resend). Set RESEND_WEBHOOK_SECRET to the signing secret.
 * Records delivered / bounced / complained (and opened / clicked, when tracking is enabled on your Resend domain).
 * Unsigned or badly signed requests are rejected.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Webhook secret not configured" }, { status: 503 });
  const body = await request.text();
  const ok = verifySvix(secret, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, body);
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const out = await applyProviderEvent(createAdminClient(), request.headers.get("svix-id")!, JSON.parse(body));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[resend webhook]", e);
    return NextResponse.json({ ok: false }, { status: 500 });   // Resend retries on non-2xx
  }
}
