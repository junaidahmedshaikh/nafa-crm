"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { AlertCircle, CheckCircle2, Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, DataTable, Td, Th } from "@/components/ui/layout";
import {
  commitLeadImport, previewLeadImport, type ImportPreview, type ImportRowReport, type ImportSummary,
} from "@/lib/actions/import";
import { IMPORT_MAX_ROWS, importTemplateCsv, toCsv, type RawRow } from "@/lib/csv";

type Parsed = { headers: string[]; rows: RawRow[]; fileName: string };

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function errorReport(rows: ImportRowReport[]) {
  return toCsv(rows, [
    { header: "row", value: (r) => r.row },
    { header: "status", value: (r) => r.status },
    { header: "title", value: (r) => r.title ?? "" },
    { header: "problems", value: (r) => r.messages.join(" | ") },
  ]);
}

export function ImportWizard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<(ImportSummary & { rows: ImportRowReport[] }) | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setParsed(null); setPreview(null); setResult(null); setProblem(null); setIncludeDuplicates(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setProblem("Please choose a .csv file. In Excel or Sheets use File → Download → CSV.");
    if (file.size > 2 * 1024 * 1024) return setProblem("This file is larger than 2 MB. Split it into smaller files.");
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        if (res.data.length === 0) return setProblem("The file has no data rows.");
        if (res.data.length > IMPORT_MAX_ROWS) return setProblem(`This file has ${res.data.length} rows. A single import can contain at most ${IMPORT_MAX_ROWS}; please split it.`);
        const p = { headers, rows: res.data, fileName: file.name };
        setParsed(p);
        startTransition(async () => {
          const r = await previewLeadImport({ headers, rows: res.data });
          if (r.ok) setPreview(r.data);
          else { setProblem(r.error); setParsed(null); }
        });
      },
      error: (err) => setProblem(`The file could not be read: ${err.message}`),
    });
  }

  function runImport() {
    if (!parsed) return;
    startTransition(async () => {
      const r = await commitLeadImport({ headers: parsed.headers, rows: parsed.rows }, { includeDuplicates });
      if (r.ok) {
        setResult(r.data);
        toast.success(`Imported ${r.data.imported} lead${r.data.imported === 1 ? "" : "s"}`);
      } else {
        toast.error(r.error);
        setProblem(r.error);
      }
    });
  }

  const importable = preview ? preview.valid + (includeDuplicates ? preview.duplicates : 0) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader
          title="1. Choose a CSV file"
          action={
            <Button size="sm" onClick={() => download("nafa-lead-import-template.csv", "﻿" + importTemplateCsv())}>
              <Download className="h-4 w-4" aria-hidden />Download template
            </Button>
          }
        />
        <div className="space-y-3 p-5">
          <p className="text-sm text-muted">
            Only <strong>title</strong> is required, plus a company or contact. Column names are matched flexibly (e.g. “Company Name”, “Budget”).
            Status, source, service and priority accept the labels used in the app. Up to {IMPORT_MAX_ROWS} rows per import.
            Existing companies and contacts are reused (matched by name, email or phone) rather than duplicated.
          </p>
          <label htmlFor="csv" className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border-strong bg-surface-muted px-4 py-6 hover:border-accent">
            <FileUp className="h-5 w-5 text-muted" aria-hidden />
            <span className="text-sm">{parsed ? parsed.fileName : "Click to select a .csv file"}</span>
            <input id="csv" ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {problem && (
            <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{problem}
            </div>
          )}
          {pending && !preview && !result && <p className="text-sm text-muted" role="status">Checking every row…</p>}
        </div>
      </Card>

      {preview && !result && (
        <Card>
          <CardHeader title="2. Review" />
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{preview.valid} ready to import</Badge>
              <Badge tone="warning">{preview.duplicates} possible duplicates</Badge>
              <Badge tone="danger">{preview.invalid} with errors (will not be imported)</Badge>
            </div>
            {preview.unknownHeaders.length > 0 && (
              <p className="text-sm text-muted">Ignored columns: {preview.unknownHeaders.join(", ")}</p>
            )}
            {preview.rows.length > 0 && (
              <>
                <div className="max-h-80 overflow-auto rounded-md border border-border">
                  <DataTable>
                    <thead><tr><Th>Row</Th><Th>Result</Th><Th>Lead</Th><Th>Problem</Th></tr></thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.row}>
                          <Td className="tabular-nums">{r.row}</Td>
                          <Td><Badge tone={r.status === "invalid" ? "danger" : "warning"}>{r.status === "invalid" ? "Error" : "Duplicate"}</Badge></Td>
                          <Td>{r.title ?? "—"}</Td>
                          <Td>{r.messages.join("; ")}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
                <Button size="sm" onClick={() => download("nafa-import-problems.csv", errorReport(preview.rows))}>
                  <Download className="h-4 w-4" aria-hidden />Download error report
                </Button>
              </>
            )}
            {preview.duplicates > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} className="h-4 w-4" />
                Import the {preview.duplicates} possible duplicate{preview.duplicates === 1 ? "" : "s"} anyway
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={runImport} loading={pending} disabled={importable === 0}>
                Import {importable} lead{importable === 1 ? "" : "s"}
              </Button>
              <Button onClick={reset} disabled={pending}>Start over</Button>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader title="Import complete" />
          <div className="space-y-4 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />{result.imported} lead{result.imported === 1 ? "" : "s"} imported</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
              <li>Companies: {result.companiesCreated} created, {result.companiesReused} reused</li>
              <li>Contacts: {result.contactsCreated} created, {result.contactsReused} reused</li>
              <li>Follow-ups scheduled: {result.followUpsScheduled}</li>
              {result.skippedDuplicates > 0 && <li>{result.skippedDuplicates} duplicate rows skipped</li>}
              {result.invalid > 0 && <li>{result.invalid} rows with errors were not imported</li>}
            </ul>
            {result.rows.length > 0 && (
              <Button size="sm" onClick={() => download("nafa-import-problems.csv", errorReport(result.rows))}>
                <Download className="h-4 w-4" aria-hidden />Download rows that were not imported
              </Button>
            )}
            <div className="flex gap-2">
              <Link href="/leads" className="inline-flex h-9 items-center rounded-md bg-nav px-4 text-sm font-medium text-nav-foreground hover:bg-nav-active">View leads</Link>
              <Button onClick={reset}>Import another file</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
