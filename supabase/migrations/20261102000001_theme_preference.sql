-- NAFA Business OS — per-user colour theme preference
--
-- profiles.theme_preference: 'light' (default, the existing look), 'dark', or 'system' (follow the device).
-- Clients can only update profiles.full_name, so the preference is written through a function that can touch
-- the caller's own row and nothing else (role / is_active stay protected).

alter table public.profiles
  add column theme_preference text not null default 'light'
  check (theme_preference in ('light', 'dark', 'system'));

create function public.set_theme_preference(p_theme text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_team_member() then raise exception 'NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_theme is null or p_theme not in ('light', 'dark', 'system') then raise exception 'INVALID_THEME' using errcode = '22023'; end if;
  update public.profiles set theme_preference = p_theme where id = auth.uid();
end $$;
revoke all on function public.set_theme_preference(text) from public, anon;
grant execute on function public.set_theme_preference(text) to authenticated;
