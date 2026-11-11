"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { GroupPicker, type GroupOption } from "@/components/email/group-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { DataTable, Td, Th } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import {
  assignToGroups, bulkChangeIndustry, bulkSetArchived, createGroupFromSelection, deleteContacts, exportContacts, removeFromGroups, type Selection,
} from "@/lib/actions/recipient-groups";

type Row = { id: string; full_name: string; designation: string | null; company_id: string | null; company_name: string | null; email: string | null; phone: string | null; lead_count: number };
type Dialog = null | "add" | "remove" | "industry" | "status" | "campaign" | "delete";

/** Contacts list with row checkboxes and bulk actions. "Select all N" applies to every contact matching the current search. */
export function ContactsTable({ rows, total, q, archived, groups, isAdmin = false }: { rows: Row[]; total: number; q: string; archived: boolean; groups: GroupOption[]; isAdmin?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [industry, setIndustry] = useState("");
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");

  const count = allMatching ? total : picked.size;
  const selection = (): Selection => (allMatching ? { all: { q, archived } } : { ids: [...picked] });
  const pageAll = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const close = () => { setDialog(null); setGroupIds([]); setIndustry(""); setName(""); setTyped(""); };
  const clear = () => { setPicked(new Set()); setAllMatching(false); };
  const toggleAll = () => { setAllMatching(false); setPicked(pageAll ? new Set() : new Set(rows.map((r) => r.id))); };
  const toggle = (id: string) => { setAllMatching(false); const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); close(); clear(); router.refresh(); } else toast.error(r.error ?? "Something went wrong");
    });
  }
  function exportSelected() {
    start(async () => {
      if (!allMatching) {
        const csv = Papa.unparse(rows.filter((r) => picked.has(r.id)).map((r) => ({ name: r.full_name, designation: r.designation ?? "", company: r.company_name ?? "", email: r.email ?? "", phone: r.phone ?? "" })));
        download(csv); return;
      }
      const r = await exportContacts(selection());
      if (r.ok) download(r.data.csv); else toast.error(r.error);
    });
  }
  const download = (csv: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "selected-contacts.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const summary = `${count} contact${count === 1 ? "" : "s"}`;
  return (
    <>
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/40 px-4 py-2.5 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{summary} selected</span>
          {!allMatching && pageAll && total > rows.length && <button type="button" className="text-accent hover:underline" onClick={() => setAllMatching(true)}>Select all {total} matching</button>}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
          <Button size="sm" onClick={() => setDialog("add")}>Add to group</Button>
          <Button size="sm" onClick={() => setDialog("remove")}>Remove from group</Button>
          <Button size="sm" onClick={() => setDialog("industry")}>Change industry</Button>
          <Button size="sm" onClick={() => setDialog("status")}>{archived ? "Restore" : "Archive"}</Button>
          <Button size="sm" onClick={exportSelected} disabled={pending}>Export</Button>
          <Button size="sm" variant="primary" onClick={() => setDialog("campaign")}>Add to email campaign</Button>
          {isAdmin && <Button size="sm" variant="danger-outline" onClick={() => setDialog("delete")}>Delete</Button>}
          <button type="button" className="ml-auto text-xs text-muted hover:text-foreground" onClick={clear}>Clear</button>
        </div>
      )}
      <DataTable>
        <thead>
          <tr>
            <Th className="w-10"><input type="checkbox" aria-label="Select all on this page" checked={pageAll} onChange={toggleAll} /></Th>
            <Th>Name</Th><Th>Company</Th><Th>Email</Th><Th>Phone</Th><Th className="text-right">Leads</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface-muted">
              <Td><input type="checkbox" aria-label={`Select ${c.full_name}`} checked={allMatching || picked.has(c.id)} onChange={() => toggle(c.id)} /></Td>
              <Td>
                <Link href={`/contacts/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.full_name}</Link>
                {c.designation && <p className="text-xs text-muted">{c.designation}</p>}
              </Td>
              <Td>{c.company_id ? <Link href={`/companies/${c.company_id}`} className="hover:underline">{c.company_name}</Link> : "—"}</Td>
              <Td>{c.email ?? "—"}</Td>
              <Td className="whitespace-nowrap">{c.phone ?? "—"}</Td>
              <Td className="text-right tabular-nums">{c.lead_count}</Td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <Modal open={dialog === "add" || dialog === "remove"} onClose={close} title={dialog === "add" ? "Add to recipient groups" : "Remove from recipient groups"} description={`${summary} will be ${dialog === "add" ? "added to" : "removed from"} the groups you choose. No contacts are duplicated or deleted.`}>
        <div className="space-y-4">
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} disabled={!groupIds.length}
              onClick={() => run(async () => { const r = dialog === "add" ? await assignToGroups(selection(), groupIds) : await removeFromGroups(selection(), groupIds); return r; }, dialog === "add" ? "Added to groups" : "Removed from groups")}>
              Confirm — {dialog === "add" ? "add" : "remove"} {summary}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={dialog === "industry"} onClose={close} title="Change industry" description={`Industry is stored on the company, so every contact at the same company will show the new value. Affects ${summary}.`}>
        <div className="space-y-4">
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Wedding planning" aria-label="Industry" />
          <div className="flex justify-end gap-2"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={pending} disabled={!industry.trim()} onClick={() => run(() => bulkChangeIndustry(selection(), industry), "Industry updated")}>Confirm change</Button></div>
        </div>
      </Modal>
      <Modal open={dialog === "status"} onClose={close} title={archived ? "Restore contacts" : "Archive contacts"} description={`${summary} will be ${archived ? "restored to active" : "archived and hidden from lists"}. Archived contacts are not emailed.`}>
        <div className="flex justify-end gap-2"><Button onClick={close}>Cancel</Button><Button variant={archived ? "primary" : "danger"} loading={pending} onClick={() => run(() => bulkSetArchived(selection(), !archived), archived ? "Contacts restored" : "Contacts archived")}>Confirm</Button></div>
      </Modal>
      <Modal open={dialog === "delete"} onClose={close} title="Permanently delete contacts" description={`${summary} will be deleted for good. Contacts that still have leads are skipped (archive those instead). Their group assignments are removed; quotations and proposals keep their data. This cannot be undone.`}>
        <div className="space-y-4">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm" />
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="danger" loading={pending} disabled={typed !== "DELETE"} onClick={() => start(async () => { const r = await deleteContacts(selection()); if (r.ok) { toast.success(`${r.data.deleted} deleted${r.data.blocked ? `, ${r.data.blocked} skipped because they have leads` : ""}`); close(); clear(); router.refresh(); } else toast.error(r.error); })}>Delete {summary}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={dialog === "campaign"} onClose={close} title="Add to an email campaign" description={`${summary} will be saved as a new recipient group, then the campaign wizard opens with that group selected. Nothing is sent.`}>
        <div className="space-y-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (optional)" aria-label="Group name" />
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await createGroupFromSelection(selection(), name); if (r.ok) { router.push(`/email-marketing/campaigns/new?group=${r.data.groupId}`); } else toast.error(r.error); })}>Create group &amp; continue</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
