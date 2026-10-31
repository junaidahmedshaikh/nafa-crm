import { AppShell } from "@/components/layout/app-shell";
import { InstallTracker } from "@/components/pwa/install-tracker";
import { ThemeSync } from "@/components/theme/theme-toggle";
import { getSettings, requireMember } from "@/lib/auth";
import { getThemePreference } from "@/lib/theme-server";

// Every page here is per-user and reads the session cookie, so nothing may be prerendered or cached.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, supabase } = await requireMember();
  const [settings, theme] = await Promise.all([getSettings(), getThemePreference(supabase, user.id)]);
  return (
    <AppShell
      userName={profile.full_name || user.email || "Account"}
      userEmail={user.email ?? ""}
      businessName={settings.business_name}
      userId={user.id}
      theme={theme}
      isAdmin={profile.role === "admin"}
    >
      <ThemeSync preference={theme} />
      <InstallTracker userId={user.id} />
      {children}
    </AppShell>
  );
}
