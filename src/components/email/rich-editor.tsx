"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Heading2, Image as ImageIcon, Italic, Link2, List, ListOrdered, Eraser } from "lucide-react";
import { VARIABLES } from "@/lib/email/personalize";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { cn } from "@/lib/utils";

type Tab = "visual" | "html" | "desktop" | "mobile";

/**
 * Rich-text email body editor (visual / HTML source / desktop + mobile preview).
 * Uses the browser's built-in editing (no extra dependency). The value is sanitised to an
 * email-safe allow-list whenever it changes, so pasted content cannot smuggle in scripts or styles.
 */
export function RichEditor({
  value, onChange, previewVars, signatureHtml,
}: {
  value: string;
  onChange: (html: string) => void;
  previewVars?: Record<string, string>;
  signatureHtml?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("visual");
  const lastEmitted = useRef(value);

  // Push external changes (AI apply, template load) into the editable area without clobbering typing.
  useEffect(() => {
    if (tab === "visual" && ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value, tab]);
  useEffect(() => {
    if (tab === "visual" && ref.current) ref.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const emit = () => {
    if (!ref.current) return;
    const clean = sanitizeEmailHtml(ref.current.innerHTML);
    lastEmitted.current = clean;
    onChange(clean);
  };
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const addLink = () => {
    const url = window.prompt("Link address (https://…)", "https://www.nafaevents.in/");
    if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
  };
  const addImage = () => {
    const url = window.prompt("Image address (https://… — the image must already be online)");
    if (url && /^https?:\/\//i.test(url)) exec("insertImage", url);
  };
  const insertVar = (name: string) => exec("insertText", `{{${name}}}`);

  const filled = (html: string) => html.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, (_m, k: string, fb?: string) => previewVars?.[k] || fb || `[${k}]`);
  const previewDoc = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;padding:16px">${filled(value)}${signatureHtml ? filled(signatureHtml) : ""}<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px"><p style="font-size:12px;color:#777">[Postal address] · Unsubscribe link is added automatically.</p></div>`;

  const btn = "inline-flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-foreground/5 hover:text-foreground";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted/60 px-2 py-1.5">
        {tab === "visual" ? (
          <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
            <button type="button" className={btn} title="Bold" aria-label="Bold" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><Bold className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Italic" aria-label="Italic" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><Italic className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Heading" aria-label="Heading" onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h2"); }}><Heading2 className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Paragraph" aria-label="Paragraph" onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "p"); }}>¶</button>
            <button type="button" className={btn} title="Bullet list" aria-label="Bullet list" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}><List className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}><ListOrdered className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Link" aria-label="Insert link" onMouseDown={(e) => { e.preventDefault(); addLink(); }}><Link2 className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Image" aria-label="Insert image" onMouseDown={(e) => { e.preventDefault(); addImage(); }}><ImageIcon className="h-4 w-4" /></button>
            <button type="button" className={btn} title="Clear formatting" aria-label="Clear formatting" onMouseDown={(e) => { e.preventDefault(); exec("removeFormat"); }}><Eraser className="h-4 w-4" /></button>
            <select aria-label="Insert personalisation field" className="ml-1 h-8 rounded border border-border bg-surface px-1 text-xs" value="" onChange={(e) => { if (e.target.value) insertVar(e.target.value); e.target.value = ""; }}>
              <option value="">Insert field…</option>
              {VARIABLES.map((v) => <option key={v} value={v}>{`{{${v}}}`}</option>)}
            </select>
          </div>
        ) : <span className="px-2 text-xs text-muted">{tab === "html" ? "HTML source (sanitised on save)" : "Preview uses sample values for fields"}</span>}
        <div className="flex gap-0.5 text-xs">
          {([["visual", "Edit"], ["html", "HTML"], ["desktop", "Desktop"], ["mobile", "Mobile"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded px-2.5 py-1", tab === k ? "bg-foreground/10 font-medium" : "text-muted hover:text-foreground")}>{label}</button>
          ))}
        </div>
      </div>
      {tab === "visual" && (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="Email body"
          onInput={emit}
          onBlur={emit}
          onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text/html") || e.clipboardData.getData("text/plain"); document.execCommand("insertHTML", false, sanitizeEmailHtml(t)); }}
          className="prose-email min-h-[360px] max-h-[640px] overflow-y-auto p-5 text-[15px] leading-relaxed outline-none [&_a]:text-accent [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_img]:max-w-full [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc"
        />
      )}
      {tab === "html" && (
        <textarea
          value={value}
          onChange={(e) => { lastEmitted.current = e.target.value; onChange(e.target.value); }}
          onBlur={(e) => { const c = sanitizeEmailHtml(e.target.value); lastEmitted.current = c; onChange(c); }}
          spellCheck={false}
          aria-label="HTML source"
          className="block min-h-[360px] w-full resize-y bg-surface p-4 font-mono text-xs outline-none"
        />
      )}
      {(tab === "desktop" || tab === "mobile") && (
        <div className="flex justify-center bg-surface-muted/50 p-4">
          <iframe title="Email preview" sandbox="" srcDoc={previewDoc} className={cn("h-[460px] rounded border border-border bg-white", tab === "mobile" ? "w-[375px]" : "w-full max-w-[700px]")} />
        </div>
      )}
    </div>
  );
}
