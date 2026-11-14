-- Send by Email (invoices & quotations): the email log gains CC / BCC and the name of the PDF that was attached.
-- Additive and idempotent: existing rows keep working (no CC/BCC, attachment name unknown). The table stays append-only
-- (authenticated has select + insert only), so these columns are covered by the existing grants and RLS policies.
alter table public.document_emails
  add column if not exists cc_emails       text[] not null default '{}',
  add column if not exists bcc_emails      text[] not null default '{}',
  add column if not exists attachment_name text;
