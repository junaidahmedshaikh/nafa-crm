"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { DataTable, Td, Th } from "@/components/ui/layout";
import { saveProduct } from "@/lib/actions/documents";
import type { Product } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";

export function ProductManager({ rows }: { rows: Product[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const p = editing && editing !== "new" ? editing : null;
  const close = () => { setEditing(null); setErrors({}); };

  function toggle(row: Product) {
    startTransition(async () => {
      const r = await saveProduct({ name: row.name, category: row.category ?? "", description: row.description ?? "", unit: row.unit, default_rate: String(row.default_rate), hsn_sac: row.hsn_sac ?? "", gst_rate: row.gst_rate == null ? "" : String(row.gst_rate), is_active: !row.is_active }, row.id);
      if (r.ok) { toast.success(row.is_active ? "Deactivated" : "Activated"); router.refresh(); } else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex justify-end border-b border-border p-3"><Button variant="primary" size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New item</Button></div>
      <DataTable>
        <thead><tr><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th className="text-right">Default rate</Th><Th>HSN/SAC</Th><Th>GST %</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-muted">
              <Td><p className="font-medium">{r.name}</p>{r.description && <p className="max-w-md truncate text-xs text-muted">{r.description}</p>}</Td>
              <Td>{r.category ?? "—"}</Td><Td>{r.unit}</Td>
              <Td className="text-right tabular-nums">{formatINR(r.default_rate, { exact: true })}</Td>
              <Td>{r.hsn_sac ?? "—"}</Td><Td>{r.gst_rate ?? "—"}</Td>
              <Td><Badge tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Badge></Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="icon" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(r)} disabled={pending}>{r.is_active ? "Deactivate" : "Activate"}</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <Modal open={editing !== null} onClose={close} title={p ? "Edit item" : "New product / service"} description="Changing the default rate affects new documents only — issued quotations and invoices keep the rates they were issued with.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const v = Object.fromEntries(f) as Record<string, string>;
            startTransition(async () => {
              const r = await saveProduct({ name: v.name, category: v.category, description: v.description, unit: v.unit, default_rate: v.default_rate, hsn_sac: v.hsn_sac, gst_rate: v.gst_rate, is_active: f.get("is_active") === "on" }, p?.id);
              if (r.ok) { toast.success("Saved"); close(); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
            });
          }}
        >
          <Field label="Name" required error={errors.name}>{(x) => <Input {...x} name="name" defaultValue={p?.name} autoFocus />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" error={errors.category}>{(x) => <Input {...x} name="category" defaultValue={p?.category ?? ""} placeholder="e.g. Production" />}</Field>
            <Field label="Unit" required error={errors.unit}>{(x) => <Input {...x} name="unit" defaultValue={p?.unit ?? "nos"} />}</Field>
            <Field label="Default rate (₹)" required error={errors.default_rate}>{(x) => <Input {...x} name="default_rate" inputMode="decimal" defaultValue={p ? String(p.default_rate) : "0"} />}</Field>
            <Field label="HSN/SAC" error={errors.hsn_sac}>{(x) => <Input {...x} name="hsn_sac" defaultValue={p?.hsn_sac ?? ""} />}</Field>
            <Field label="GST rate (%)" hint="Optional default" error={errors.gst_rate}>{(x) => <Input {...x} name="gst_rate" inputMode="decimal" defaultValue={p?.gst_rate == null ? "" : String(p.gst_rate)} />}</Field>
          </div>
          <Field label="Description" error={errors.description}>{(x) => <Textarea {...x} name="description" rows={3} defaultValue={p?.description ?? ""} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" className="h-4 w-4" defaultChecked={p ? p.is_active : true} />Active (shown when building documents)</label>
          <div className="flex justify-end gap-2"><Button onClick={close} disabled={pending}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>Save</Button></div>
        </form>
      </Modal>
    </>
  );
}
