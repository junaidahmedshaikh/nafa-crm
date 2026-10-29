-- OPTIONAL one-off: fills Settings -> Documents with the details printed on the original NAFA invoice template.
-- Review every value, then run ONCE in the Supabase SQL editor (it needs database privileges, like admin-setup.sql).
-- These are the business's own payment details; they are readable only by signed-in team members and are never
-- exposed on public pages. You can also type them in the app instead: Settings -> Documents (admins only).
update public.document_settings set
  bank_account_holder = 'Junaid Ahmed Shaikh',
  bank_name           = 'Federal Bank',
  bank_account_number = '55550106323601',
  bank_ifsc           = 'FDRL0001505',
  bank_upi_id         = 'junaid.ahmedshaikh@federal';
