-- NAFA Business OS — create the initial admin (run ONCE, as a database administrator)
--
-- 1. Supabase Dashboard -> Authentication -> Users -> "Add user" -> "Create new user".
--    Enter the owner's email and a strong password, tick "Auto Confirm User".
-- 2. Supabase Dashboard -> Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up".
-- 3. Supabase Dashboard -> SQL Editor -> replace the email below with the owner's email and run this script.
--    (The SQL editor runs with database privileges; the browser/anon key can never do this.)
--
-- Anyone else who somehow obtains an auth account still gets no data: RLS requires an active profile row.

insert into public.profiles (id, full_name, role, is_active)
select u.id,
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
       'admin',
       true
from auth.users u
where lower(u.email) = lower('junaid.shaikh0708@gmail.com')      
on conflict (id) do update set role = 'admin', is_active = true;

-- Verify: should return exactly one row with role = admin
select p.id, u.email, p.role, p.is_active
from public.profiles p join auth.users u on u.id = p.id;
