-- Removes the starter email templates that an earlier version of 20261111000001_email_marketing.sql seeded.
-- Only untouched system rows are deleted; templates your team created are kept. Safe to run more than once.
delete from public.email_templates where is_system;
