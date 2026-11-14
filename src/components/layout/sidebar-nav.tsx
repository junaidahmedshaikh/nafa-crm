"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Ban, BarChart3, Bell, BellRing, Building2, CalendarClock, ChevronDown, FileBarChart, FileText, FolderKanban, HandCoins, Inbox, LayoutDashboard, LayoutTemplate,
  Mail, MailCheck, Megaphone, MessageSquareReply, MonitorSmartphone, Package, Presentation, ReceiptText, Send, Settings, SlidersHorizontal, Sparkles, Store,
  Target, TrendingUp, UserRound, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Icon = React.ComponentType<{ className?: string }>;
type Item = { href: string; label: string; icon: Icon; adminOnly?: boolean };
type Group = { id: string; label: string; icon: Icon; items: Item[] };

/** Every route is an existing page; nothing here duplicates a module. */
export const NAV_GROUPS: Group[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, items: [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/ai-bdm", label: "AI BD Manager", icon: Sparkles },
  ] },
  { id: "sales", label: "Sales & CRM", icon: Target, items: [
    { href: "/leads", label: "Leads", icon: Target },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/contacts", label: "Contacts", icon: UserRound },
    { href: "/followups", label: "Follow-ups & Tasks", icon: CalendarClock },
    { href: "/scheduled-emails", label: "Scheduled Emails", icon: MailCheck },
  ] },
  { id: "billing", label: "Proposals & Billing", icon: ReceiptText, items: [
    { href: "/quotations", label: "Quotations", icon: FileText },
    { href: "/proposals", label: "Proposals", icon: Presentation },
    { href: "/invoices", label: "Invoices", icon: ReceiptText },
    { href: "/payments", label: "Payments", icon: Wallet },
    { href: "/payment-reminders", label: "Payment Reminders", icon: BellRing },
  ] },
  { id: "operations", label: "Projects & Operations", icon: FolderKanban, items: [
    { href: "/projects", label: "Projects", icon: FolderKanban },
    { href: "/products-services", label: "Products & Services", icon: Package },
  ] },
  { id: "finance", label: "Project Finance", icon: TrendingUp, items: [
    { href: "/finance", label: "Financial Overview", icon: TrendingUp },
    { href: "/finance/vendors", label: "Vendor Payables", icon: Store },
    { href: "/finance/reimbursements", label: "Reimbursements", icon: HandCoins },
  ] },
  { id: "marketing", label: "Marketing", icon: Megaphone, items: [
    { href: "/email-marketing", label: "Campaign Dashboard", icon: Megaphone },
    { href: "/email-marketing/campaigns/new", label: "Create Campaign", icon: Send },
    { href: "/email-marketing/campaigns", label: "All Campaigns", icon: Mail },
    { href: "/email-marketing/groups", label: "Recipient Groups", icon: Users },
    { href: "/email-marketing/templates", label: "Email Templates", icon: LayoutTemplate },
    { href: "/email-marketing/outbox", label: "Outbox & Sent", icon: Inbox },
    { href: "/email-marketing/replies", label: "Replies & Engagement", icon: MessageSquareReply },
    { href: "/email-marketing/suppressions", label: "Unsubscribed", icon: Ban },
  ] },
  { id: "reports", label: "Reports & Analytics", icon: BarChart3, items: [
    { href: "/finance/reports", label: "Finance Reports", icon: FileBarChart },
    { href: "/email-marketing/analytics", label: "Email Analytics", icon: BarChart3 },
  ] },
  { id: "settings", label: "Settings", icon: Settings, items: [
    { href: "/settings", label: "Company & Profile", icon: Settings },
    { href: "/settings/documents", label: "Documents & Bank", icon: FileText },
    { href: "/email-marketing/settings", label: "Email Configuration", icon: SlidersHorizontal },
    { href: "/settings/app-installs", label: "App Installations", icon: MonitorSmartphone, adminOnly: true },
  ] },
];

/** The menu entry for a path: the longest href that is the path or a parent of it ("/finance/reports" wins over "/finance"). */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const h of hrefs) {
    const match = h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`);
    if (match && (!best || h.length > best.length)) best = h;
  }
  return best;
}

const STORAGE_KEY = "nafa.nav.open";

export function SidebarNav({ collapsed, isAdmin, onNavigate }: { collapsed?: boolean; isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || isAdmin) })).filter((g) => g.items.length);
  const active = activeHref(pathname, groups.flatMap((g) => g.items.map((i) => i.href)));
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === active))?.id ?? null;

  // Which sections are expanded. The section of the current page is always open; the rest is remembered on this device.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved preference after hydration
      setOpen(saved && typeof saved === "object" ? saved : {});
    } catch { /* private mode: sections simply start closed */ }
  }, []);
  const isOpen = (id: string) => open[id] ?? id === activeGroup;
  const toggle = (id: string) => setOpen((cur) => {
    const next = { ...cur, [id]: !(cur[id] ?? id === activeGroup) };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // Collapsed (icon-only) sidebar: the submenu opens as a fly-out beside the icon, on hover or click.
  const [fly, setFly] = useState<{ id: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFly = (id: string, el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFly({ id, top: Math.max(8, Math.min(el.getBoundingClientRect().top, window.innerHeight - 320)) });
  };
  const hideFlySoon = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setFly(null), 180); };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fly-out belongs to the page that was just left
    setFly(null);
  }, [pathname, collapsed]);
  useEffect(() => {
    if (!fly) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFly(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fly]);

  const link = (i: Item, inFly = false) => {
    const on = i.href === active;
    return (
      <Link
        key={i.href} href={i.href} onClick={() => { setFly(null); onNavigate?.(); }} aria-current={on ? "page" : undefined}
        className={cn(
          "group relative flex h-8 items-center gap-2.5 rounded-md pr-2 text-[13px] font-medium transition-colors",
          inFly ? "px-2.5 text-foreground hover:bg-surface-muted" : "pl-9 text-nav-muted hover:bg-nav-hover hover:text-nav-foreground",
          on && (inFly ? "bg-accent-soft font-semibold text-accent" : "bg-nav-active font-semibold text-nav-foreground"),
        )}
      >
        {inFly && <i.icon className={cn("h-4 w-4 shrink-0", on ? "text-accent" : "text-muted")} aria-hidden />}
        <span className="truncate">{i.label}</span>
        {on && !inFly && <span className="absolute left-5 top-2 bottom-2 w-0.5 rounded-full bg-accent" aria-hidden />}
      </Link>
    );
  };

  if (collapsed) {
    const flyGroup = fly ? groups.find((g) => g.id === fly.id) : null;
    return (
      <nav aria-label="Main" className="flex flex-col gap-1 px-2.5" onMouseLeave={hideFlySoon}>
        {groups.map((g) => {
          const on = g.id === activeGroup;
          return (
            <button
              key={g.id} type="button" aria-label={g.label} aria-haspopup="menu" aria-expanded={fly?.id === g.id}
              onMouseEnter={(e) => showFly(g.id, e.currentTarget)} onFocus={(e) => showFly(g.id, e.currentTarget)}
              onClick={(e) => (fly?.id === g.id ? setFly(null) : showFly(g.id, e.currentTarget))}
              className={cn("relative flex h-9 w-full cursor-pointer items-center justify-center rounded-md text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground", on && "bg-nav-active text-nav-foreground")}
            >
              <g.icon className={cn("h-4 w-4", on && "text-accent")} aria-hidden />
              {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent" aria-hidden />}
            </button>
          );
        })}
        {flyGroup && fly && (
          <div
            role="menu" aria-label={flyGroup.label} style={{ top: fly.top }}
            className="fixed left-16 z-50 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-xl"
            onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onMouseLeave={hideFlySoon}
          >
            <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{flyGroup.label}</p>
            {flyGroup.items.map((i) => link(i, true))}
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2.5">
      {groups.map((g) => {
        const expanded = isOpen(g.id);
        const on = g.id === activeGroup;
        return (
          <div key={g.id}>
            <button
              type="button" onClick={() => toggle(g.id)} aria-expanded={expanded} aria-controls={`nav-${g.id}`}
              className={cn("flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground", on && "text-nav-foreground")}
            >
              <g.icon className={cn("h-4 w-4 shrink-0", on ? "text-accent" : "text-nav-muted")} aria-hidden />
              <span className="flex-1 truncate text-left">{g.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
            </button>
            {expanded && <div id={`nav-${g.id}`} className="mb-1 mt-0.5 flex flex-col gap-0.5">{g.items.map((i) => link(i))}</div>}
          </div>
        );
      })}
    </nav>
  );
}
