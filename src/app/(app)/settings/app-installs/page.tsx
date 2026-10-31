import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { StatCard } from "@/components/finance/bits";
import { AlertSettingsForm } from "@/components/pwa/alert-settings-form";
import { FilterForm } from "@/components/shared/filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { Input } from "@/components/ui/form";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { todayIST } from "@/lib/documents/repo";
import { RANGE_LABELS, RANGE_PRESETS, isRangePreset, resolveRange } from "@/lib/finance/range";
import { emailConfigured } from "@/lib/documents/email";
import { PLATFORM_LABELS } from "@/lib/pwa/device";
import { DEVICE_FILTERS, STATUS_FILTERS, getAlertSettings, getInstallAnalytics } from "@/lib/pwa/repo";

export const metadata = { title: "App installations" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AppInstallsPage({ searchParams }: PageProps<"/settings/app-installs">) {
  const sp = await searchParams;
  const { supabase, profile } = await requireMember();
  if (profile.role !== "admin") {
    return (
      <>
        <PageHeader title="App installations" />
        <Card><EmptyState icon={MonitorSmartphone} title="Administrators only" description="Installation analytics are visible to administrators." /></Card>
      </>
    );
  }

  const preset = isRangePreset(one(sp.range)) ? (one(sp.range) as (typeof RANGE_PRESETS)[number]) : "all";
  const today = todayIST();
  const range = resolveRange(preset, today, { from: one(sp.from), to: one(sp.to) });
  const device = (DEVICE_FILTERS as readonly string[]).includes(one(sp.device)) ? one(sp.device) : "";
  const status = (STATUS_FILTERS as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "";
  const user = one(sp.user);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);

  const [data, settings] = await Promise.all([
    getInstallAnalytics(supabase, { ...range, user, device, status, page }, today),
    getAlertSettings(supabase),
  ]);
  const { totals: t } = data;
  const href = (n: number) => `/settings/app-installs?${new URLSearchParams({ ...(preset !== "all" && { range: preset }), ...(range.from && preset === "custom" && { from: range.from }), ...(range.to && preset === "custom" && { to: range.to }), ...(user && { user }), ...(device && { device }), ...(status && { status }), page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="App installations"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "App installations" }]}
        description="Who installed the CRM as an app, on which device, and when. A normal browser visit is not counted."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Registered users" value={String(t.registeredUsers)} hint={`${t.usersWithApp} have the app`} />
        <StatCard label="Total installations" value={String(t.installs)} hint={`${t.launched} opened at least once`} />
        <StatCard label="New today" value={String(t.today)} tone={t.today > 0 ? "good" : "neutral"} />
        <StatCard label="Android" value={String(t.android)} />
        <StatCard label="iOS" value={String(t.ios)} />
        <StatCard label="Desktop" value={String(t.desktop)} hint="Windows, macOS, Linux" />
      </div>

      <Card className="mt-4">
        <CardHeader title="Installation activity" />
        <FilterForm basePath="/settings/app-installs" className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Select name="range" aria-label="Period" defaultValue={preset}>{RANGE_PRESETS.map((p) => <option key={p} value={p}>{RANGE_LABELS[p]}</option>)}</Select>
          <Select name="user" aria-label="User" defaultValue={user}><option value="">All users</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name || "Unnamed"}</option>)}</Select>
          <Select name="device" aria-label="Device type" defaultValue={device}><option value="">All devices</option><option value="android">Android</option><option value="ios">iOS</option><option value="desktop">Desktop</option><option value="other">Other</option></Select>
          <Select name="status" aria-label="Status" defaultValue={status}><option value="">Any status</option><option value="installed">Installed, not opened yet</option><option value="launched">Opened</option></Select>
          <div className="flex items-center gap-3"><Button type="submit" variant="primary" size="sm">Apply</Button><Link href="/settings/app-installs" className="text-sm text-muted hover:underline">Reset</Link></div>
          {preset === "custom" && (
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5"><Input type="date" name="from" aria-label="From date" defaultValue={range.from ?? ""} className="w-44" /><span className="text-sm text-muted">to</span><Input type="date" name="to" aria-label="To date" defaultValue={range.to ?? ""} className="w-44" /></div>
          )}
        </FilterForm>
        {data.rows.length === 0 ? (
          <EmptyState icon={MonitorSmartphone} title="No installations yet" description="They appear here as soon as someone installs the app or opens it from their home screen." />
        ) : (
          <>
            <DataTable className="min-w-[860px]">
              <thead><tr><Th>Installed</Th><Th>User</Th><Th>Device</Th><Th>Browser</Th><Th>Source</Th><Th>Status</Th><Th>First opened</Th><Th>Last active</Th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted">
                    <Td className="whitespace-nowrap">{formatDateTime(r.installed_at)}</Td>
                    <Td><p className="font-medium">{r.user_name}</p><p className="text-xs text-muted">{r.user_email}</p></Td>
                    <Td>{PLATFORM_LABELS[r.platform]}</Td>
                    <Td>{r.browser || "—"}</Td>
                    <Td>{r.source === "home_screen" ? "Home screen" : "PWA install"}</Td>
                    <Td>{r.status === "launched" ? <Badge tone="success">Opened</Badge> : <Badge tone="warning">Not opened yet</Badge>}</Td>
                    <Td className="whitespace-nowrap">{r.first_launch_at ? formatDateTime(r.first_launch_at) : "—"}</Td>
                    <Td className="whitespace-nowrap">{r.last_active_at ? formatDateTime(r.last_active_at) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} hrefFor={href} />
          </>
        )}
      </Card>

      {data.byUser.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="User-wise installation history" />
          <DataTable>
            <thead><tr><Th>User</Th><Th className="text-right">Devices</Th><Th>Devices used</Th><Th>First installed</Th><Th>Last active</Th></tr></thead>
            <tbody>
              {data.byUser.map((u) => {
                const sorted = [...u.devices].sort((a, b) => a.installed_at.localeCompare(b.installed_at));
                const lastActive = u.devices.map((d) => d.last_active_at).filter(Boolean).sort().pop();
                return (
                  <tr key={u.user_id} className="hover:bg-surface-muted">
                    <Td><Link href={`/settings/app-installs?user=${u.user_id}`} className="font-medium hover:underline">{u.name}</Link><p className="text-xs text-muted">{u.email}</p></Td>
                    <Td className="text-right tabular-nums">{u.devices.length}</Td>
                    <Td>{sorted.map((d) => `${PLATFORM_LABELS[d.platform]} (${d.browser || "—"})`).join(", ")}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(sorted[0].installed_at)}</Td>
                    <Td className="whitespace-nowrap">{lastActive ? formatDateTime(lastActive) : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Notification preferences" />
        <div className="p-5">
          {settings ? <AlertSettingsForm settings={settings} people={data.people} emailAvailable={emailConfigured()} /> : <p className="text-sm text-muted">Settings could not be loaded. Have the App installations migration been applied?</p>}
        </div>
      </Card>
    </>
  );
}
