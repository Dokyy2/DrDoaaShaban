-- Project owner control room. Apply only after 21_owner_role_enum.sql.
-- The migration does NOT assign an owner or create/change any password.
begin;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('secretary','doctor','owner'));
$$;

create or replace function private.is_doctor() returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('doctor','owner'));
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'owner');
$$;

revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_doctor() from public, anon;
revoke all on function private.is_owner() from public, anon, authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_doctor() to authenticated;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$ select private.is_staff(); $$;
create or replace function public.is_doctor() returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$ select private.is_doctor(); $$;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_doctor() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_doctor() to authenticated;

-- Preserve full doctor workflow for the owner too (the secretary payment RPC
-- remains secretary-only by design).
create or replace function public.record_appointment_completion(
  p_appointment_id bigint, p_amount_due numeric, p_amount_paid numeric,
  p_payment_method text, p_payment_note text default '', p_birth_recorded boolean default false
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid := auth.uid(); v_actor_role public.user_role; v_old_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() then raise exception 'clinic staff access required' using errcode='42501'; end if;
  select p.role into v_actor_role from public.profiles p where p.id=v_actor;
  if v_actor_role::text not in ('doctor','owner') then raise exception 'only the doctor may close a visit' using errcode='42501'; end if;
  if not exists(select 1 from public.clinic_settings where id=true and finance_enabled=true) then raise exception 'clinic finance is disabled' using errcode='23514'; end if;
  if p_amount_due is null or p_amount_due<0 or p_amount_paid is null or p_amount_paid<0 then raise exception 'payment amounts must be zero or greater' using errcode='22023'; end if;
  if p_payment_method is null or p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then raise exception 'unsupported payment method' using errcode='22023'; end if;
  select a.status into v_old_status from public.appointments a where a.id=p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode='P0002'; end if;
  update public.appointments set status='completed',amount_due=p_amount_due,amount_paid=p_amount_paid,payment_method=p_payment_method,
    payment_note=coalesce(p_payment_note,''),payment_recorded_by=v_actor,payment_recorded_at=now(),
    clinic_birth_recorded=case when request_type='birth' then coalesce(p_birth_recorded,false) else clinic_birth_recorded end
    where id=p_appointment_id;
  insert into public.appointment_events(appointment_id,actor_id,event_type,old_status,new_status,note)
    values(p_appointment_id,v_actor,'updated',v_old_status,'completed','تم تسجيل إتمام الزيارة.');
end; $$;
revoke all on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) from public,anon;
grant execute on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) to authenticated;

-- The owner counts toward the five active team seats. Doctor/owner may send
-- ordinary doctor or secretary invitations; only the owner manages existing roles.
create or replace function public.reserve_clinic_team_invite(p_email text, p_role public.user_role)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_id uuid; v_active integer; v_reserved integer; v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if auth.uid() is null or not private.is_doctor() then raise exception 'doctor access required' using errcode='42501'; end if;
  if p_role::text not in ('secretary','doctor') or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid team invitation' using errcode='22023'; end if;
  perform 1 from public.clinic_settings where id=true for update;
  delete from private.clinic_team_invite_reservations where expires_at<=now();
  select count(*) into v_active from public.profiles where role::text in ('owner','doctor','secretary');
  select count(*) into v_reserved from private.clinic_team_invite_reservations;
  if v_active+v_reserved>=5 then raise exception 'clinic team limit reached' using errcode='54000'; end if;
  insert into private.clinic_team_invite_reservations(email,role,reserved_by) values(v_email,p_role,auth.uid()) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.change_clinic_team_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_old_role public.user_role; v_active integer; v_reserved integer; v_email text; v_action text;
begin
  if auth.uid() is null or not private.is_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if p_user_id=auth.uid() or p_role::text not in ('secretary','doctor','pending') then raise exception 'invalid team role change' using errcode='22023'; end if;
  perform 1 from public.clinic_settings where id=true for update;
  select role into v_old_role from public.profiles where id=p_user_id for update;
  if not found then raise exception 'team member not found' using errcode='P0002'; end if;
  if v_old_role::text='owner' then raise exception 'owner account is protected' using errcode='42501'; end if;
  if v_old_role::text='doctor' and p_role::text<>'doctor' and (select count(*) from public.profiles where role::text='doctor')<=1 then
    raise exception 'cannot remove the last doctor' using errcode='23514';
  end if;
  if v_old_role::text='pending' and p_role::text in ('secretary','doctor') then
    delete from private.clinic_team_invite_reservations where expires_at<=now();
    select count(*) into v_active from public.profiles where role::text in ('owner','doctor','secretary');
    select count(*) into v_reserved from private.clinic_team_invite_reservations;
    if v_active+v_reserved>=5 then raise exception 'clinic team limit reached' using errcode='54000'; end if;
  end if;
  select email into v_email from auth.users where id=p_user_id;
  if p_role=v_old_role then return; end if;
  v_action:=case when p_role::text='pending' then 'access_suspended' when v_old_role::text='pending' then 'access_restored' else 'role_changed' end;
  update public.profiles set role=p_role where id=p_user_id;
  insert into public.clinic_team_events(actor_id,target_user_id,target_email,action,old_role,new_role)
    values(auth.uid(),p_user_id,coalesce(v_email,''),v_action,v_old_role,p_role);
end; $$;

revoke all on function public.reserve_clinic_team_invite(text,public.user_role) from public,anon;
revoke all on function public.change_clinic_team_role(uuid,public.user_role) from public,anon;
grant execute on function public.reserve_clinic_team_invite(text,public.user_role) to authenticated;
grant execute on function public.change_clinic_team_role(uuid,public.user_role) to authenticated;
notify pgrst,'reload schema';
commit;

-- One-time owner bootstrap, to be completed only after identifying your exact
-- Supabase Auth user UUID. Never assign owner by display name or from browser input:
-- update public.profiles set role='owner', full_name='Bassem Ashraf' where id='<AUTH_USER_UUID>';
