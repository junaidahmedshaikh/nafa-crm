"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";

export const CATEGORY_SUGGESTIONS = [
  "wedding_venues",
  "event_agencies",
  "corporate_hr",
  "corporate_office",
  "digital_agencies",
  "activation_agencies",
  "production_companies",
  "existing_client",
];
const label = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const norm = (t: string) =>
  t
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
const OTHER = "__other__";

/** Business category dropdown. Choose one or more from the list (each appears as a chip), or pick "Other" to type your own. */
export function CategoryTags({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const add = (t: string) => {
    const n = norm(t);
    if (n && !value.includes(n)) onChange([...value, n]);
  };
  const available = CATEGORY_SUGGESTIONS.filter((s) => !value.includes(s));
  return (
    <div className="space-y-2">
      <Select
        aria-label="Business category"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) setCustom(true);
          else if (v) add(v);
        }}
      >
        <option value="">
          {value.length
            ? "Add another category…"
            : "Select a business category…"}
        </option>
        {available.map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
        <option value={OTHER}>Other (type your own)…</option>
      </Select>
      {custom && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Custom category"
            aria-label="Custom category"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
                setText("");
                setCustom(false);
              }
            }}
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 text-sm hover:bg-surface-muted"
            onClick={() => {
              add(text);
              setText("");
              setCustom(false);
            }}
          >
            Add
          </button>
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs text-accent"
            >
              {label(t)}
              <button
                type="button"
                aria-label={`Remove ${label(t)}`}
                onClick={() => onChange(value.filter((x) => x !== t))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
