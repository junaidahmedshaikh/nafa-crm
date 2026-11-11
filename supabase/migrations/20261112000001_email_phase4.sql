-- NAFA Business OS — AI Email Marketing, Phase 4: replies, follow-up sequences, A/B versions, delivery events.
--
--   email_sequence_steps     follow-up steps (Day N after the previous email) for a campaign; editable only while the campaign is a draft
--   email_campaign_variants  extra versions (B, C, D) of a campaign's first email; version A is the campaign's own subject/body
--   email_events             provider events (delivered / bounced / complained / opened / clicked), written by the webhook
--   email_replies            replies matched to a recipient, with AI category + suggested response (never auto-sent)
--   email_recipients         gains step + variant; uniqueness becomes (campaign, address, step) so follow-ups are separate queue rows

alter table public.email_campaigns add column template_id uuid references public.email_templates (id) on delete set null;

alter table public.email_recipients
  add column step    integer not null default 0 check (step between 0 and 10),
  add column variant text;
alter table public.email_recipients drop constraint email_recipients_campaign_id_email_normalized_key;
alter table public.email_recipients add constraint email_recipients_campaign_email_step_key unique (campaign_id, email_normalized, step);
create index email_recipients_provider_idx on public.email_recipients (provider_id) where provider_id is not null;

create table public.email_sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  step        integer not null check (step between 1 and 10),
  delay_days  integer not null check (delay_days between 1 and 60),   -- days after the previous email was sent
  subject     text not null default '',
  body_html   text not null default '',
  created_at  timestamptz not null default now(),
  unique (campaign_id, step)
);

create table public.email_campaign_variants (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  label       text not null check (label in ('B', 'C', 'D')),
  subject     text not null default '',
  body_html   text not null default '',
  created_at  timestamptz not null default now(),
  unique (campaign_id, label)
);

create table public.email_events (
  id                uuid primary key default gen_random_uuid(),
  recipient_id      uuid references public.email_recipients (id) on delete cascade,
  campaign_id       uuid references public.email_campaigns (id) on delete cascade,
  type              text not null check (type in ('delivered', 'bounced', 'complained', 'opened', 'clicked', 'delivery_delayed')),
  detail            text,                                          -- clicked URL, bounce type…
  provider_event_id text unique,                                   -- de-duplicates webhook retries
  occurred_at       timestamptz not null default now()
);
create index email_events_campaign_idx on public.email_events (campaign_id, type);
create index email_events_recipient_idx on public.email_events (recipient_id);

create table public.email_replies (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid references public.email_campaigns (id) on delete set null,
  recipient_id        uuid references public.email_recipients (id) on delete set null,
  contact_id          uuid references public.contacts (id) on delete set null,
  from_email          text not null,
  from_normalized     text not null,
  subject             text not null default '',
  body_text           text not null default '',
  received_at         timestamptz not null default now(),
  source              text not null default 'manual' check (source in ('gmail', 'manual')),
  provider_message_id text unique,
  category            text check (category in ('interested', 'not_interested', 'request_for_details', 'meeting_request', 'price_enquiry', 'follow_up_later', 'out_of_office', 'unsubscribe')),
  summary             text,
  suggested_reply     text,                                        -- AI draft; a human must edit and send it
  handled             boolean not null default false,
  lead_id             uuid references public.leads (id) on delete set null,
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index email_replies_campaign_idx on public.email_replies (campaign_id, received_at desc);
create index email_replies_from_idx on public.email_replies (from_normalized);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
revoke all on public.email_sequence_steps, public.email_campaign_variants, public.email_events, public.email_replies from anon, authenticated;
grant select, insert, update, delete on public.email_sequence_steps, public.email_campaign_variants to authenticated;
grant select on public.email_events to authenticated;
grant select, insert, update on public.email_replies to authenticated;

alter table public.email_sequence_steps    enable row level security;
alter table public.email_campaign_variants enable row level security;
alter table public.email_events            enable row level security;
alter table public.email_replies           enable row level security;

create policy email_seq_select on public.email_sequence_steps for select to authenticated using (public.is_team_member());
create policy email_seq_write on public.email_sequence_steps for all to authenticated
  using (public.is_team_member() and exists (select 1 from public.email_campaigns c where c.id = campaign_id and c.status = 'draft'))
  with check (public.is_team_member() and exists (select 1 from public.email_campaigns c where c.id = campaign_id and c.status = 'draft'));

create policy email_var_select on public.email_campaign_variants for select to authenticated using (public.is_team_member());
create policy email_var_write on public.email_campaign_variants for all to authenticated
  using (public.is_team_member() and exists (select 1 from public.email_campaigns c where c.id = campaign_id and c.status = 'draft'))
  with check (public.is_team_member() and exists (select 1 from public.email_campaigns c where c.id = campaign_id and c.status = 'draft'));

create policy email_events_select on public.email_events for select to authenticated using (public.is_team_member());   -- writes: service role only (webhook)

create policy email_replies_select on public.email_replies for select to authenticated using (public.is_team_member());
create policy email_replies_insert on public.email_replies for insert to authenticated with check (public.is_team_member());
create policy email_replies_update on public.email_replies for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
