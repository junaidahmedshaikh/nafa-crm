-- NAFA Business OS — App installation tracking and in-app notifications
--
-- notifications          generic per-user inbox (this is the only notification system; the bell reads it)
-- app_installs           one row per (user, device): who installed the PWA, on what, when, first launch, last activity
-- install_alert_settings singleton: who gets install alerts and by which channel
-- record_app_install()   the ONLY way rows are written; de-duplicates per (user, device) and creates the alerts once
--
-- Privacy: device_id is a random identifier generated in the browser; platform and browser are coarse names.
-- No contacts, files, location, IP address or user-agent string is stored.

create type public.install_platform as enum ('android', 'ios', 'windows', 'macos', 'linux', 'other');
create type public.install_source as enum ('pwa', 'home_screen');
create type public.install_status as enum ('installed', 'launched');

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_install_idx on public.notifications ((data ->> 'install_id')) where type = 'app_install';

create table public.app_installs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  user_email      text not null default '',
  device_id       text not null check (length(device_id) between 16 and 64),
  platform        public.install_platform not null,
  browser         text not null default '' check (length(browser) <= 40),
  source          public.install_source not null,
  status          public.install_status not null default 'installed',
  installed_at    timestamptz not null default now(),
  first_launch_at timestamptz,
  last_active_at  timestamptz,
  unique (user_id, device_id)
);
create index app_installs_installed_idx on public.app_installs (installed_at desc);
create index app_installs_platform_idx on public.app_installs (platform);

create table public.install_alert_settings (
  id               boolean primary key default true check (id),
  enabled          boolean not null default true,
  extra_recipients uuid[] not null default '{}',       -- in addition to every active admin
  email_enabled    boolean not null default false,
  alert_emails     text[] not null default '{}'        -- delivery addresses for email alerts (needs RESEND_API_KEY)
);
insert into public.install_alert_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.app_installs enable row level security;
alter table public.install_alert_settings enable row level security;
revoke all on public.notifications, public.app_installs, public.install_alert_settings from anon, authenticated;

-- A person sees and clears only their own notifications; nobody inserts directly.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Installation analytics: administrators only.
grant select on public.app_installs to authenticated;
create policy app_installs_select on public.app_installs for select to authenticated using ((select public.is_admin()));

grant select, update on public.install_alert_settings to authenticated;
create policy install_alert_settings_select on public.install_alert_settings for select to authenticated using ((select public.is_admin()));
create policy install_alert_settings_update on public.install_alert_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Live updates for the bell (Supabase Realtime obeys the RLS above). Skipped where Realtime is not installed.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create view public.app_install_list with (security_invoker = true) as
select i.id, i.user_id, coalesce(nullif(p.full_name, ''), i.user_email) as user_name, i.user_email, i.device_id, i.platform, i.browser, i.source,
       i.status, i.installed_at, i.first_launch_at, i.last_active_at
from public.app_installs i
join public.profiles p on p.id = i.user_id;
revoke all on public.app_install_list from anon;
grant select on public.app_install_list to authenticated;

-- ---------------------------------------------------------------------------
-- record_app_install
--   p_event: 'installed' (appinstalled / add-to-home-screen detected), 'launched' (running as an installed app),
--            'active' (heartbeat while running as an installed app).
--   An ordinary browser visit is never reported by the client and 'active' alone never creates an installation.
--   Alerts are created exactly once per (user, device): when the installation row is first created.
-- ---------------------------------------------------------------------------
create function public.record_app_install(p_device_id text, p_platform text, p_browser text, p_source text, p_event text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_platform public.install_platform;
  v_source   public.install_source;
  v_row      public.app_installs;
  v_new      boolean := false;
  v_launched boolean := false;
  v_name     text;
  v_email    text;
  v_label    text;
  v_nth      integer;
  v_settings public.install_alert_settings;
  v_body     text;
begin
  if not public.is_team_member() then raise exception 'NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_event not in ('installed', 'launched', 'active') then raise exception 'INVALID_EVENT' using errcode = '22023'; end if;
  if p_device_id is null or length(p_device_id) not between 16 and 64 then raise exception 'INVALID_DEVICE' using errcode = '22023'; end if;

  v_platform := case when p_platform in ('android', 'ios', 'windows', 'macos', 'linux') then p_platform::public.install_platform else 'other' end;
  v_source := case when p_source = 'home_screen' then 'home_screen'::public.install_source else 'pwa'::public.install_source end;

  select * into v_row from public.app_installs where user_id = v_user and device_id = p_device_id for update;

  if not found then
    if p_event = 'active' then return jsonb_build_object('recorded', false); end if;   -- a heartbeat is not an installation
    select u.email into v_email from auth.users u where u.id = v_user;
    insert into public.app_installs (user_id, user_email, device_id, platform, browser, source, status, first_launch_at, last_active_at)
    values (v_user, coalesce(v_email, ''), p_device_id, v_platform, left(coalesce(p_browser, ''), 40), v_source,
            case when p_event = 'launched' then 'launched'::public.install_status else 'installed'::public.install_status end,
            case when p_event = 'launched' then now() end, now())
    on conflict (user_id, device_id) do nothing
    returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.app_installs where user_id = v_user and device_id = p_device_id;   -- lost a race: someone else created it
    else
      v_new := true;
    end if;
  else
    if p_event = 'launched' and v_row.first_launch_at is null then
      update public.app_installs set first_launch_at = now(), status = 'launched', last_active_at = now() where id = v_row.id returning * into v_row;
      v_launched := true;
    else
      update public.app_installs set last_active_at = now() where id = v_row.id returning * into v_row;
    end if;
  end if;

  if v_launched then
    -- first launch after the install alert was raised: add the timestamp to that alert instead of sending a second one
    update public.notifications
       set data = data || jsonb_build_object('first_launch_at', v_row.first_launch_at)
     where type = 'app_install' and data ->> 'install_id' = v_row.id::text;
  end if;

  if v_new then
    select * into v_settings from public.install_alert_settings;
    select coalesce(nullif(p.full_name, ''), v_row.user_email, 'A team member') into v_name from public.profiles p where p.id = v_user;
    select count(*) into v_nth from public.app_installs where user_id = v_user;
    v_label := case v_platform when 'android' then 'an Android' when 'ios' then 'an iPhone/iPad' when 'windows' then 'a Windows' when 'macos' then 'a macOS'
                               when 'linux' then 'a Linux' else 'a' end;
    v_body := v_name || case when v_source = 'home_screen' then ' has added the NAFA CRM app to the home screen of ' else ' has installed the NAFA CRM app on ' end
              || v_label || ' device' || case when v_nth > 1 then ' (device no. ' || v_nth || ' for this user).' else '.' end;
    if v_settings.enabled then
      insert into public.notifications (user_id, type, title, body, data)
      select p.id, 'app_install', 'New CRM App Installation', v_body,
             jsonb_build_object('install_id', v_row.id, 'user_id', v_user, 'user_name', v_name, 'user_email', v_row.user_email, 'platform', v_row.platform,
                                'browser', v_row.browser, 'source', v_row.source, 'installed_at', v_row.installed_at, 'first_launch_at', v_row.first_launch_at,
                                'device_number', v_nth)
      from public.profiles p
      where p.is_active and p.id <> v_user and (p.role = 'admin' or p.id = any (v_settings.extra_recipients));
    end if;
    return jsonb_build_object('recorded', true, 'created', true, 'install_id', v_row.id, 'message', v_body,
                              'email_to', case when v_settings.enabled and v_settings.email_enabled then to_jsonb(v_settings.alert_emails) else '[]'::jsonb end);
  end if;
  return jsonb_build_object('recorded', true, 'created', false, 'install_id', v_row.id);
end $$;
revoke all on function public.record_app_install(text, text, text, text, text) from public, anon;
grant execute on function public.record_app_install(text, text, text, text, text) to authenticated;
