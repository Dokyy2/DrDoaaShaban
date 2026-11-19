-- Clinic team management: doctor-only role changes and atomic five-seat cap.
-- Apply only to the isolated trial database after reviewing the target project.
begin;

create table if not exists private.clinic_team_invite_reservations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role public.user_role not null check (role in ('secretary', 'doctor')),
  reserved_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
revoke all on private.clinic_team_invite_reservations from public, anon, authenticated;

create table if not exists public.clinic_team_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_email text not null,
  action text not null check (action in ('invited', 'role_changed', 'access_suspended', 'access_restored')),
  old_role public.user_role,
  new_role public.user_role,
  created_at timestamptz not null default now()
);
alter table public.clinic_team_events enable row level security;
revoke all on public.clinic_team_events from public, anon, authenticated;
grant select (id, actor_id, target_user_id, target_email, action, old_role, new_role, created_at)
  on public.clinic_team_events to authenticated;
drop policy if exists "doctor reads clinic team audit" on public.clinic_team_events;
create policy "doctor reads clinic team audit" on public.clinic_team_events
  for select to authenticated using (private.is_doctor());

create or replace function public.reserve_clinic_team_invite(p_email text, p_role public.user_role)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_id uuid;
  v_active integer;
  v_reserved integer;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if p_role not in ('secretary', 'doctor') or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid team invitation' using errcode = '22023';
  end if;

  -- Serialize seat reservations and role promotions through the singleton row.
  perform 1 from public.clinic_settings where id = true for update;
  delete from private.clinic_team_invite_reservations where expires_at <= now();
  select count(*) into v_active from public.profiles where role in ('secretary', 'doctor');
  select count(*) into v_reserved from private.clinic_team_invite_reservations;
  if v_active + v_reserved >= 5 then
    raise exception 'clinic team limit reached' using errcode = '54000';
  end if;
  insert into private.clinic_team_invite_reservations(email, role, reserved_by)
    values (v_email, p_role, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.release_clinic_team_invite(p_reservation_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  delete from private.clinic_team_invite_reservations
    where id = p_reservation_id and reserved_by = auth.uid();
end;
$$;

create or replace function public.complete_clinic_team_invite(
  p_reservation_id uuid, p_user_id uuid, p_full_name text
) returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_reservation private.clinic_team_invite_reservations%rowtype;
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if p_user_id is null or length(btrim(coalesce(p_full_name, ''))) not between 2 and 100 then
    raise exception 'invalid team invitation' using errcode = '22023';
  end if;
  perform 1 from public.clinic_settings where id = true for update;
  select * into v_reservation from private.clinic_team_invite_reservations
    where id = p_reservation_id and reserved_by = auth.uid() and expires_at > now() for update;
  if not found then raise exception 'team invitation reservation expired' using errcode = 'P0002'; end if;
  update public.profiles set full_name = btrim(p_full_name), role = v_reservation.role
    where id = p_user_id and role = 'pending';
  if not found then raise exception 'team profile not found or already active' using errcode = '23514'; end if;
  insert into public.clinic_team_events(actor_id, target_user_id, target_email, action, old_role, new_role)
    values (auth.uid(), p_user_id, v_reservation.email, 'invited', 'pending', v_reservation.role);
  delete from private.clinic_team_invite_reservations where id = p_reservation_id;
end;
$$;

create or replace function public.change_clinic_team_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_old_role public.user_role;
  v_active integer;
  v_reserved integer;
  v_email text;
  v_action text;
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() or p_role not in ('secretary', 'doctor', 'pending') then
    raise exception 'invalid team role change' using errcode = '22023';
  end if;
  perform 1 from public.clinic_settings where id = true for update;
  select role into v_old_role from public.profiles where id = p_user_id for update;
  if not found then raise exception 'team member not found' using errcode = 'P0002'; end if;
  if v_old_role = 'doctor' and p_role <> 'doctor' and
      (select count(*) from public.profiles where role = 'doctor') <= 1 then
    raise exception 'cannot remove the last doctor' using errcode = '23514';
  end if;
  if v_old_role = 'pending' and p_role in ('secretary', 'doctor') then
    delete from private.clinic_team_invite_reservations where expires_at <= now();
    select count(*) into v_active from public.profiles where role in ('secretary', 'doctor');
    select count(*) into v_reserved from private.clinic_team_invite_reservations;
    if v_active + v_reserved >= 5 then
      raise exception 'clinic team limit reached' using errcode = '54000';
    end if;
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if p_role = v_old_role then return; end if;
  v_action := case
    when p_role = 'pending' then 'access_suspended'
    when v_old_role = 'pending' then 'access_restored'
    else 'role_changed'
  end;
  update public.profiles set role = p_role where id = p_user_id;
  insert into public.clinic_team_events(actor_id, target_user_id, target_email, action, old_role, new_role)
    values (auth.uid(), p_user_id, coalesce(v_email, ''), v_action, v_old_role, p_role);
end;
$$;

revoke all on function public.reserve_clinic_team_invite(text, public.user_role) from public, anon;
revoke all on function public.release_clinic_team_invite(uuid) from public, anon;
revoke all on function public.complete_clinic_team_invite(uuid, uuid, text) from public, anon;
revoke all on function public.change_clinic_team_role(uuid, public.user_role) from public, anon;
grant execute on function public.reserve_clinic_team_invite(text, public.user_role) to authenticated;
grant execute on function public.release_clinic_team_invite(uuid) to authenticated;
grant execute on function public.complete_clinic_team_invite(uuid, uuid, text) to authenticated;
grant execute on function public.change_clinic_team_role(uuid, public.user_role) to authenticated;
notify pgrst, 'reload schema';
commit;
