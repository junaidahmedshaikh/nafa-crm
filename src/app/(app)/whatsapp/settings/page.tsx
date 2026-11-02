import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { WaSettingsForm } from "@/components/whatsapp/settings-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getWaSettings, liveConnected } from "@/lib/whatsapp/repo";

export const metadata = { title: "WhatsApp settings" };

export default async function WaSettingsPage() {
  const { supabase, profile } = await requireMember();
  const loaded = await guarded(() => getWaSettings(supabase));
  const crumbs = [{ label: "WhatsApp", href: "/whatsapp" }, { label: "Settings" }];
  if (!loaded.ok) return <><PageHeader title="WhatsApp settings" breadcrumbs={crumbs} /><SetupNeeded message={loaded.message} /></>;
  const s = loaded.data;
  return (
    <>
      <PageHeader title="WhatsApp settings" breadcrumbs={crumbs} description="Sending mode and the limits that keep your number safe. Access tokens are never stored here; they live in server environment variables." />
      <div className="max-w-3xl">
        <WaSettingsForm
          canEdit={profile.role === "admin"}
          liveConnected={liveConnected()}
          defaults={{
            mode: s.mode, daily_limit: String(s.daily_limit), batch_size: String(s.batch_size), send_gap_ms: String(s.send_gap_ms),
            repeat_window_days: String(s.repeat_window_days), cost_per_message: s.cost_per_message == null ? "" : String(s.cost_per_message),
          }}
        />
      </div>
    </>
  );
}
