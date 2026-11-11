-- NAFA Business OS — Web Push subscriptions (notifications on the installed mobile / desktop app)
--
-- One row per (user, browser/device). The browser creates the subscription; the server uses it to deliver push messages.
-- A person sees and manages only their own devices. Sending happens server-side with the service role (which reads every row).
-- Dead subscriptions (the browser reports 404/410) are deleted by the sender.

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  platform        text not null default '' check (length(platform) <= 40),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;

create policy push_subs_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subs_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_team_member());
create policy push_subs_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
