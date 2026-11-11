"use client";

import { cn } from "@/lib/utils";

export type GroupOption = { id: string; name: string };

/** Checkbox chips for choosing recipient groups. */
export function GroupPicker({ groups, value, onChange, disabled }: { groups: GroupOption[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  if (groups.length === 0) return <p className="text-xs text-muted">No static recipient groups yet. Create them under AI Email Marketing → Recipient Groups.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Recipient groups">
      {groups.map((g) => {
        const on = value.includes(g.id);
        return (
          <label key={g.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground", disabled && "opacity-60")}>
            <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={() => toggle(g.id)} />
            {on ? "✓ " : ""}{g.name}
          </label>
        );
      })}
    </div>
  );
}
