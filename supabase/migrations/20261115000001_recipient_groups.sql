-- NAFA Business OS — Recipient Groups (AI Email Marketing)
--
-- Groups organise the EXISTING contacts; no contact data is copied.
--   recipient_groups           a static list (people are assigned) or a dynamic list (saved filter conditions, always up to date)
--   contact_recipient_groups   many-to-many: contacts.id <-> recipient_groups.id (static groups only)
--   recipient_group_audit      history of bulk changes (who, what, how many)
-- Dynamic membership is evaluated when read, so it can never drift out of sync with the Contacts data.
--
-- Rollback (if ever needed):
--   drop table public.recipient_group_audit; drop table public.contact_recipient_groups; drop table public.recipient_groups;

create table public.recipient_groups (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 120),
  description       text not null default '',
  group_type        text not null default 'static' check (group_type in ('static', 'dynamic')),
  business_category text not null default '',
  target_industry   text not null default '',
  location          text not null default '',
  filter_conditions jsonb not null default '{}'::jsonb,       -- used by dynamic groups
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index recipient_groups_name_key on public.recipient_groups (lower(btrim(name)));
create trigger recipient_groups_updated_at before update on public.recipient_groups
  for each row execute function public.set_updated_at();

create table public.contact_recipient_groups (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  group_id    uuid not null references public.recipient_groups (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (contact_id, group_id)                                -- a contact is in a group at most once
);
create index contact_recipient_groups_group_idx on public.contact_recipient_groups (group_id);
create index contact_recipient_groups_contact_idx on public.contact_recipient_groups (contact_id);

create table public.recipient_group_audit (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,                                    -- assign | unassign | create_group | update_group | delete_group | archive_group | bulk_industry | bulk_status | import
  group_id   uuid references public.recipient_groups (id) on delete set null,
  details    jsonb not null default '{}'::jsonb,               -- counts, group names, a capped sample of contact ids
  actor      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index recipient_group_audit_idx on public.recipient_group_audit (created_at desc);

-- ---------------------------------------------------------------------------
revoke all on public.recipient_groups, public.contact_recipient_groups, public.recipient_group_audit from anon, authenticated;
grant select, insert, update, delete on public.recipient_groups to authenticated;
grant select, insert, delete on public.contact_recipient_groups to authenticated;
grant select, insert on public.recipient_group_audit to authenticated;

alter table public.recipient_groups         enable row level security;
alter table public.contact_recipient_groups enable row level security;
alter table public.recipient_group_audit    enable row level security;

create policy rg_select on public.recipient_groups for select to authenticated using (public.is_team_member());
create policy rg_insert on public.recipient_groups for insert to authenticated with check (public.is_team_member());
create policy rg_update on public.recipient_groups for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy rg_delete on public.recipient_groups for delete to authenticated using (public.is_admin());      -- only an administrator deletes a group

create policy crg_select on public.contact_recipient_groups for select to authenticated using (public.is_team_member());
create policy crg_insert on public.contact_recipient_groups for insert to authenticated with check (public.is_team_member());
create policy crg_delete on public.contact_recipient_groups for delete to authenticated using (public.is_team_member());

create policy rga_select on public.recipient_group_audit for select to authenticated using (public.is_team_member());
create policy rga_insert on public.recipient_group_audit for insert to authenticated with check (public.is_team_member());
