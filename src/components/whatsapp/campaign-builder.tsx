"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { createCampaign, setContactsConsent } from "@/lib/actions/whatsapp";
import { SKIP_LABELS, type SkipReason } from "@/lib/whatsapp/audience";
import { daysToSend, estimateCost } from "@/lib/whatsapp/limits";
import { CATEGORY_LABELS, MAX_CAMPAIGN_SIZE } from "@/lib/whatsapp/schemas";
import { renderTemplate } from "@/lib/whatsapp/template";
import { formatINR } from "@/lib/format";
import { Bubble, ConsentBadge } from "./bits";

export type BuilderContact = {
  id: string; name: string; company: string | null; designation: string | null; phone: string;
  consent: "unknown" | "opted_in" | "opted_out"; reason: SkipReason | null;
};
export type BuilderTemplate = { id: string; name: string; category: "marketing" | "utility"; status: string; body: string; footer: string | null; customs: string[] };
export type BuilderSettings = { mode: "dry_run" | "live"; dailyLimit: number; costPerMessage: number | null; repeatWindowDays: number; sentLast24h: number };

export function CampaignBuilder({
  contacts, templates, settings, truncated,
}: { contacts: BuilderContact[]; templates: BuilderTemplate[]; settings: BuilderSettings; truncated: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [consentPending, startConsent] = useTransition();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [consentFilter, setConsentFilter] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [attest, setAttest] = useState(false);
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const template = templates.find((t) => t.id === templateId);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts.filter((c) => (!consentFilter || c.consent === consentFilter) && (!s || `${c.name} ${c.company ?? ""} ${c.designation ?? ""} ${c.phone}`.toLowerCase().includes(s)));
  }, [contacts, q, consentFilter]);

  const chosen = contacts.filter((c) => selected.has(c.id));
  const eligible = chosen.filter((c) => !c.reason);
  const skippedBy = chosen.reduce<Partial<Record<SkipReason, number>>>((a, c) => (c.reason ? { ...a, [c.reason]: (a[c.reason] ?? 0) + 1 } : a), {});
  const needsConsent = chosen.filter((c) => c.reason === "no_consent");
  const cost = estimateCost(eligible.length, settings.costPerMessage);
  const days = daysToSend(eligible.length, settings.dailyLimit, settings.sentLast24h);

  const sampleContact = eligible[0] ?? chosen[0];
  const preview = template
    ? renderTemplate(template, { full_name: sampleContact?.name ?? "Asha Rao", company_name: sampleContact?.company ?? "Acme Foods", designation: sampleContact?.designation }, Object.fromEntries(template.customs.map((k) => [k, custom[k]?.trim() || `[${k}]`]))).text
    : "";

  const allVisibleEligible = visible.filter((c) => !c.reason);
  const allTicked = allVisibleEligible.length > 0 && allVisibleEligible.every((c) => selected.has(c.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function create() {
    setErrors({});
    start(async () => {
      const res = await createCampaign({ name, template_id: templateId, contact_ids: chosen.map((c) => c.id), custom_values: custom });
      setConfirm(false);
      if (res.ok) {
        toast.success(`Campaign created with ${res.data!.queued} messages queued`);
        router.push(`/whatsapp/campaigns/${res.data!.id}`);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
    });
  }

  function recordConsent() {
    startConsent(async () => {
      const res = await setContactsConsent({ contact_ids: needsConsent.map((c) => c.id), status: "opted_in", source });
      if (res.ok) {
        toast.success(`Recorded consent for ${res.data!.updated} ${res.data!.updated === 1 ? "person" : "people"}`);
        setAttest(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const canCreate = !!name.trim() && !!template && eligible.length > 0 && (template.customs.every((k) => custom[k]?.trim()));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold">1. Message</h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign name" required error={errors.name} hint="Only for your own reference." className="sm:col-span-2">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="e.g. Brand Night invite, Nov 2026" />}
            </Field>
            <Field label="Template" required error={errors.template_id} className="sm:col-span-2" hint={templates.length === 0 ? "Create a template first." : undefined}>
              {(p) => (
                <Select {...p} value={templateId} onChange={(e) => { setTemplateId(e.target.value); setCustom({}); }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {CATEGORY_LABELS[t.category]} · {t.status}</option>)}
                </Select>
              )}
            </Field>
            {template?.customs.map((k) => (
              <Field key={k} label={k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} required error={errors[`custom.${k}`]} hint={`Fills {{${k}}} for everyone in this campaign.`}>
                {(p) => <Input {...p} value={custom[k] ?? ""} onChange={(e) => setCustom((c) => ({ ...c, [k]: e.target.value }))} maxLength={200} />}
              </Field>
            ))}
            {template && settings.mode === "live" && template.status !== "approved" && (
              <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning sm:col-span-2">This template is not approved yet, so a live campaign cannot use it.</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Preview {sampleContact ? `for ${sampleContact.name}` : "(sample contact)"}</p>
            {template ? <Bubble text={preview} /> : <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted">No template selected.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border p-5 pb-4">
          <h2 className="text-sm font-semibold">2. Who to message</h2>
          <p className="mt-0.5 text-xs text-muted">Only people recorded as <strong>opted in</strong> can be messaged. Tick people below; anyone who cannot be messaged is shown with the reason.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[14rem] flex-1">
            <label htmlFor="wa-q" className="sr-only">Search contacts</label>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input id="wa-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, designation…" className="pl-9" />
          </div>
          <label className="sr-only" htmlFor="wa-consent">Consent filter</label>
          <Select id="wa-consent" value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)} className="w-44">
            <option value="">All consent states</option>
            <option value="opted_in">Opted in</option>
            <option value="unknown">Not recorded</option>
            <option value="opted_out">Opted out</option>
          </Select>
          <Button size="sm" onClick={() => setSelected((s) => new Set([...s, ...allVisibleEligible.map((c) => c.id)]))} disabled={allVisibleEligible.length === 0}>Select all ready ({allVisibleEligible.length})</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</Button>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="w-10 px-4 py-2"><input type="checkbox" aria-label="Select all ready contacts shown" checked={allTicked} onChange={() => setSelected((s) => { const n = new Set(s); allVisibleEligible.forEach((c) => (allTicked ? n.delete(c.id) : n.add(c.id))); return n; })} /></th>
                <th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Company</th><th className="px-2 py-2 font-medium">Number</th><th className="px-2 py-2 font-medium">WhatsApp consent</th><th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No contacts match.</td></tr>}
              {visible.map((c) => (
                <tr key={c.id} className="hover:bg-surface-muted">
                  <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="px-2 py-2 font-medium">{c.name}</td>
                  <td className="px-2 py-2 text-muted">{c.company ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted">{c.phone || "—"}</td>
                  <td className="px-2 py-2"><ConsentBadge value={c.consent} /></td>
                  <td className="px-2 py-2">{c.reason ? <Badge tone={c.reason === "no_consent" ? "neutral" : "warning"}>{SKIP_LABELS[c.reason]}</Badge> : <Badge tone="success">Ready</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated && <p className="border-t border-border px-5 py-3 text-xs text-muted">Showing the first {contacts.length} contacts. Use search on the Contacts page to narrow the list.</p>}
      </section>

      {needsConsent.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-success" aria-hidden />Record consent for {needsConsent.length} selected {needsConsent.length === 1 ? "person" : "people"}</h2>
          <p className="mt-1 text-xs text-muted">These people have no WhatsApp consent on file, so they will be skipped. If they have agreed to receive WhatsApp messages from NAFA, record how below. The details are kept on each contact.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="How did they give consent?" hint="e.g. “Signed form at Brand Expo, 12 Oct”, “Replied YES on WhatsApp”">
              {(p) => <Input {...p} value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} />}
            </Field>
            <Button variant="primary" onClick={recordConsent} loading={consentPending} disabled={!attest || !source.trim()}>Record as opted in</Button>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>I confirm these people agreed to receive WhatsApp messages from NAFA.</span>
          </label>
        </section>
      )}

      <section className="sticky bottom-0 rounded-lg border border-border-strong bg-surface p-4 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p><strong className="tabular-nums">{eligible.length}</strong> will be messaged{chosen.length > eligible.length && <> · <span className="text-warning">{chosen.length - eligible.length} skipped</span></>}</p>
            <p className="text-xs text-muted">
              {eligible.length > 0 && <>About {days} {days === 1 ? "day" : "days"} at your {settings.dailyLimit}/day limit{cost != null ? ` · est. ${formatINR(cost, { exact: true })}` : ""}</>}
              {eligible.length === 0 && "Tick at least one person who is ready."}
              {eligible.length > MAX_CAMPAIGN_SIZE && <span className="text-danger"> · Over the {MAX_CAMPAIGN_SIZE} per campaign limit</span>}
            </p>
            {Object.keys(skippedBy).length > 0 && <p className="text-xs text-muted">Skipped: {Object.entries(skippedBy).map(([k, n]) => `${n} × ${SKIP_LABELS[k as SkipReason]}`).join(", ")}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={settings.mode === "live" ? "danger" : "info"}>{settings.mode === "live" ? "Live" : "Dry run"}</Badge>
            <Button variant="primary" onClick={() => setConfirm(true)} disabled={!canCreate || eligible.length > MAX_CAMPAIGN_SIZE}>Create campaign</Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirm} onClose={() => setConfirm(false)} onConfirm={create} pending={pending} destructive={false}
        title="Create this campaign?"
        description={`${eligible.length} messages will be queued${settings.mode === "live" ? ". Nothing is sent yet: you start sending from the next page, and you can pause at any time" : " in dry-run mode. Nothing will actually be sent"}.`}
        confirmLabel="Create campaign"
      />
    </div>
  );
}
