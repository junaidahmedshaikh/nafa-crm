import Link from "next/link";
import { BusinessSettingsForm, ProfileForm } from "@/components/settings/settings-forms";
import { InstallCard } from "@/components/pwa/install-card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";
import { getThemePreference } from "@/lib/theme-server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile, supabase } = await requireMember();
  const [s, theme] = await Promise.all([getSettings(), getThemePreference(supabase, user.id)]);
  return (
    <>
      <PageHeader title="Settings" description="Business details, follow-up defaults and your profile. Credentials and integration secrets are never stored here — they live in server environment variables." />
      <div className="max-w-3xl space-y-8">
        <Link href="/settings/documents" className="block rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"><p className="text-sm font-semibold">Document settings →</p><p className="text-xs text-muted">Bank details, tax defaults, terms and numbering for quotations, proposals and invoices.</p></Link>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold">Appearance</p>
          <p className="mb-3 mt-0.5 text-xs text-muted">Choose Light, Dark, or follow your device. It is saved to your profile and applied whenever you sign in.</p>
          <ThemeToggle initial={theme} />
        </div>
        <InstallCard />
        {profile.role === "admin" && (
          <Link href="/settings/app-installs" className="block rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"><p className="text-sm font-semibold">App installations →</p><p className="text-xs text-muted">Who installed the CRM app, on which device, plus alert preferences.</p></Link>
        )}
        <BusinessSettingsForm
          canEdit={profile.role === "admin"}
          defaults={{
            business_name: s.business_name, website: s.website, business_email: s.business_email ?? "",
            default_country_code: s.default_country_code, default_follow_up_days: String(s.default_follow_up_days),
            default_follow_up_time: s.default_follow_up_time.slice(0, 5), default_follow_up_type: s.default_follow_up_type,
          }}
        />
        <ProfileForm defaults={{ full_name: profile.full_name }} email={user.email ?? ""} role={profile.role} />
      </div>
    </>
  );
}
