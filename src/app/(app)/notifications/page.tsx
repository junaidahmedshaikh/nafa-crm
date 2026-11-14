import Link from "next/link";
import { NotificationList, NotificationPreferences, type NotificationItem } from "@/components/notifications/notification-centre";
import { FilterForm } from "@/components/shared/filter-form";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, PageHeader, Pagination } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange } from "@/lib/lead-filters";
import { NOTIFICATION_TYPES } from "@/lib/scheduled/core";

export const metadata = { title: "Notifications" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const sp = await searchParams;
  const type = one(sp.type) in NOTIFICATION_TYPES ? one(sp.type) : "";
  const show = one(sp.show) === "unread" ? "unread" : "";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const { supabase, profile, user } = await requireMember();

  const [from, to] = pageRange(page);
  // RLS limits every query here to the signed-in person's own notifications.
  let q = supabase.from("notifications").select("id, type, title, body, data, read_at, created_at", { count: "exact" });
  if (type) q = q.eq("type", type);
  if (show) q = q.is("read_at", null);
  const [list, unread, prefs] = await Promise.all([
    q.order("created_at", { ascending: false }).range(from, to),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("notification_preferences").select("muted_types").eq("user_id", user.id).maybeSingle(),
  ]);
  const href = (n: number) => `/notifications?${new URLSearchParams({ ...(type && { type }), ...(show && { show }), page: String(n) })}`;

  return (
    <>
      <PageHeader title="Notifications" description="Payments, invoices falling due, scheduled emails, follow-ups and project finance alerts." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <FilterForm basePath="/notifications" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <Select name="type" aria-label="Notification type" defaultValue={type} className="w-64">
              <option value="">All types</option>
              {Object.entries(NOTIFICATION_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
            <Select name="show" aria-label="Read status" defaultValue={show} className="w-40"><option value="">Read and unread</option><option value="unread">Unread only</option></Select>
            {(type || show) && <Link href="/notifications" className="text-sm text-accent hover:underline">Clear</Link>}
          </FilterForm>
          <NotificationList items={(list.data ?? []) as NotificationItem[]} isAdmin={profile.role === "admin"} unread={unread.count ?? 0} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.count ?? 0} hrefFor={href} />
        </Card>
        <Card className="self-start">
          <CardHeader title="My notification preferences" />
          <NotificationPreferences muted={(prefs.data?.muted_types as string[] | undefined) ?? []} />
        </Card>
      </div>
    </>
  );
}
