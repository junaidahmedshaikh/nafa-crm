import { isUuid } from "@/lib/actions/util";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!isUuid(token)) return;
  const supabase = await createClient();
  await supabase.rpc("unsubscribe_by_token", { p_token: token });
}

/** Public opt-out page. Unsubscribing needs a button press so that link scanners cannot opt people out by accident. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const valid = isUuid(token);
  return (
    <main style={{ fontFamily: "Arial, sans-serif", maxWidth: 480, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
      <h1 style={{ fontSize: 22 }}>NAFA Events &amp; Activations</h1>
      {!valid ? (
        <p>This unsubscribe link is not valid.</p>
      ) : done ? (
        <p>You have been unsubscribed. You will not receive further marketing emails from us.</p>
      ) : (
        <form action={async (fd) => { "use server"; await confirm(fd); const { redirect } = await import("next/navigation"); redirect(`/unsubscribe/${token}?done=1`); }}>
          <p>Stop receiving marketing emails from NAFA Events &amp; Activations?</p>
          <input type="hidden" name="token" value={token} />
          <button type="submit" style={{ padding: "10px 20px", fontSize: 15, cursor: "pointer" }}>Confirm unsubscribe</button>
        </form>
      )}
    </main>
  );
}
