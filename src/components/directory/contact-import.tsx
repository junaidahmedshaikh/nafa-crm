"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { GroupPicker, type GroupOption } from "@/components/email/group-picker";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { importContactsWithGroups } from "@/lib/actions/recipient-groups";
import { isValidEmail, normalizeEmail } from "@/lib/email/audience";

const MAX_ROWS = 2000;
const TEMPLATE_COLS = ["full_name", "email", "phone", "company", "designation", "industry", "city", "state", "website", "category", "groups"];

/** Accepts common spreadsheet header spellings and maps them to our column names. */
const SYNONYMS: Record<string, string> = {
  name: "full_name", fullname: "full_name", contact_name: "full_name", contact: "full_name", person: "full_name",
  email_address: "email", e_mail: "email", work_email: "email", mail: "email",
  mobile: "phone", mobile_number: "phone", phone_number: "phone", contact_number: "phone", whatsapp: "phone",
  company_name: "company", organisation: "company", organization: "company", firm: "company",
  title: "designation", role: "designation", position: "designation", job_title: "designation",
  business_category: "category", group: "groups", recipient_groups: "groups", recipient_group: "groups",
};
const headerKey = (h: string) => {
  const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return SYNONYMS[k] ?? k;
};

type Row = Record<string, string>;
type Result = { created: number; existing: number; invalid: number; assigned: number; groupsCreated: number };

function downloadTemplate() {
  const sample = [TEMPLATE_COLS, ["Priya Sharma", "priya@example.com", "+91 98200 00000", "Sharma Weddings", "Founder", "Wedding planning", "Mumbai", "Maharashtra", "https://example.com", "wedding_planners", "Wedding Planners; Mumbai Prospects"]];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([Papa.unparse(sample)], { type: "text/csv" }));
  a.download = "contacts-import-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Bulk contact import: choose a CSV, check the preview, optionally add everyone to groups, then import. */
export function ContactImport({ groups = [] }: { groups?: GroupOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    if (file.size > 5 * 1024 * 1024) return void toast.error("That file is too large (5 MB maximum).");
    if (!/\.(csv|txt)$/i.test(file.name) && file.type !== "text/csv") return void toast.error("Please choose a .csv file. In Excel or Google Sheets use File → Save as / Download → CSV.");
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: "greedy", transformHeader: headerKey,
      complete: (r) => {
        const data = r.data.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v ?? "").trim()])));
        if (!data.length || !("email" in data[0])) { setRows([]); return void toast.error("No “email” column found. Download the template to see the expected columns."); }
        if (data.length > MAX_ROWS) toast.message(`Only the first ${MAX_ROWS} rows will be imported.`);
        setRows(data.slice(0, MAX_ROWS)); setFileName(file.name);
      },
      error: () => toast.error("That file could not be read."),
    });
  }

  // Client-side checks so problems are visible before anything is written.
  const seen = new Set<string>();
  let invalid = 0, duplicateInFile = 0;
  for (const r of rows) {
    if (!isValidEmail(r.email ?? "") || !(r.full_name ?? "").trim()) { invalid++; continue; }
    const n = normalizeEmail(r.email);
    if (seen.has(n)) duplicateInFile++; else seen.add(n);
  }
  const ready = rows.length - invalid - duplicateInFile;

  function submit() {
    if (!window.confirm(`Import ${ready} contact${ready === 1 ? "" : "s"}${groupIds.length ? ` and add them to ${groupIds.length} group${groupIds.length === 1 ? "" : "s"}` : ""}? Existing contacts (same email) are not duplicated.`)) return;
    start(async () => {
      const r = await importContactsWithGroups({
        category: category || undefined, groupIds,
        rows: rows.map((x) => ({ full_name: x.full_name ?? "", email: x.email ?? "", phone: x.phone, company: x.company, designation: x.designation, industry: x.industry, city: x.city, state: x.state, website: x.website, category: x.category, groups: x.groups })),
      });
      if (r.ok) { setResult(r.data); setRows([]); setFileName(""); if (input.current) input.current.value = ""; toast.success("Import finished"); router.refresh(); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5 p-5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden />Choose CSV file</Button>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="ghost" onClick={downloadTemplate}><Download className="h-4 w-4" aria-hidden />Download template</Button>
        {fileName && <span className="text-muted">{fileName}</span>}
      </div>
      <p className="text-muted">
        Columns: <code>{TEMPLATE_COLS.join(", ")}</code>. Only <code>full_name</code> and <code>email</code> are required; common alternatives such as “Name”, “Email Address”, “Mobile” or “Company Name” are recognised. Up to {MAX_ROWS} rows per file. People who already exist (same email) are not duplicated; they are still added to the groups. Group names in the <code>groups</code> column are separated with <code>;</code> and are created if missing. Only import people you have a legitimate business reason to contact.
      </p>

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-border p-3"><p className="text-2xl font-semibold tabular-nums">{ready}</p><p className="text-xs text-muted">ready to import</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-2xl font-semibold tabular-nums">{invalid}</p><p className="text-xs text-muted">invalid (missing name / bad email)</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-2xl font-semibold tabular-nums">{duplicateInFile}</p><p className="text-xs text-muted">duplicates inside the file</p></div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-surface-muted text-muted"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Groups</th></tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-border"><td className="px-3 py-1.5">{r.full_name}</td><td className={`px-3 py-1.5 ${isValidEmail(r.email ?? "") ? "" : "text-danger"}`}>{r.email}</td><td className="px-3 py-1.5">{r.company}</td><td className="px-3 py-1.5">{r.city}</td><td className="px-3 py-1.5">{r.groups}</td></tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && <p className="border-t border-border px-3 py-2 text-xs text-muted">Showing the first 5 of {rows.length} rows.</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business category for every row (optional)" hint="Used when a row has no category of its own, e.g. wedding_planners">{(p) => <Input {...p} value={category} onChange={(e) => setCategory(e.target.value)} />}</Field>
          </div>
          <div><p className="mb-1.5 text-[13px] font-medium">Add every imported contact to these recipient groups</p><GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} /></div>
          <Button variant="primary" loading={pending} disabled={ready < 1} onClick={submit}>Import {ready} contact{ready === 1 ? "" : "s"}</Button>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-success/30 bg-success-soft p-4">
          <p className="font-medium text-success">Import complete</p>
          <ul className="mt-1 space-y-0.5 text-foreground/80">
            <li>{result.created} new contacts added</li>
            <li>{result.existing} already existed (not duplicated)</li>
            <li>{result.invalid} skipped as invalid</li>
            <li>{result.assigned} group assignments{result.groupsCreated ? `, ${result.groupsCreated} new groups created` : ""}</li>
          </ul>
          <Link href="/contacts" className="mt-2 inline-block text-accent hover:underline">View contacts</Link>
        </div>
      )}
    </div>
  );
}
