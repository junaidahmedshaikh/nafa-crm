import Link from "next/link";
import { BusinessSettingsForm, ProfileForm } from "@/components/settings/settings-forms";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile } = await requireMember();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Settings" description="Business details, follow-up defaults and your profile. Credentials and integration secrets are never stored here — they live in server environment variables." />
      <div className="max-w-3xl space-y-8">
        <Link href="/settings/documents" className="block rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"><p className="text-sm font-semibold">Document settings →</p><p className="text-xs text-muted">Bank details, tax defaults, terms and numbering for quotations, proposals and invoices.</p></Link>
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
