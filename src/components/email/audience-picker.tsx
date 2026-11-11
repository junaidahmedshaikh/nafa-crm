"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/layout";
import { previewAudience, type AudiencePreview } from "@/lib/actions/email";
import { searchContactsForCampaign } from "@/lib/actions/recipient-groups";
import { LEAD_STATUS_OPTIONS } from "@/lib/constants";
import type { AudienceFilters } from "@/lib/email/audience";
import { cn } from "@/lib/utils";

export type PickerGroup = { id: string; name: string; type: "static" | "dynamic"; contacts: number; eligible: number };
type Mode = "groups" | "contacts" | "filters" | "all";
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const REASONS: Record<string, string> = { no_email: "No email address", invalid: "Invalid email", duplicate: "Duplicates", unsubscribed: "Unsubscribed", bounced: "Bounced", suppressed: "Suppressed" };

function initialMode(f: AudienceFilters): Mode {
  if (f.groupIds?.length) return "groups";
  if (f.contactIds?.length) return "contacts";
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length : v)) ? "filters" : "groups";
}

/** Step 1 of the campaign wizard: groups, individual contacts, dynamic filters, or every eligible contact. */
export function AudiencePicker({ value, onChange, groups }: { value: AudienceFilters; onChange: (f: AudienceFilters) => void; groups: PickerGroup[] }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(initialMode(value));
  const [aud, setAud] = useState<AudiencePreview | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; company: string | null; email: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const set = (patch: Partial<AudienceFilters>) => { onChange({ ...value, ...patch }); setAud(null); };

  function switchMode(m: Mode) {
    setMode(m); setAud(null);
    onChange(m === "groups" ? { groupIds: value.groupIds } : m === "contacts" ? { contactIds: value.contactIds } : m === "filters" ? { ...value, groupIds: undefined, contactIds: undefined } : {});
  }
  const selected = value.groupIds ?? [];
  const toggleGroup = (id: string) => set({ groupIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  const check = () => start(async () => { const r = await previewAudience(value); if (r.ok) setAud(r.data); else toast.error(r.error); });
  const MODES: [Mode, string][] = [["groups", "A · Recipient groups"], ["contacts", "B · Individual contacts"], ["filters", "C · Dynamic filters"], ["all", "D · All eligible contacts"]];

  return (
    <Card>
      <CardHeader title="1 · Select recipients" />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2" role="tablist">
          {MODES.map(([m, label]) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={cn("rounded-full border px-3 py-1 text-sm", mode === m ? "border-btn-primary bg-btn-primary text-btn-primary-foreground" : "border-border text-muted hover:text-foreground")}>{label}</button>)}
        </div>

        {mode === "groups" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Choose one or more groups. A contact in several groups is emailed once.</span>
              {groups.length > 0 && <button type="button" className="text-accent hover:underline" onClick={() => set({ groupIds: selected.length === groups.length ? [] : groups.map((g) => g.id) })}>{selected.length === groups.length ? "Clear all" : "Select all groups"}</button>}
            </div>
            {groups.length === 0 ? <p className="rounded-md border border-border p-4 text-sm text-muted">No recipient groups yet. Create some under Recipient Groups, then assign contacts from the Contacts page.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {groups.map((g) => (
                  <li key={g.id}>
                    <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm", selected.includes(g.id) ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-muted")}>
                      <span className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggleGroup(g.id)} />{g.name}{g.type === "dynamic" && <span className="rounded bg-foreground/5 px-1.5 text-[10px] text-muted">dynamic</span>}</span>
                      <span className="text-xs text-muted tabular-nums">{g.contacts} contacts · {g.eligible} emailable</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "contacts" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company or email…" aria-label="Search contacts" className="max-w-sm" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); start(async () => { const r = await searchContactsForCampaign(q); if (r.ok) setHits(r.data); }); } }} />
              <Button disabled={pending || q.trim().length < 2} onClick={() => start(async () => { const r = await searchContactsForCampaign(q); if (r.ok) setHits(r.data); })}>Search</Button>
            </div>
            {hits.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {hits.map((h) => {
                  const on = value.contactIds?.includes(h.id);
                  return <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2"><span>{h.name}<span className="text-muted"> · {h.company ?? "No company"} · {h.email}</span></span><Button size="sm" onClick={() => { setNames({ ...names, [h.id]: h.name }); set({ contactIds: on ? value.contactIds!.filter((x) => x !== h.id) : [...(value.contactIds ?? []), h.id] }); }}>{on ? "Remove" : "Add"}</Button></li>;
                })}
              </ul>
            )}
            {(value.contactIds?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {value.contactIds!.map((id) => <button key={id} type="button" onClick={() => set({ contactIds: value.contactIds!.filter((x) => x !== id) })} className="rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs text-accent" title="Remove">{names[id] ?? "Selected contact"} ✕</button>)}
              </div>
            )}
          </div>
        )}

        {mode === "filters" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Industry / business category" hint="Matches company industry">{(p) => <Input {...p} defaultValue={value.industries?.join(", ")} onBlur={(e) => set({ industries: csv(e.target.value) })} />}</Field>
            <Field label="Business category tag" hint="Contact tags, e.g. wedding_planners">{(p) => <Input {...p} defaultValue={value.categories?.join(", ")} onBlur={(e) => set({ categories: csv(e.target.value) })} />}</Field>
            <Field label="City" hint="Comma-separated">{(p) => <Input {...p} defaultValue={value.cities?.join(", ")} onBlur={(e) => set({ cities: csv(e.target.value) })} placeholder="Mumbai, Pune" />}</Field>
            <Field label="State">{(p) => <Input {...p} defaultValue={value.states?.join(", ")} onBlur={(e) => set({ states: csv(e.target.value) })} placeholder="Maharashtra" />}</Field>
            <Field label="Lead status">{(p) => <Select {...p} value={value.leadStatuses?.[0] ?? ""} onChange={(e) => set({ leadStatuses: e.target.value ? [e.target.value] : undefined })}><option value="">Any</option>{LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
            <Field label="Lead priority" hint="The CRM’s lead score">{(p) => <Select {...p} value={value.leadPriorities?.[0] ?? ""} onChange={(e) => set({ leadPriorities: e.target.value ? [e.target.value] : undefined })}><option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>}</Field>
            <Field label="Not contacted for (days)">{(p) => <Input {...p} type="number" min={1} defaultValue={value.notContactedDays ?? ""} onBlur={(e) => set({ notContactedDays: Number(e.target.value) || undefined })} />}</Field>
            <Field label="Previous campaign activity">{(p) => <Select {...p} value={value.contactedCampaignBefore ?? ""} onChange={(e) => set({ contactedCampaignBefore: (e.target.value || undefined) as "yes" | "no" | undefined })}><option value="">Any</option><option value="no">Never emailed before</option><option value="yes">Emailed before</option></Select>}</Field>
            <Field label="Search name / company / email">{(p) => <Input {...p} defaultValue={value.search} onBlur={(e) => set({ search: e.target.value || undefined })} />}</Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3"><input type="checkbox" checked={!!value.emailVerifiedOnly} onChange={(e) => set({ emailVerifiedOnly: e.target.checked || undefined })} />Only contacts with a verified (valid) email status</label>
          </div>
        )}

        {mode === "all" && <p className="rounded-md border border-border p-4 text-sm text-muted">Every active contact in the CRM that can legally and technically be emailed: valid address, not unsubscribed, bounced or suppressed, one email per address.</p>}

        <p className="text-xs text-muted">Bounced, unsubscribed, suppressed, invalid and duplicate addresses are always excluded, whatever you choose.</p>
        <Button onClick={check} loading={pending}><Users className="h-4 w-4" aria-hidden />Count recipients</Button>

        {aud && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted/50 p-4 text-sm">
            {mode === "groups" && <p>Selected groups: <strong>{aud.perGroup.length}</strong> · Total contacts (with overlap): <strong>{aud.totalWithDuplicates}</strong></p>}
            <p><span className="text-2xl font-semibold tabular-nums">{aud.eligible}</span> unique eligible emails <span className="text-muted">({aud.matched} matching contacts · {aud.totalContacts} in the CRM)</span></p>
            {Object.keys(aud.excluded).length > 0 && <p className="text-xs text-muted">Excluded: {Object.entries(aud.excluded).map(([k, v]) => `${REASONS[k] ?? k}: ${v}`).join(" · ")}</p>}
            {aud.perGroup.length > 0 && <ul className="text-xs text-muted">{aud.perGroup.map((g) => <li key={g.id}>{g.name}: {g.count} contacts</li>)}</ul>}
            {aud.sample.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted">{aud.sample.map((s) => <li key={s.id}>{s.name}{s.company ? ` · ${s.company}` : ""} — {s.email}</li>)}</ul>}
          </div>
        )}
      </div>
    </Card>
  );
}
