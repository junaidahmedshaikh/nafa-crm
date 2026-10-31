import { AppShell } from "@/components/layout/app-shell";
import { InstallTracker } from "@/components/pwa/install-tracker";
import { getSettings, requireMember } from "@/lib/auth";

// Every page here is per-user and reads the session cookie, so nothing may be prerendered or cached.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireMember();
  const settings = await getSettings();
  return (
    <AppShell
      userName={profile.full_name || user.email || "Account"}
      userEmail={user.email ?? ""}
      businessName={settings.business_name}
      userId={user.id}
      isAdmin={profile.role === "admin"}
    >
      <InstallTracker userId={user.id} />
      {children}
    </AppShell>
  );
}
