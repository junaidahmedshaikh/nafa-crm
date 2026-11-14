"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, CalendarClock, Check, CheckCheck, MailCheck, MailX, MonitorSmartphone, ReceiptText, TrendingDown, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { saveNotificationPreferences } from "@/lib/actions/scheduled";
import { formatDateTime } from "@/lib/datetime";
import { NOTIFICATION_TYPES, notificationLabel } from "@/lib/scheduled/core";
import { cn } from "@/lib/utils";

export type NotificationItem = { id: string; type: string; title: string; body: string; data: Record<string, unknown>; read_at: string | null; created_at: string };

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  payment_received: Wallet, payment_partial: Wallet, invoice_due_soon: ReceiptText, invoice_overdue: AlertTriangle, scheduled_email_sent: MailCheck,
  scheduled_email_failed: MailX, follow_up_due: CalendarClock, expense_recorded: ReceiptText, budget_exceeded: AlertTriangle, profit_warning: TrendingDown,
  app_install: MonitorSmartphone,
};
export const notificationIcon = (type: string) => ICONS[type] ?? Bell;
const DANGER = new Set(["invoice_overdue", "scheduled_email_failed", "budget_exceeded", "profit_warning"]);

/** Where a notification leads: only in-app paths are ever followed. */
export function notificationHref(n: Pick<NotificationItem, "type" | "data">, isAdmin: boolean): string | null {
  if (n.type === "app_install") return isAdmin ? "/settings/app-installs" : null;
  const url = (n.data as { url?: unknown }).url;
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : null;
}

export function NotificationList({ items, isAdmin, unread }: { items: NotificationItem[]; isAdmin: boolean; unread: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const mark = (ids?: string[]) => startTransition(async () => {
    const r = await markNotificationsRead(ids);
    if (!r.ok) toast.error(r.error);
    router.refresh();
  });
  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <p className="text-sm font-semibold">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        {unread > 0 && <Button size="sm" onClick={() => mark()} disabled={pending}><CheckCheck className="h-4 w-4" aria-hidden />Mark all as read</Button>}
      </div>
      {items.length === 0 ? <p className="px-5 py-12 text-center text-sm text-muted">No notifications here.</p> : (
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const Icon = notificationIcon(n.type);
            const href = notificationHref(n, isAdmin);
            const content = (
              <div className="flex gap-3">
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  n.read_at ? "bg-foreground/5 text-muted" : DANGER.has(n.type) ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-foreground/80">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-muted">{notificationLabel(n.type)} · {formatDateTime(n.created_at)}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id} className="flex items-start gap-2 px-5 py-3 hover:bg-surface-muted">
                {href
                  ? <Link href={href} className="min-w-0 flex-1" onClick={() => { if (!n.read_at) void markNotificationsRead([n.id]); }}>{content}</Link>
                  : <div className="min-w-0 flex-1">{content}</div>}
                {!n.read_at && <Button size="icon" variant="ghost" onClick={() => mark([n.id])} disabled={pending} aria-label="Mark as read" title="Mark as read"><Check className="h-4 w-4" aria-hidden /></Button>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Each person chooses which kinds of notification they receive (in the bell and as push). */
export function NotificationPreferences({ muted }: { muted: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [off, setOff] = useState<Set<string>>(new Set(muted));
  const toggle = (t: string) => setOff((cur) => { const next = new Set(cur); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  return (
    <form className="p-5" onSubmit={(e) => {
      e.preventDefault();
      startTransition(async () => {
        const r = await saveNotificationPreferences([...off]);
        if (r.ok) { toast.success("Notification preferences saved"); router.refresh(); } else toast.error(r.error);
      });
    }}>
      <p className="mb-3 text-xs text-muted">Untick a type to stop receiving it. This applies to you only.</p>
      <div className="grid gap-2">
        {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => (
          <label key={type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={!off.has(type)} disabled={pending} onChange={() => toggle(type)} />{label}
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><Button type="submit" variant="primary" size="sm" loading={pending}>Save preferences</Button></div>
    </form>
  );
}
