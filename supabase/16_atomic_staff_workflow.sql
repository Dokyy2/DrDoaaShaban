-- Make staff appointment changes and their audit records one transaction.
-- Apply only to the isolated clinic trial after reviewing the exact target.
begin;

create or replace function public.record_appointment_workflow(
  p_appointment_id bigint,
  p_expected_status public.appointment_status,
  p_new_status public.appointment_status,
  p_changes jsonb,
  p_event_note text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.appointments%rowtype;
  v_settings public.clinic_settings%rowtype;
  v_patient_phone text;
  v_finance_enabled boolean;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_is_waitlist boolean;
  v_booked_count integer;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  if p_new_status = 'completed' then
    select finance_enabled into v_finance_enabled
      from public.clinic_settings where id = true;
    if coalesce(v_finance_enabled, false) then
      raise exception 'use the visit and payment workflow' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(v_changes) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(v_changes) as keys(key)
       where key not in ('requested_date','requested_time','is_waitlist',
         'contact_note','staff_note','outcome_reason','outcome_note',
         'clinic_birth_recorded')
     ) then
    raise exception 'unsupported appointment changes' using errcode = '22023';
  end if;
  if length(coalesce(p_event_note, '')) > 1000 then
    raise exception 'workflow note is too long' using errcode = '22023';
  end if;

  select * into v_current from public.appointments
    where id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;
  if v_current.status is distinct from p_expected_status then
    raise exception 'appointment changed; refresh and review the latest status' using errcode = '40001';
  end if;

  if p_new_status in ('contacted','confirmed')
     and nullif(v_changes ->> 'requested_time', '') is null
     and v_current.requested_time is null then
    raise exception 'appointment time is required' using errcode = '22023';
  end if;
  if p_new_status in ('follow_up','rescheduled')
     and (nullif(v_changes ->> 'requested_date', '') is null
       or nullif(v_changes ->> 'requested_time', '') is null) then
    raise exception 'new date and time are required' using errcode = '22023';
  end if;
  if p_new_status in ('follow_up','rescheduled') then
    select * into v_settings from public.clinic_settings where id = true;
    if not found then
      raise exception 'clinic settings are unavailable' using errcode = '23514';
    end if;
    if v_current.request_type <> 'birth' and (
       extract(dow from (v_changes ->> 'requested_date')::date)::integer = any(v_settings.closed_weekdays)
       or (v_changes ->> 'requested_date')::date = any(v_settings.closed_dates)) then
      raise exception 'clinic is closed on the selected date' using errcode = '23514';
    end if;

    select regexp_replace(phone, '[^0-9]', '', 'g') into v_patient_phone
      from public.patients where id = v_current.patient_id;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('clinic-booking-phone:' || v_patient_phone, 0));
    if exists (
      select 1 from public.appointments a
      where a.patient_id = v_current.patient_id
        and a.requested_date = (v_changes ->> 'requested_date')::date
        and a.id <> v_current.id
        and a.status in ('new','contacted','confirmed','rescheduled','follow_up')
    ) then
      raise exception 'patient already has an active booking on this date' using errcode = '23505';
    end if;

    v_is_waitlist := case when v_changes ? 'is_waitlist'
      then (v_changes ->> 'is_waitlist')::boolean else v_current.is_waitlist end;
    if not coalesce(v_is_waitlist, false)
       and v_current.request_type in ('first','follow','consult','aesthetic') then
      perform pg_advisory_xact_lock(hashtextextended('clinic-booking-date:' || (v_changes ->> 'requested_date'), 0));
      select count(*) into v_booked_count from public.appointments a
      where a.requested_date = (v_changes ->> 'requested_date')::date
        and a.request_type in ('first','follow','consult','aesthetic')
        and a.status not in ('cancelled','no_show')
        and a.id <> v_current.id;
      if v_booked_count >= v_settings.max_daily_slots then
        raise exception 'daily appointment capacity reached' using errcode = '23514';
      end if;
    end if;
  end if;
  if p_new_status in ('cancelled','no_show')
     and nullif(btrim(coalesce(v_changes ->> 'outcome_reason', '')), '') is null then
    raise exception 'outcome reason is required' using errcode = '22023';
  end if;

  update public.appointments set
    status = p_new_status,
    requested_date = case when v_changes ? 'requested_date'
      then nullif(v_changes ->> 'requested_date', '')::date else requested_date end,
    requested_time = case when v_changes ? 'requested_time'
      then nullif(v_changes ->> 'requested_time', '')::time else requested_time end,
    is_waitlist = case when v_changes ? 'is_waitlist'
      then (v_changes ->> 'is_waitlist')::boolean else is_waitlist end,
    contact_note = case when v_changes ? 'contact_note'
      then coalesce(v_changes ->> 'contact_note', '') else contact_note end,
    staff_note = case when v_changes ? 'staff_note'
      then coalesce(v_changes ->> 'staff_note', '') else staff_note end,
    outcome_reason = case when v_changes ? 'outcome_reason'
      then nullif(v_changes ->> 'outcome_reason', '') else outcome_reason end,
    outcome_note = case when v_changes ? 'outcome_note'
      then coalesce(v_changes ->> 'outcome_note', '') else outcome_note end,
    clinic_birth_recorded = case when v_changes ? 'clinic_birth_recorded'
      then (v_changes ->> 'clinic_birth_recorded')::boolean else clinic_birth_recorded end
  where id = p_appointment_id;

  insert into public.appointment_events (
    appointment_id, actor_id, event_type, old_status, new_status, note
  ) values (
    p_appointment_id, v_actor, 'updated', v_current.status, p_new_status,
    coalesce(p_event_note, '')
  );
end;
$$;

create or replace function public.create_manual_appointment(
  p_patient_id uuid,
  p_request_type text,
  p_requested_date date,
  p_requested_time time,
  p_is_waitlist boolean,
  p_message text,
  p_request_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_settings public.clinic_settings%rowtype;
  v_appointment public.appointments%rowtype;
  v_existing_id bigint;
  v_patient_phone text;
  v_count integer;
  v_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  if p_request_key is null or p_patient_id is null or p_requested_date is null
     or p_request_type not in ('first','follow','consult','aesthetic','birth','labs') then
    raise exception 'manual booking information is incomplete' using errcode = '22023';
  end if;
  if length(coalesce(p_message, '')) > 1200 then
    raise exception 'booking note is too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('manual-booking:' || p_request_key::text, 0));
  select appointment_id into v_existing_id from public.appointment_events
    where source_event_id = p_request_key::text;
  if v_existing_id is not null then
    select * into v_appointment from public.appointments where id = v_existing_id;
    return jsonb_build_object('appointment_id', v_appointment.id,
      'booking_code', v_appointment.booking_code, 'already_created', true);
  end if;

  select regexp_replace(phone, '[^0-9]', '', 'g') into v_patient_phone
    from public.patients where id = p_patient_id;
  if not found then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  -- Share the same per-phone lock as public booking so simultaneous staff and
  -- patient requests cannot both pass their active-booking checks.
  perform pg_advisory_xact_lock(hashtextextended('clinic-booking-phone:' || v_patient_phone, 0));

  select * into v_settings from public.clinic_settings where id = true for update;
  if not found then
    raise exception 'clinic settings are unavailable' using errcode = '23514';
  end if;
  if p_request_type <> 'birth' and (
     extract(dow from p_requested_date)::integer = any(v_settings.closed_weekdays)
     or p_requested_date = any(v_settings.closed_dates)) then
    raise exception 'clinic is closed on the selected date' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.appointments a
    where a.patient_id = p_patient_id and a.requested_date = p_requested_date
      and a.status in ('new','contacted','confirmed','rescheduled','follow_up')
  ) then
    raise exception 'patient already has an active booking on this date' using errcode = '23505';
  end if;

  if not coalesce(p_is_waitlist, false)
     and p_request_type in ('first','follow','consult','aesthetic') then
    perform pg_advisory_xact_lock(hashtextextended('clinic-booking-date:' || p_requested_date::text, 0));
    select count(*) into v_count from public.appointments a
    where a.requested_date = p_requested_date
      and a.request_type in ('first','follow','consult','aesthetic')
      and a.status not in ('cancelled','no_show');
    if v_count >= v_settings.max_daily_slots then
      raise exception 'daily appointment capacity reached' using errcode = '23514';
    end if;
  end if;

  v_status := case when coalesce(p_is_waitlist, false) then 'new'::public.appointment_status
    else 'confirmed'::public.appointment_status end;
  insert into public.appointments (
    patient_id, request_type, requested_date, requested_time, is_waitlist,
    message, status, source
  ) values (
    p_patient_id, p_request_type, p_requested_date, p_requested_time,
    coalesce(p_is_waitlist, false), nullif(p_message, ''), v_status, 'dashboard'
  ) returning * into v_appointment;

  insert into public.appointment_events (
    appointment_id, actor_id, event_type, new_status, note, source_event_id
  ) values (
    v_appointment.id, v_actor, 'created', v_status,
    case when coalesce(p_is_waitlist, false)
      then 'أُضيفت المريضة إلى قائمة الانتظار من ملفها.'
      else 'حجز يدوي من ملف المريضة.' end,
    p_request_key::text
  );
  return jsonb_build_object('appointment_id', v_appointment.id,
    'booking_code', v_appointment.booking_code, 'already_created', false);
end;
$$;

-- Expand-only rollout: keep the existing authenticated table grants intact so
-- the already-published with-admin client continues to work during local trial.
-- The new dashboard uses these RPCs for atomic writes. Tightening legacy table
-- grants belongs to a separate coordinated cutover after every deployed client
-- has migrated; never combine that breaking change with this expand migration.

revoke all on function public.record_appointment_workflow(bigint, public.appointment_status, public.appointment_status, jsonb, text) from public, anon;
revoke all on function public.create_manual_appointment(uuid, text, date, time, boolean, text, uuid) from public, anon;
grant execute on function public.record_appointment_workflow(bigint, public.appointment_status, public.appointment_status, jsonb, text) to authenticated;
grant execute on function public.create_manual_appointment(uuid, text, date, time, boolean, text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
