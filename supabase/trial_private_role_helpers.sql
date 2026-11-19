-- Private role predicates required by the trial's RLS policies and RPCs.
-- These read only the signed-in user's server-controlled profile role.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('secretary','doctor','owner'));
$$;
create or replace function private.is_doctor() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('doctor','owner'));
$$;
revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_doctor() from public, anon;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_doctor() to authenticated;
commit;
