import { CampaignBuilder, type BuilderContact } from "@/components/whatsapp/campaign-builder";
import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";
import { evaluateAudience, maskPhone } from "@/lib/whatsapp/audience";
import { getWaSettings, listAudience, listTemplates, recentlyMessaged, sentLast24h } from "@/lib/whatsapp/repo";
import { customPlaceholders } from "@/lib/whatsapp/template";

export const metadata = { title: "New WhatsApp campaign" };
const LIMIT = 1000;

export default async function NewCampaignPage() {
  const { supabase } = await requireMember();
  const crumbs = [{ label: "WhatsApp", href: "/whatsapp" }, { label: "New campaign" }];
  const loaded = await guarded(async () => {
    const [settings, templates, audience, used, business] = await Promise.all([
      getWaSettings(supabase), listTemplates(supabase), listAudience(supabase, { q: "", consent: "" }, LIMIT), sentLast24h(supabase), getSettings(),
    ]);
    const recent = await recentlyMessaged(supabase, settings.repeat_window_days, audience.rows.map((r) => r.id));
    return { settings, templates, audience, used, country: business.default_country_code, recent };
  });
  if (!loaded.ok) return <><PageHeader title="New campaign" breadcrumbs={crumbs} /><SetupNeeded message={loaded.message} /></>;
  const { settings, templates, audience, used, country, recent } = loaded.data;

  const usable = templates.filter((t) => t.status !== "rejected");
  if (usable.length === 0) {
    return (
      <>
        <PageHeader title="New campaign" breadcrumbs={crumbs} />
        <EmptyState title="Create a template first" description="A campaign sends a template to a list of people. Write one with placeholders for their name and your event." action={<LinkButton href="/whatsapp/templates/new" variant="primary">New template</LinkButton>} />
      </>
    );
  }

  const evaluated = evaluateAudience(audience.rows, { defaultCountryCode: country, recentlyMessaged: recent });
  const byId = new Map(audience.rows.map((r) => [r.id, r]));
  const contacts: BuilderContact[] = evaluated.entries.map((e) => {
    const r = byId.get(e.contact.id)!;
    return { id: r.id, name: r.full_name, company: r.company_name, designation: r.designation, phone: e.phone ? maskPhone(e.phone) : "", consent: r.whatsapp_consent, reason: e.reason };
  });
  // Ready people first, so the useful rows are on top.
  contacts.sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="New campaign" breadcrumbs={crumbs} description="Pick a template, choose who to message, check the preview, then create the campaign. Nothing is sent until you press Start on the next page." />
      <CampaignBuilder
        contacts={contacts}
        truncated={audience.total > audience.rows.length}
        templates={usable.map((t) => ({ id: t.id, name: t.name, category: t.category, status: t.status, body: t.body, footer: t.footer, customs: customPlaceholders(t.body) }))}
        settings={{ mode: settings.mode, dailyLimit: settings.daily_limit, costPerMessage: settings.cost_per_message, repeatWindowDays: settings.repeat_window_days, sentLast24h: used }}
      />
    </>
  );
}
