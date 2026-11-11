"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/layout";
import { LEAD_STATUS_OPTIONS } from "@/lib/constants";
import { addMembersByContact, createSuggestedGroups, deleteGroup, removeFromGroups, saveGroup, searchContactsForCampaign, setGroupStatus, type GroupInput } from "@/lib/actions/recipient-groups";

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
type Filters = NonNullable<GroupInput["filter_conditions"]>;

export type GroupFormValue = { id?: string; name: string; description: string; group_type: "static" | "dynamic"; business_category: string; target_industry: string; location: string; filter_conditions: Filters };

export function GroupForm({ initial, onDone }: { initial: GroupFormValue; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [g, setG] = useState(initial);
  const f = g.filter_conditions;
  const setF = (patch: Partial<Filters>) => setG({ ...g, filter_conditions: { ...f, ...patch } });
  const editing = !!initial.id;
  return (
    <form className="space-y-4 p-5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveGroup(g);
        if (r.ok) { toast.success(editing ? "Group updated" : "Group created"); onDone?.(); router.refresh(); if (!editing) router.push(`/email-marketing/groups/${r.data.id}`); } else toast.error(r.error);
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Group name" required>{(p) => <Input {...p} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />}</Field>
        <Field label="Type" hint={editing ? "A group's type cannot be changed." : "Static: you add people. Dynamic: people join automatically when they match conditions."}>
          {(p) => <Select {...p} value={g.group_type} disabled={editing} onChange={(e) => setG({ ...g, group_type: e.target.value as "static" | "dynamic" })}><option value="static">Static (manual)</option><option value="dynamic">Dynamic (automatic)</option></Select>}
        </Field>
        <Field label="Business category">{(p) => <Input {...p} value={g.business_category} onChange={(e) => setG({ ...g, business_category: e.target.value })} placeholder="e.g. Wedding" />}</Field>
        <Field label="Target industry">{(p) => <Input {...p} value={g.target_industry} onChange={(e) => setG({ ...g, target_industry: e.target.value })} placeholder="e.g. Wedding planning" />}</Field>
        <Field label="Location">{(p) => <Input {...p} value={g.location} onChange={(e) => setG({ ...g, location: e.target.value })} placeholder="e.g. Mumbai" />}</Field>
        <Field label="Description">{(p) => <Textarea {...p} rows={2} value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} />}</Field>
      </div>
      {g.group_type === "dynamic" && (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-1 text-sm font-medium">Conditions</p>
          <p className="mb-3 text-xs text-muted">Contacts matching ALL conditions are included automatically, and are re-evaluated every time the group is used.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Industry contains">{(p) => <Input {...p} defaultValue={f.industries?.join(", ")} onBlur={(e) => setF({ industries: csv(e.target.value) })} placeholder="Wedding" />}</Field>
            <Field label="City">{(p) => <Input {...p} defaultValue={f.cities?.join(", ")} onBlur={(e) => setF({ cities: csv(e.target.value) })} placeholder="Mumbai, Pune" />}</Field>
            <Field label="State">{(p) => <Input {...p} defaultValue={f.states?.join(", ")} onBlur={(e) => setF({ states: csv(e.target.value) })} />}</Field>
            <Field label="Business category tag">{(p) => <Input {...p} defaultValue={f.categories?.join(", ")} onBlur={(e) => setF({ categories: csv(e.target.value) })} placeholder="wedding_planners" />}</Field>
            <Field label="Lead status">{(p) => <Select {...p} value={f.leadStatuses?.[0] ?? ""} onChange={(e) => setF({ leadStatuses: e.target.value ? [e.target.value] : undefined })}><option value="">Any</option>{LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
            <Field label="Lead priority">{(p) => <Select {...p} value={f.leadPriorities?.[0] ?? ""} onChange={(e) => setF({ leadPriorities: e.target.value ? [e.target.value as "high"] : undefined })}><option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>}</Field>
            <Field label="Not contacted for (days)">{(p) => <Input {...p} type="number" min={1} defaultValue={f.notContactedDays ?? ""} onBlur={(e) => setF({ notContactedDays: Number(e.target.value) || undefined })} />}</Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.emailVerifiedOnly} onChange={(e) => setF({ emailVerifiedOnly: e.target.checked || undefined })} />Only contacts with a verified (valid) email status</label>
        </div>
      )}
      <div className="flex justify-end gap-2">{onDone && <Button onClick={onDone}>Cancel</Button>}<Button type="submit" variant="primary" loading={pending}>{editing ? "Save group" : "Create group"}</Button></div>
    </form>
  );
}

/** Header actions for the groups list. */
export function GroupsToolbar({ empty }: { empty: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setOpen(!open)}>{open ? "Close" : "New group"}</Button>
        <Button loading={pending} onClick={() => start(async () => { const r = await createSuggestedGroups(); if (r.ok) { toast.success(r.data.created ? `${r.data.created} suggested groups added` : "All suggested groups already exist"); router.refresh(); } else toast.error(r.error); })}>Add suggested groups</Button>
      </div>
      {empty && !open && <p className="text-sm text-muted">No groups yet. “Add suggested groups” creates NAFA’s starter set (Wedding Planners, Event Management Agencies, Hotels &amp; Banquet Halls …) — empty, ready for you to assign contacts.</p>}
      {open && <Card><CardHeader title="New recipient group" /><GroupForm initial={{ name: "", description: "", group_type: "static", business_category: "", target_industry: "", location: "", filter_conditions: {} }} onDone={() => setOpen(false)} /></Card>}
    </div>
  );
}

/** Per-group admin actions (edit, archive/restore, delete). */
export function GroupActions({ id, status, isAdmin, name, redirect }: { id: string; status: string; isAdmin: boolean; name: string; redirect?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await setGroupStatus(id, status === "active" ? "archived" : "active"); if (r.ok) { toast.success(status === "active" ? "Group archived" : "Group restored"); router.refresh(); } else toast.error(r.error); })}>{status === "active" ? "Archive" : "Restore"}</Button>
      {isAdmin && <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { if (window.confirm(`Delete the group “${name}”? Contacts are NOT deleted — only the group and its assignments.`)) start(async () => { const r = await deleteGroup(id); if (r.ok) { toast.success("Group deleted"); if (redirect) router.push("/email-marketing/groups"); router.refresh(); } else toast.error(r.error); }); }}>Delete</Button>}
    </div>
  );
}

/** Add people to / remove people from a STATIC group on its detail page. */
export function MemberTools({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; company: string | null; email: string }[]>([]);
  return (
    <div className="space-y-2 border-b border-border p-4">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts to add…" aria-label="Search contacts" className="max-w-sm" />
        <Button disabled={pending || q.trim().length < 2} onClick={() => start(async () => { const r = await searchContactsForCampaign(q); if (r.ok) setHits(r.data); })}>Search</Button>
      </div>
      {hits.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>{h.name}<span className="text-muted"> · {h.company ?? "No company"} · {h.email}</span></span>
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await addMembersByContact(groupId, h.id); if (r.ok) { toast.success("Added"); setHits(hits.filter((x) => x.id !== h.id)); router.refresh(); } else toast.error(r.error); })}>Add</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemoveMember({ groupId, contactId }: { groupId: string; contactId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} className="text-xs text-danger hover:underline" onClick={() => start(async () => { const r = await removeFromGroups({ ids: [contactId] }, [groupId]); if (r.ok) { router.refresh(); } else toast.error(r.error); })}>Remove</button>;
}

export const TypeBadge = ({ t }: { t: string }) => <Badge tone={t === "dynamic" ? "accent" : "neutral"}>{t === "dynamic" ? "Dynamic" : "Static"}</Badge>;
