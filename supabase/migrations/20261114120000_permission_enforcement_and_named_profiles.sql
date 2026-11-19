-- Enforce owner-assigned permissions at the database boundary and add reusable,
-- owner-managed named permission profiles. Prepare locally; do not apply to the
-- hosted project until the database target is positively confirmed as trial.
begin;

create or replace function private.clinic_permission_catalog()
returns text[] language sql immutable set search_path = pg_catalog as $$
  select array[
    'home.view','appointments.view','appointments.manage','appointments.create',
    'patients.view','patients.private_notes','births.record','attachments.view','calendar.view',
    'alerts.view','alerts.resolve','visits.close','payments.record','reports.view',
    'finance.view','closing.view','expenses.view','expenses.add','backup.export',
    'settings.view','settings.edit','team.view','team.invite','team.manage'
  ]::text[];
$$;

create or replace function private.default_clinic_permissions(p_role text)
returns text[] language sql immutable
set search_path = pg_catalog, private as $$
  select case
    when p_role in ('owner','doctor') then private.clinic_permission_catalog()
    when p_role = 'secretary' then array[
      'home.view','appointments.view','appointments.manage','appointments.create',
      'patients.view','calendar.view','alerts.view','alerts.resolve','payments.record'
    ]::text[]
    else '{}'::text[]
  end;
$$;
revoke all on function private.default_clinic_permissions(text) from public,anon,authenticated;

-- Make page-level read scopes explicit when an action depends on their data.
-- The UI mirrors these dependencies; this server-side expansion protects RPC callers.
create or replace function private.expand_clinic_permissions(p_permissions text[])
returns text[] language sql immutable set search_path = pg_catalog as $$
  with requested as (
    select distinct unnest(coalesce(p_permissions,'{}'::text[])) as permission
  ), expanded as (
    select permission from requested
    union
    select required.permission
    from requested r
    cross join lateral unnest(case r.permission
      when 'appointments.manage' then array['appointments.view','patients.view']
      when 'appointments.create' then array['patients.view']
      when 'visits.close' then array['appointments.view','patients.view']
      when 'payments.record' then array['appointments.view','patients.view']
      when 'attachments.view' then array['appointments.view']
      when 'births.record' then array['appointments.view','patients.view']
      when 'calendar.view' then array['appointments.view']
      when 'alerts.resolve' then array['alerts.view']
      when 'reports.view' then array['appointments.view']
      when 'finance.view' then array['appointments.view','patients.view']
      when 'settings.edit' then array['settings.view']
      when 'team.invite' then array['team.view']
      when 'team.manage' then array['team.view']
      when 'backup.export' then array['appointments.view','patients.view']
      else '{}'::text[] end) as required(permission)
  )
  select coalesce(array_agg(permission order by permission),'{}'::text[]) from expanded;
$$;
revoke all on function private.expand_clinic_permissions(text[]) from public,anon,authenticated;

-- Suspended/pending accounts must lose all access even if a stale custom
-- permission row remains from before suspension.
create or replace function private.has_clinic_permission(p_permission text)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare v_role text; v_permissions text[];
begin
  if auth.uid() is null or p_permission is null then return false; end if;
  select role::text into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('owner','doctor','secretary') then return false; end if;
  if v_role='owner' then return true; end if;
  select permissions into v_permissions from public.clinic_member_permissions where user_id=auth.uid();
  if v_permissions is null then v_permissions:=private.default_clinic_permissions(v_role); end if;
  return p_permission=any(v_permissions);
end;
$$;
revoke all on function private.has_clinic_permission(text) from public,anon;
grant execute on function private.has_clinic_permission(text) to authenticated;

-- Keep team invitation UI, Edge Function, and database authorization aligned.
-- A staff member can invite only when the owner explicitly grants team.invite;
-- role changes and account suspension remain owner-only.
create or replace function public.reserve_clinic_team_invite(p_email text, p_role public.user_role)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_id uuid; v_active integer; v_reserved integer; v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if auth.uid() is null or not private.has_clinic_permission('team.invite') then
    raise exception 'team invitation permission required' using errcode='42501';
  end if;
  if p_role::text not in ('secretary','doctor') or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid team invitation' using errcode='22023';
  end if;
  perform 1 from public.clinic_settings where id=true for update;
  delete from private.clinic_team_invite_reservations where expires_at<=now();
  select count(*) into v_active from public.profiles where role::text in ('owner','doctor','secretary');
  select count(*) into v_reserved from private.clinic_team_invite_reservations;
  if v_active+v_reserved>=5 then raise exception 'clinic team limit reached' using errcode='54000'; end if;
  insert into private.clinic_team_invite_reservations(email,role,reserved_by)
    values(v_email,p_role,auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.release_clinic_team_invite(p_reservation_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  delete from private.clinic_team_invite_reservations
    where id=p_reservation_id and reserved_by=auth.uid();
end;
$$;

create or replace function public.complete_clinic_team_invite(
  p_reservation_id uuid, p_user_id uuid, p_full_name text
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_reservation private.clinic_team_invite_reservations%rowtype;
begin
  if auth.uid() is null or not private.has_clinic_permission('team.invite') then
    raise exception 'team invitation permission required' using errcode='42501';
  end if;
  if p_user_id is null or length(btrim(coalesce(p_full_name,''))) not between 2 and 100 then
    raise exception 'invalid team invitation' using errcode='22023';
  end if;
  perform 1 from public.clinic_settings where id=true for update;
  select * into v_reservation from private.clinic_team_invite_reservations
    where id=p_reservation_id and reserved_by=auth.uid() and expires_at>now() for update;
  if not found then raise exception 'team invitation reservation expired' using errcode='P0002'; end if;
  update public.profiles set full_name=btrim(p_full_name),role=v_reservation.role
    where id=p_user_id and role='pending';
  if not found then raise exception 'team profile not found or already active' using errcode='23514'; end if;
  insert into public.clinic_team_events(actor_id,target_user_id,target_email,action,old_role,new_role)
    values(auth.uid(),p_user_id,v_reservation.email,'invited','pending',v_reservation.role);
  delete from private.clinic_team_invite_reservations where id=p_reservation_id;
end;
$$;

revoke all on function public.reserve_clinic_team_invite(text,public.user_role) from public,anon;
revoke all on function public.release_clinic_team_invite(uuid) from public,anon;
revoke all on function public.complete_clinic_team_invite(uuid,uuid,text) from public,anon;
grant execute on function public.reserve_clinic_team_invite(text,public.user_role) to authenticated;
grant execute on function public.release_clinic_team_invite(uuid) to authenticated;
grant execute on function public.complete_clinic_team_invite(uuid,uuid,text) to authenticated;

alter table public.clinic_member_permissions
  add column if not exists permission_set_name text,
  add column if not exists permission_template_role text,
  add column if not exists permission_profile_id uuid;
alter table public.clinic_member_permissions
  add constraint clinic_member_permissions_template_role_check
  check (permission_template_role is null or permission_template_role in ('doctor','assistant','secretary'));

create table if not exists public.clinic_permission_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  template_role text not null check (template_role in ('doctor','assistant','secretary')),
  permissions text[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, name)
);
create unique index if not exists clinic_permission_profiles_owner_name_ci_uq
  on public.clinic_permission_profiles(created_by, lower(name));
create unique index if not exists clinic_member_permissions_manual_name_ci_uq
  on public.clinic_member_permissions(lower(permission_set_name))
  where permission_set_name is not null and permission_profile_id is null;
alter table public.clinic_member_permissions
  add constraint clinic_member_permissions_profile_fk foreign key (permission_profile_id)
  references public.clinic_permission_profiles(id) on delete restrict;
alter table public.clinic_permission_profiles enable row level security;
revoke all on public.clinic_permission_profiles from public, anon, authenticated;

drop function if exists public.owner_list_clinic_permissions();
create function public.owner_list_clinic_permissions()
returns table(user_id uuid, permissions text[], permission_set_name text, permission_template_role text, permission_profile_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  return query select p.id,
    coalesce(cmp.permissions, private.default_clinic_permissions(p.role::text)),
    cmp.permission_set_name, cmp.permission_template_role, cmp.permission_profile_id
  from public.profiles p
  left join public.clinic_member_permissions cmp on cmp.user_id=p.id
  where p.role::text in ('owner','doctor','secretary','pending')
  order by case p.role::text when 'owner' then 0 when 'doctor' then 1 when 'secretary' then 2 else 3 end,
           lower(coalesce(p.full_name,''));
end;
$$;

create or replace function public.owner_list_clinic_permission_profiles()
returns table(id uuid, name text, template_role text, permissions text[])
language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  return query select p.id,p.name,p.template_role,p.permissions
    from public.clinic_permission_profiles p where p.created_by=auth.uid()
    order by lower(p.name),p.created_at;
end;
$$;

create or replace function public.owner_save_clinic_permission_profile(
  p_name text, p_template_role text, p_permissions text[]
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_id uuid; v_name text:=btrim(coalesce(p_name,'')); v_selected text[];
begin
  if auth.uid() is null or not private.is_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if char_length(v_name)<2 or char_length(v_name)>80 then raise exception 'profile name must be 2 to 80 characters' using errcode='22023'; end if;
  if p_template_role is null or p_template_role not in ('doctor','assistant','secretary') then raise exception 'invalid permission template' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-permission-names:'||auth.uid()::text,0));
  select coalesce(array_agg(distinct key order by key),'{}'::text[]) into v_selected
    from unnest(coalesce(p_permissions,'{}'::text[])) as x(key);
  if exists(select 1 from unnest(coalesce(p_permissions,'{}'::text[])) as x(key)
      where key is null or not (key=any(private.clinic_permission_catalog()))) then
    raise exception 'unknown permission key' using errcode='22023';
  end if;
  v_selected := private.expand_clinic_permissions(v_selected);
  if exists (select 1 from public.clinic_permission_profiles p where p.created_by=auth.uid() and lower(p.name)=lower(v_name))
     or exists (select 1 from public.clinic_member_permissions m where m.updated_by=auth.uid() and m.permission_profile_id is null and lower(m.permission_set_name)=lower(v_name)) then
    raise exception 'permission profile name already exists' using errcode='23505';
  end if;
  insert into public.clinic_permission_profiles(name,template_role,permissions,created_by)
    values(v_name,p_template_role,v_selected,auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.owner_delete_clinic_permission_profile(p_profile_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if exists(select 1 from public.clinic_member_permissions where permission_profile_id=p_profile_id) then
    raise exception 'permission profile is assigned to one or more accounts' using errcode='23503';
  end if;
  delete from public.clinic_permission_profiles where id=p_profile_id and created_by=auth.uid();
  return found;
end;
$$;

drop function if exists public.owner_set_clinic_permissions(uuid,text[],text);
drop function if exists public.owner_set_clinic_permissions(uuid,text[],text,text);
create or replace function public.owner_set_clinic_permissions(
  p_user_id uuid, p_permissions text[], p_permission_set_name text default null,
  p_permission_template_role text default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_role text; v_selected text[]; v_name text:=nullif(btrim(coalesce(p_permission_set_name,'')), '');
begin
  if auth.uid() is null or not private.is_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if p_user_id=auth.uid() then raise exception 'owner account is protected' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-permission-names:'||auth.uid()::text,0));
  select role::text into v_role from public.profiles where id=p_user_id for update;
  if v_role not in ('doctor','secretary','pending') then raise exception 'only non-owner accounts can be managed' using errcode='42501'; end if;
  if p_permissions is null then delete from public.clinic_member_permissions where user_id=p_user_id; return; end if;
  if v_name is null or char_length(v_name)<2 or char_length(v_name)>80 then raise exception 'permission set name must be 2 to 80 characters' using errcode='22023'; end if;
  if p_permission_template_role is null or p_permission_template_role not in ('doctor','assistant','secretary') then raise exception 'permission group type is required' using errcode='22023'; end if;
  if exists (select 1 from public.clinic_permission_profiles p where p.created_by=auth.uid() and lower(p.name)=lower(v_name))
     or exists (select 1 from public.clinic_member_permissions m where m.user_id<>p_user_id and m.updated_by=auth.uid() and m.permission_profile_id is null and lower(m.permission_set_name)=lower(v_name)) then
    raise exception 'permission set name already exists; choose a new name or apply its saved group' using errcode='23505';
  end if;
  select coalesce(array_agg(distinct key order by key),'{}'::text[]) into v_selected
    from unnest(p_permissions) as x(key);
  if exists(select 1 from unnest(p_permissions) as x(key)
      where key is null or not (key=any(private.clinic_permission_catalog()))) then
    raise exception 'unknown permission key' using errcode='22023';
  end if;
  v_selected := private.expand_clinic_permissions(v_selected);
  insert into public.clinic_member_permissions(user_id,permissions,permission_set_name,permission_template_role,permission_profile_id,updated_by,updated_at)
    values(p_user_id,v_selected,v_name,p_permission_template_role,null,auth.uid(),now())
  on conflict(user_id) do update set permissions=excluded.permissions,
    permission_set_name=excluded.permission_set_name,permission_template_role=excluded.permission_template_role,permission_profile_id=null,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end;
$$;

create or replace function public.owner_apply_clinic_permission_profile(p_user_id uuid,p_profile_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_profile public.clinic_permission_profiles%rowtype; v_role text;
begin
  if auth.uid() is null or not private.is_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if p_user_id=auth.uid() then raise exception 'owner account is protected' using errcode='42501'; end if;
  select role::text into v_role from public.profiles where id=p_user_id for update;
  if v_role not in ('doctor','secretary','pending') then raise exception 'only non-owner accounts can be managed' using errcode='42501'; end if;
  select * into v_profile from public.clinic_permission_profiles where id=p_profile_id and created_by=auth.uid();
  if not found then raise exception 'permission profile not found' using errcode='P0002'; end if;
  insert into public.clinic_member_permissions(user_id,permissions,permission_set_name,permission_template_role,permission_profile_id,updated_by,updated_at)
    values(p_user_id,private.expand_clinic_permissions(v_profile.permissions),v_profile.name,v_profile.template_role,v_profile.id,auth.uid(),now())
  on conflict(user_id) do update set permissions=excluded.permissions,
    permission_set_name=excluded.permission_set_name,permission_template_role=excluded.permission_template_role,permission_profile_id=excluded.permission_profile_id,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end;
$$;

-- Attachments are only returned through this function, after an explicit
-- permission check. The body remains absent from ordinary dashboard queries.
create or replace function public.doctor_appointment_attachment(p_appointment_id bigint)
returns table(attachment_base64 text,attachment_type text)
language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.has_clinic_permission('appointments.view')
     or not private.has_clinic_permission('attachments.view') then
    raise exception 'attachment access is not granted' using errcode='42501';
  end if;
  return query select a.attachment_base64,a.attachment_type from public.appointments a
    where a.id=p_appointment_id and a.attachment_base64 is not null;
end;
$$;

-- A selected checkbox now controls the transactional workflow itself. Closing
-- and cancellation require visits.close; routine status changes require manage.
create or replace function public.record_appointment_workflow(
  p_appointment_id bigint,p_expected_status public.appointment_status,
  p_new_status public.appointment_status,p_changes jsonb,p_event_note text
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid:=auth.uid(); v_current public.appointments%rowtype;
  v_settings public.clinic_settings%rowtype; v_patient_phone text; v_finance_enabled boolean;
  v_changes jsonb:=coalesce(p_changes,'{}'::jsonb); v_is_waitlist boolean; v_booked_count integer;
begin
  if v_actor is null or not private.is_staff() then raise exception 'clinic staff access required' using errcode='42501'; end if;
  if p_new_status in ('completed','cancelled','no_show') then
    if not private.has_clinic_permission('visits.close') then raise exception 'visit closure permission required' using errcode='42501'; end if;
  elsif not private.has_clinic_permission('appointments.manage') then
    raise exception 'appointment management permission required' using errcode='42501';
  end if;
  if p_new_status='completed' then
    select finance_enabled into v_finance_enabled from public.clinic_settings where id=true;
    if coalesce(v_finance_enabled,false) then raise exception 'use the visit and payment workflow' using errcode='22023'; end if;
  end if;
  if jsonb_typeof(v_changes)<>'object' or exists(select 1 from jsonb_object_keys(v_changes) as k(key)
    where key not in ('requested_date','requested_time','is_waitlist','contact_note','staff_note','outcome_reason','outcome_note','clinic_birth_recorded')) then
    raise exception 'unsupported appointment changes' using errcode='22023';
  end if;
  if length(coalesce(p_event_note,''))>1000 then raise exception 'workflow note is too long' using errcode='22023'; end if;
  select * into v_current from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode='P0002'; end if;
  if v_changes?'clinic_birth_recorded' and (v_current.request_type<>'birth' or not private.has_clinic_permission('births.record')) then
    raise exception 'birth record permission required' using errcode='42501';
  end if;
  if v_current.status is distinct from p_expected_status then raise exception 'appointment changed; refresh and review the latest status' using errcode='40001'; end if;
  if v_current.status in ('completed','cancelled','no_show') and p_new_status is distinct from v_current.status then raise exception 'closed visits cannot be reopened through this action' using errcode='42501'; end if;
  if p_new_status in ('contacted','confirmed') and nullif(v_changes->>'requested_time','') is null and v_current.requested_time is null then raise exception 'appointment time is required' using errcode='22023'; end if;
  if p_new_status in ('follow_up','rescheduled') and (nullif(v_changes->>'requested_date','') is null or nullif(v_changes->>'requested_time','') is null) then raise exception 'new date and time are required' using errcode='22023'; end if;
  if p_new_status in ('follow_up','rescheduled') then
    select * into v_settings from public.clinic_settings where id=true;
    if not found then raise exception 'clinic settings are unavailable' using errcode='23514'; end if;
    if v_current.request_type<>'birth' and (extract(dow from (v_changes->>'requested_date')::date)::integer=any(v_settings.closed_weekdays) or (v_changes->>'requested_date')::date=any(v_settings.closed_dates)) then raise exception 'clinic is closed on the selected date' using errcode='23514'; end if;
    select regexp_replace(phone,'[^0-9]','','g') into v_patient_phone from public.patients where id=v_current.patient_id;
    if not found then raise exception 'patient not found' using errcode='P0002'; end if;
    perform pg_advisory_xact_lock(hashtextextended('clinic-booking-phone:'||v_patient_phone,0));
    if exists(select 1 from public.appointments a where a.patient_id=v_current.patient_id and a.requested_date=(v_changes->>'requested_date')::date and a.id<>v_current.id and a.status in ('new','contacted','confirmed','rescheduled','follow_up')) then raise exception 'patient already has an active booking on this date' using errcode='23505'; end if;
    v_is_waitlist:=case when v_changes?'is_waitlist' then (v_changes->>'is_waitlist')::boolean else v_current.is_waitlist end;
    if not coalesce(v_is_waitlist,false) and v_current.request_type in ('first','follow','consult','aesthetic') then
      perform pg_advisory_xact_lock(hashtextextended('clinic-booking-date:'||(v_changes->>'requested_date'),0));
      select count(*) into v_booked_count from public.appointments a where a.requested_date=(v_changes->>'requested_date')::date and a.request_type in ('first','follow','consult','aesthetic') and a.status not in ('cancelled','no_show') and a.id<>v_current.id;
      if v_booked_count>=v_settings.max_daily_slots then raise exception 'daily appointment capacity reached' using errcode='23514'; end if;
    end if;
  end if;
  if p_new_status in ('cancelled','no_show') and nullif(btrim(coalesce(v_changes->>'outcome_reason','')),'') is null then raise exception 'outcome reason is required' using errcode='22023'; end if;
  update public.appointments set status=p_new_status,
    requested_date=case when v_changes?'requested_date' then nullif(v_changes->>'requested_date','')::date else requested_date end,
    requested_time=case when v_changes?'requested_time' then nullif(v_changes->>'requested_time','')::time else requested_time end,
    is_waitlist=case when v_changes?'is_waitlist' then (v_changes->>'is_waitlist')::boolean else is_waitlist end,
    contact_note=case when v_changes?'contact_note' then coalesce(v_changes->>'contact_note','') else contact_note end,
    staff_note=case when v_changes?'staff_note' then coalesce(v_changes->>'staff_note','') else staff_note end,
    outcome_reason=case when v_changes?'outcome_reason' then nullif(v_changes->>'outcome_reason','') else outcome_reason end,
    outcome_note=case when v_changes?'outcome_note' then coalesce(v_changes->>'outcome_note','') else outcome_note end,
    clinic_birth_recorded=case when v_changes?'clinic_birth_recorded' then (v_changes->>'clinic_birth_recorded')::boolean else clinic_birth_recorded end
  where id=p_appointment_id;
  insert into public.appointment_events(appointment_id,actor_id,event_type,old_status,new_status,note)
  values(p_appointment_id,v_actor,'updated',v_current.status,p_new_status,coalesce(p_event_note,''));
end;
$$;

create or replace function public.record_appointment_completion(
  p_appointment_id bigint,p_amount_due numeric,p_amount_paid numeric,p_payment_method text,
  p_payment_note text default '',p_birth_recorded boolean default false
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid:=auth.uid(); v_old_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() or not private.has_clinic_permission('visits.close') then raise exception 'visit closure permission required' using errcode='42501'; end if;
  if not private.has_clinic_permission('payments.record') then raise exception 'payment permission required to complete a paid visit' using errcode='42501'; end if;
  if not exists(select 1 from public.clinic_settings where id=true and finance_enabled=true) then raise exception 'clinic finance is disabled' using errcode='23514'; end if;
  if p_amount_due is null or p_amount_due<0 or p_amount_paid is null or p_amount_paid<0 then raise exception 'payment amounts must be zero or greater' using errcode='22023'; end if;
  if p_birth_recorded and not private.has_clinic_permission('births.record') then raise exception 'birth record permission required' using errcode='42501'; end if;
  if p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then raise exception 'unsupported payment method' using errcode='22023'; end if;
  select status into v_old_status from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode='P0002'; end if;
  if v_old_status not in ('new','contacted','confirmed','rescheduled','follow_up') then raise exception 'visit is no longer active' using errcode='42501'; end if;
  update public.appointments set status='completed',amount_due=p_amount_due,amount_paid=p_amount_paid,
    payment_method=p_payment_method,payment_note=case when private.has_clinic_permission('finance.view') then coalesce(p_payment_note,'') else '' end,
    payment_recorded_by=v_actor,payment_recorded_at=now(),
    clinic_birth_recorded=case when request_type='birth' and private.has_clinic_permission('births.record') then coalesce(p_birth_recorded,false) else clinic_birth_recorded end
  where id=p_appointment_id;
  insert into public.appointment_events(appointment_id,actor_id,event_type,old_status,new_status,note)
  values(p_appointment_id,v_actor,'updated',v_old_status,'completed','تم تسجيل إتمام الزيارة.');
end;
$$;

create or replace function public.doctor_close_visit_without_payment(p_appointment_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid:=auth.uid(); v_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() or not private.has_clinic_permission('visits.close') then raise exception 'visit closure permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.clinic_settings where id=true and finance_enabled=true) then raise exception 'clinic finance is disabled' using errcode='23514'; end if;
  select status into v_status from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode='P0002'; end if;
  if v_status not in ('new','contacted','confirmed','rescheduled','follow_up') then raise exception 'only an active visit can be closed' using errcode='42501'; end if;
  if not exists(select 1 from public.appointments where id=p_appointment_id and amount_due is null and amount_paid is null and payment_method is null and payment_recorded_at is null) then raise exception 'payment information already exists' using errcode='23514'; end if;
  update public.appointments set status='completed' where id=p_appointment_id;
  insert into public.appointment_events(appointment_id,actor_id,event_type,old_status,new_status,note)
  values(p_appointment_id,v_actor,'updated',v_status,'completed','تم إغلاق الزيارة مع تأجيل تسجيل الدفع.');
end;
$$;

create or replace function public.record_appointment_payment(p_appointment_id bigint,p_amount_due numeric,p_amount_paid numeric,p_payment_method text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or not private.is_staff() or not private.has_clinic_permission('payments.record') then raise exception 'payment permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.clinic_settings where id=true and finance_enabled=true) then raise exception 'clinic finance is disabled' using errcode='23514'; end if;
  if p_amount_due is null or p_amount_due<0 or p_amount_paid is null or p_amount_paid<0 then raise exception 'payment amounts must be zero or greater' using errcode='22023'; end if;
  if p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then raise exception 'unsupported payment method' using errcode='22023'; end if;
  perform 1 from public.appointments where id=p_appointment_id and status='completed' and amount_due is null and amount_paid is null and payment_method is null and payment_recorded_at is null for update;
  if not found then raise exception 'visit must be closed and unpaid before payment entry' using errcode='42501'; end if;
  update public.appointments set amount_due=p_amount_due,amount_paid=p_amount_paid,payment_method=p_payment_method,payment_recorded_by=v_actor,payment_recorded_at=now() where id=p_appointment_id;
  insert into public.appointment_events(appointment_id,actor_id,event_type,old_status,new_status,note)
  values(p_appointment_id,v_actor,'updated','completed','completed','تم تسجيل الدفع بواسطة الفريق.');
end;
$$;

-- Set permission-aware read boundaries. Column grants continue to hide private
-- payment fields, while these RLS rules also enforce checkbox revocation.
-- Payment columns are intentionally not selectable from the general appointment
-- list, even for a staff account with appointments.view. Authorized finance
-- readers receive them through doctor_finance_snapshot(); payment-only staff
-- receive no history through the list API.
revoke select (amount_due,amount_paid,payment_method,payment_note,payment_recorded_by,payment_recorded_at)
  on public.appointments from public,anon,authenticated;
drop policy if exists "staff reads appointments" on public.appointments;
create policy "permitted staff reads appointments" on public.appointments
  for select to authenticated using (private.has_clinic_permission('appointments.view'));
drop policy if exists "staff reads patient directory" on public.patients;
create policy "permitted staff reads patient directory" on public.patients
  for select to authenticated using (private.has_clinic_permission('patients.view'));
drop policy if exists "staff reads appointment events" on public.appointment_events;
create policy "permitted staff reads appointment events" on public.appointment_events
  for select to authenticated using (private.has_clinic_permission('appointments.view'));
drop policy if exists "staff reads booking alerts" on public.booking_alerts;
create policy "permitted staff reads booking alerts" on public.booking_alerts
  for select to authenticated using (private.has_clinic_permission('alerts.view'));
drop policy if exists "doctor reads payment audit" on public.payment_audit;
create policy "permitted staff reads payment audit" on public.payment_audit
  for select to authenticated using (private.has_clinic_permission('finance.view'));
drop policy if exists "doctor reads clinic expenses" on public.clinic_expenses;
create policy "permitted staff reads clinic expenses" on public.clinic_expenses
  for select to authenticated using (private.has_clinic_permission('expenses.view'));
drop policy if exists "doctor creates clinic expenses" on public.clinic_expenses;
create policy "permitted staff creates clinic expenses" on public.clinic_expenses
  for insert to authenticated with check (private.has_clinic_permission('expenses.add') and created_by=auth.uid());
drop policy if exists "doctor reads patient private notes" on public.patient_private_notes;
create policy "permitted staff reads patient private notes" on public.patient_private_notes
  for select to authenticated using (private.has_clinic_permission('patients.private_notes'));
drop policy if exists "doctor inserts patient private notes" on public.patient_private_notes;
create policy "permitted staff inserts patient private notes" on public.patient_private_notes
  for insert to authenticated with check (private.has_clinic_permission('patients.private_notes') and updated_by=auth.uid());
drop policy if exists "doctor updates patient private notes" on public.patient_private_notes;
create policy "permitted staff updates patient private notes" on public.patient_private_notes
  for update to authenticated using (private.has_clinic_permission('patients.private_notes'))
  with check (private.has_clinic_permission('patients.private_notes') and updated_by=auth.uid());
drop policy if exists "doctor reads clinic admin audit" on public.clinic_admin_audit;
create policy "owner or permitted doctors read clinic admin audit" on public.clinic_admin_audit
  for select to authenticated using (private.is_owner() or private.has_clinic_permission('reports.view'));

revoke update on public.appointments, public.clinic_settings, public.booking_alerts from public, anon, authenticated;
revoke insert, update on public.clinic_expenses from public, anon, authenticated;
revoke insert, update on public.patient_private_notes from public, anon, authenticated;

revoke all on function public.owner_list_clinic_permissions() from public,anon;
revoke all on function public.owner_list_clinic_permission_profiles() from public,anon;
revoke all on function public.owner_save_clinic_permission_profile(text,text,text[]) from public,anon;
revoke all on function public.owner_delete_clinic_permission_profile(uuid) from public,anon;
revoke all on function public.owner_apply_clinic_permission_profile(uuid,uuid) from public,anon;
revoke all on function public.owner_set_clinic_permissions(uuid,text[],text,text) from public,anon;
revoke all on function public.record_appointment_workflow(bigint,public.appointment_status,public.appointment_status,jsonb,text) from public,anon;
revoke all on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) from public,anon;
revoke all on function public.doctor_close_visit_without_payment(bigint) from public,anon;
revoke all on function public.record_appointment_payment(bigint,numeric,numeric,text) from public,anon;
revoke all on function public.doctor_appointment_attachment(bigint) from public,anon;

-- Do not leave older role-only guards active behind the permission-aware RPCs.
create or replace function private.prevent_secretary_visit_closure()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if (new.status = 'completed' and old.status is distinct from 'completed'
      or old.status in ('completed','cancelled','no_show') and new.status is distinct from old.status)
     and not private.has_clinic_permission('visits.close') then
    raise exception 'visit closure permission required' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_secretary_visit_closure() from public,anon,authenticated;

create or replace function public.staff_payment_available(p_appointment_id bigint)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_staff() or not private.has_clinic_permission('payments.record') then
    raise exception 'payment permission required' using errcode='42501';
  end if;
  return exists(select 1 from public.appointments a join public.clinic_settings s on s.id=true and s.finance_enabled=true
    where a.id=p_appointment_id and a.status='completed' and a.amount_due is null and a.amount_paid is null
      and a.payment_method is null and a.payment_recorded_at is null);
end;
$$;

-- Manual bookings are also governed by the owner's checkbox, regardless of role.
create or replace function private.enforce_manual_booking_permission()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is not null and private.is_staff() and not private.has_clinic_permission('appointments.create') then
    raise exception 'manual booking permission required' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_manual_booking_permission() from public,anon,authenticated;
drop trigger if exists enforce_manual_booking_permission on public.appointments;
create trigger enforce_manual_booking_permission before insert on public.appointments
for each row execute function private.enforce_manual_booking_permission();

-- Extend the same permission boundary to management actions that previously
-- checked only the broad doctor role.
create or replace function public.record_clinic_expense(
  p_expense_date date,p_category text,p_amount numeric,p_note text default ''
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_actor uuid:=auth.uid(); v_id bigint; v_category text:=btrim(coalesce(p_category,'')); v_note text:=btrim(coalesce(p_note,''));
begin
  if v_actor is null or not private.has_clinic_permission('expenses.add') then raise exception 'expense permission required' using errcode='42501'; end if;
  if p_expense_date is null or v_category='' or char_length(v_category)>80 then raise exception 'expense date/category is invalid' using errcode='22023'; end if;
  if p_amount is null or p_amount<0 or p_amount>9999999999.99 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'expense amount is invalid' using errcode='22023'; end if;
  if char_length(v_note)>2000 then raise exception 'expense note is too long' using errcode='22023'; end if;
  insert into public.clinic_expenses(expense_date,category,amount,note,created_by) values(p_expense_date,v_category,p_amount,v_note,v_actor) returning id into v_id;
  return jsonb_build_object('id',v_id,'expense_date',p_expense_date,'amount',p_amount);
end;
$$;

create or replace function public.save_patient_private_note(p_patient_id uuid,p_private_note text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_note text:=btrim(coalesce(p_private_note,''));
begin
  if auth.uid() is null or not private.has_clinic_permission('patients.private_notes') then raise exception 'private note permission required' using errcode='42501'; end if;
  if p_patient_id is null or not exists(select 1 from public.patients where id=p_patient_id) then raise exception 'patient not found' using errcode='P0002'; end if;
  if char_length(v_note)>10000 then raise exception 'private note is too long' using errcode='22023'; end if;
  insert into public.patient_private_notes(patient_id,private_note,updated_by) values(p_patient_id,v_note,auth.uid())
  on conflict(patient_id) do update set private_note=excluded.private_note,updated_by=excluded.updated_by;
  return true;
end;
$$;

create or replace function public.resolve_clinic_alerts(p_alert_ids bigint[])
returns integer language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_count integer;
begin
  if auth.uid() is null or not private.has_clinic_permission('alerts.resolve') then raise exception 'alert resolution permission required' using errcode='42501'; end if;
  if p_alert_ids is null or cardinality(p_alert_ids)=0 or cardinality(p_alert_ids)>1000 or exists(select 1 from unnest(p_alert_ids) ids(id) where id is null or id<1) then raise exception 'alert ids are invalid' using errcode='22023'; end if;
  update public.booking_alerts set status='handled',resolved_at=now(),resolved_by=auth.uid() where id=any(p_alert_ids) and resolved_at is null;
  get diagnostics v_count=row_count; return v_count;
end;
$$;

-- The table is intentionally not directly writable by staff. This guarded RPC
-- is the only path for users with settings.edit.
create or replace function public.save_clinic_settings(
  p_clinic_name text,p_work_start time,p_work_end time,p_max_daily_slots integer,
  p_closed_weekdays integer[],p_closed_dates date[],p_service_prices jsonb,p_finance_enabled boolean
) returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_name text:=btrim(coalesce(p_clinic_name,'')); v_price jsonb;
begin
  if auth.uid() is null or not private.has_clinic_permission('settings.edit') then raise exception 'settings edit permission required' using errcode='42501'; end if;
  if char_length(v_name)<2 or char_length(v_name)>120 then raise exception 'clinic name must be 2 to 120 characters' using errcode='22023'; end if;
  if p_work_start is null or p_work_end is null or p_work_start=p_work_end then raise exception 'valid clinic working hours are required' using errcode='22023'; end if;
  if p_max_daily_slots is null or p_max_daily_slots<1 then raise exception 'daily capacity must be at least 1' using errcode='22023'; end if;
  if p_closed_weekdays is null or cardinality(p_closed_weekdays)>7 or exists(select 1 from unnest(p_closed_weekdays) d(day) where day is null or day<0 or day>6) then raise exception 'closed weekdays must be values from 0 to 6' using errcode='22023'; end if;
  if p_closed_dates is null or cardinality(p_closed_dates)>366 or exists(select 1 from unnest(p_closed_dates) d(day) where day is null) then raise exception 'closed dates list is invalid' using errcode='22023'; end if;
  if p_service_prices is null or jsonb_typeof(p_service_prices)<>'object' then raise exception 'service prices must be an object' using errcode='22023'; end if;
  for v_price in select value from jsonb_each(p_service_prices) loop
    if jsonb_typeof(v_price)<>'number' or (v_price#>>'{}')::numeric<0 or (v_price#>>'{}')::numeric>9999999999.99 then raise exception 'service price is outside the supported range' using errcode='22023'; end if;
  end loop;
  update public.clinic_settings set clinic_name=v_name,work_start=p_work_start,work_end=p_work_end,
    max_daily_slots=p_max_daily_slots,closed_weekdays=p_closed_weekdays,closed_dates=p_closed_dates,
    service_prices=p_service_prices,finance_enabled=coalesce(p_finance_enabled,false) where id=true;
  if not found then raise exception 'clinic settings row is missing' using errcode='P0002'; end if;
  return true;
end;
$$;

-- Read the finance snapshot only when the account is explicitly allowed to
-- see financial values; closing.view alone receives only its dedicated UI data.
create or replace function public.doctor_finance_snapshot()
returns table(appointment_id bigint,amount_due numeric,amount_paid numeric,payment_method text,payment_note text,payment_recorded_by uuid,payment_recorded_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.has_clinic_permission('finance.view') then raise exception 'finance view permission required' using errcode='42501'; end if;
  return query select a.id,a.amount_due,a.amount_paid,a.payment_method,
    case when private.has_clinic_permission('finance.view') then a.payment_note else null end,
    a.payment_recorded_by,a.payment_recorded_at from public.appointments a;
end;
$$;

-- A closing-only user receives one selected day's totals and paid transactions,
-- never the full appointment or monthly finance tables.
create or replace function public.doctor_finance_settings()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (
    private.has_clinic_permission('finance.view')
    or private.has_clinic_permission('settings.view')
    or private.has_clinic_permission('settings.edit')
  ) then raise exception 'clinic settings access required' using errcode='42501'; end if;
  select jsonb_build_object('finance_enabled',s.finance_enabled,'service_prices',s.service_prices,'finance_start_date',s.finance_start_date)
    into v_result from public.clinic_settings s where s.id=true;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.staff_daily_closing_snapshot(p_date date)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_staff() or not private.has_clinic_permission('closing.view') then
    raise exception 'daily closing permission required' using errcode='42501';
  end if;
  if p_date is null or p_date < current_date - 366 or p_date > current_date + 366 then
    raise exception 'closing date is outside the supported range' using errcode='22023';
  end if;
  if not exists(select 1 from public.clinic_settings where id=true and finance_enabled=true) then
    return jsonb_build_object('enabled',false,'counts',jsonb_build_object('total',0,'completed',0,'no_show',0,'cancelled',0),'payments','[]'::jsonb);
  end if;
  select jsonb_build_object(
    'enabled',true,
    'counts',jsonb_build_object(
      'total',count(*) filter (where a.requested_date=p_date),
      'completed',count(*) filter (where a.requested_date=p_date and a.status='completed'),
      'no_show',count(*) filter (where a.requested_date=p_date and a.status='no_show'),
      'cancelled',count(*) filter (where a.requested_date=p_date and a.status='cancelled')
    ),
    'payments',coalesce((select jsonb_agg(jsonb_build_object(
      'appointment_id',a.id,'patient_name',p.full_name,'request_type',a.request_type,
      'amount_paid',a.amount_paid,'payment_method',a.payment_method,
      'payment_recorded_at',a.payment_recorded_at
    ) order by a.payment_recorded_at desc)
    from public.appointments a join public.patients p on p.id=a.patient_id
    where a.amount_paid is not null and (a.payment_recorded_at at time zone 'Africa/Cairo')::date=p_date),'[]'::jsonb)
  ) into v_result
  from public.appointments a;
  return coalesce(v_result,jsonb_build_object('enabled',true,'counts',jsonb_build_object('total',0,'completed',0,'no_show',0,'cancelled',0),'payments','[]'::jsonb));
end;
$$;

drop policy if exists "staff reads appointments" on public.appointments;
drop policy if exists "staff reads patients" on public.patients;
drop policy if exists "staff reads events" on public.appointment_events;
drop policy if exists "staff reads settings" on public.clinic_settings;
drop policy if exists "staff reads booking alerts" on public.booking_alerts;
drop policy if exists "doctor reads payment audit" on public.payment_audit;
drop policy if exists "staff reads payment audit" on public.payment_audit;
drop policy if exists "doctor reads clinic expenses" on public.clinic_expenses;
drop policy if exists "doctor manages clinic expenses" on public.clinic_expenses;
create policy "permissioned clinic settings read" on public.clinic_settings for select to authenticated
  using (private.has_clinic_permission('settings.view') or private.has_clinic_permission('settings.edit')
    or private.has_clinic_permission('home.view') or private.has_clinic_permission('appointments.view')
    or private.has_clinic_permission('calendar.view'));

revoke all on function public.staff_payment_available(bigint) from public,anon;
revoke all on function public.record_clinic_expense(date,text,numeric,text) from public,anon;
revoke all on function public.save_patient_private_note(uuid,text) from public,anon;
revoke all on function public.resolve_clinic_alerts(bigint[]) from public,anon;
revoke all on function public.doctor_finance_snapshot() from public,anon;
revoke all on function public.doctor_finance_settings() from public,anon;
revoke all on function public.staff_daily_closing_snapshot(date) from public,anon;
revoke all on function public.save_clinic_settings(text,time,time,integer,integer[],date[],jsonb,boolean) from public,anon;
grant execute on function public.staff_payment_available(bigint) to authenticated;
grant execute on function public.record_clinic_expense(date,text,numeric,text) to authenticated;
grant execute on function public.save_patient_private_note(uuid,text) to authenticated;
grant execute on function public.resolve_clinic_alerts(bigint[]) to authenticated;
grant execute on function public.doctor_finance_snapshot() to authenticated;
grant execute on function public.doctor_finance_settings() to authenticated;
grant execute on function public.staff_daily_closing_snapshot(date) to authenticated;
grant execute on function public.save_clinic_settings(text,time,time,integer,integer[],date[],jsonb,boolean) to authenticated;
grant execute on function public.owner_list_clinic_permissions() to authenticated;
grant execute on function public.owner_list_clinic_permission_profiles() to authenticated;
grant execute on function public.owner_save_clinic_permission_profile(text,text,text[]) to authenticated;
grant execute on function public.owner_delete_clinic_permission_profile(uuid) to authenticated;
grant execute on function public.owner_apply_clinic_permission_profile(uuid,uuid) to authenticated;
grant execute on function public.owner_set_clinic_permissions(uuid,text[],text,text) to authenticated;
grant execute on function public.record_appointment_workflow(bigint,public.appointment_status,public.appointment_status,jsonb,text) to authenticated;
grant execute on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) to authenticated;
grant execute on function public.doctor_close_visit_without_payment(bigint) to authenticated;
grant execute on function public.record_appointment_payment(bigint,numeric,numeric,text) to authenticated;
grant execute on function public.doctor_appointment_attachment(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
