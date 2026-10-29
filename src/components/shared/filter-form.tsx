"use client";

import { useRouter } from "next/navigation";

/** GET filter form: submits on Enter/Apply, and immediately when a select or date changes. Empty values are dropped from the URL. */
export function FilterForm({ basePath, children, className }: { basePath: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  function go(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && v.trim()) params.set(k, v.trim());
    }
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }
  return (
    <form
      className={className}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(e.currentTarget);
      }}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === "date")) go(e.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
