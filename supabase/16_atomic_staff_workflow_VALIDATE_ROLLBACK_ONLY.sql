-- Rollback-only integration validation for migrations 16 and 17.
-- Creates a synthetic patient/appointment, verifies atomic audit and no-show
-- archive queueing, then rolls back all schema, grants, and test rows.
BEGIN;
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

-- Expand-only validation: do not alter the legacy table grants used by the
-- already-published with-admin client. Grant tightening is a later cutover.

revoke all on function public.record_appointment_workflow(bigint, public.appointment_status, public.appointment_status, jsonb, text) from public, anon;
revoke all on function public.create_manual_appointment(uuid, text, date, time, boolean, text, uuid) from public, anon;
grant execute on function public.record_appointment_workflow(bigint, public.appointment_status, public.appointment_status, jsonb, text) to authenticated;
grant execute on function public.create_manual_appointment(uuid, text, date, time, boolean, text, uuid) to authenticated;

-- Validate migration 17 in the same rollback-only transaction.
create or replace function public.enqueue_closed_case_sheet_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  patient public.patients%rowtype;
  snapshot jsonb;
begin
  if new.status not in ('completed','cancelled','no_show')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select * into patient from public.patients where id = new.patient_id;
  snapshot := jsonb_build_object(
    'appointment_id', new.id,
    'booking_code', new.booking_code,
    'full_name', patient.full_name,
    'phone', patient.phone,
    'request_type', new.request_type,
    'requested_date', new.requested_date,
    'requested_time', new.requested_time,
    'last_visit_date', new.last_visit_date,
    'created_at', new.created_at,
    'updated_at', new.updated_at,
    'source', new.source,
    'message', new.message,
    'attachment_name', new.attachment_name,
    'attachment_type', new.attachment_type,
    'is_waitlist', new.is_waitlist,
    'status', new.status,
    'outcome_reason', new.outcome_reason,
    'outcome_note', new.outcome_note,
    'contact_note', new.contact_note,
    'staff_note', new.staff_note,
    'amount_due', new.amount_due,
    'amount_paid', new.amount_paid,
    'payment_method', new.payment_method,
    'payment_note', new.payment_note,
    'payment_recorded_at', new.payment_recorded_at,
    'payment_recorded_by', new.payment_recorded_by,
    'clinic_birth_recorded', new.clinic_birth_recorded,
    'closed_at', pg_catalog.now()
  );

  insert into public.clinic_closed_case_archive
    (appointment_id, booking_code, payload, sync_status, attempts, last_error, created_at, synced_at)
  values (new.id, coalesce(new.booking_code, new.id::text), snapshot, 'pending', 0, null, pg_catalog.now(), null)
  on conflict (appointment_id) do update set
    booking_code = excluded.booking_code,
    payload = excluded.payload,
    sync_status = 'pending',
    attempts = 0,
    last_error = null,
    created_at = pg_catalog.now(),
    synced_at = null;

  return new;
end;
$$;
revoke all on function public.enqueue_closed_case_sheet_archive() from public, anon, authenticated;

notify pgrst, 'reload schema';
DO $$
DECLARE
  workflow regprocedure := to_regprocedure('public.record_appointment_workflow(bigint,public.appointment_status,public.appointment_status,jsonb,text)');
  manual regprocedure := to_regprocedure('public.create_manual_appointment(uuid,text,date,time,boolean,text,uuid)');
  archive_trigger regprocedure := to_regprocedure('public.enqueue_closed_case_sheet_archive()');
BEGIN
  IF workflow IS NULL OR manual IS NULL THEN RAISE EXCEPTION 'atomic RPC creation failed'; END IF;
  IF archive_trigger IS NULL OR pg_get_functiondef(archive_trigger) NOT LIKE '%no_show%' THEN RAISE EXCEPTION 'no-show archive trigger function is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND tgname = 'appointments_closed_case_sheet_archive' AND NOT tgisinternal) THEN RAISE EXCEPTION 'closed-case archive trigger is missing'; END IF;
  IF NOT has_function_privilege('authenticated', workflow, 'EXECUTE') OR NOT has_function_privilege('authenticated', manual, 'EXECUTE') THEN RAISE EXCEPTION 'staff RPC grant missing'; END IF;
  IF has_function_privilege('anon', workflow, 'EXECUTE') OR has_function_privilege('anon', manual, 'EXECUTE') THEN RAISE EXCEPTION 'anonymous RPC access remains'; END IF;
END $$;

DO $$
DECLARE
  actor uuid;
  patient uuid;
  capacity_patient uuid;
  visit_date date := current_date + 1;
  duplicate_date date;
  capacity_date date;
  closed_date date;
  phone text;
  capacity_phone text;
  settings public.clinic_settings%rowtype;
BEGIN
  SELECT id INTO actor FROM public.profiles WHERE role = 'doctor' ORDER BY created_at LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'trial doctor profile is required for this rollback-only test'; END IF;
  SELECT * INTO settings FROM public.clinic_settings WHERE id = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'trial clinic settings are required for this rollback-only test'; END IF;
  WHILE extract(dow FROM visit_date)::integer = ANY(settings.closed_weekdays) OR visit_date = ANY(settings.closed_dates) LOOP
    visit_date := visit_date + 1;
  END LOOP;
  duplicate_date := visit_date + 1;
  WHILE extract(dow FROM duplicate_date)::integer = ANY(settings.closed_weekdays) OR duplicate_date = ANY(settings.closed_dates) LOOP
    duplicate_date := duplicate_date + 1;
  END LOOP;
  capacity_date := duplicate_date + 1;
  WHILE extract(dow FROM capacity_date)::integer = ANY(settings.closed_weekdays)
     OR capacity_date = ANY(settings.closed_dates)
     OR EXISTS (SELECT 1 FROM public.appointments a WHERE a.requested_date = capacity_date
       AND a.request_type IN ('first','follow','consult','aesthetic')
       AND a.status NOT IN ('cancelled','no_show')) LOOP
    capacity_date := capacity_date + 1;
  END LOOP;
  closed_date := capacity_date + 1;
  phone := '01' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  INSERT INTO public.patients (full_name, phone) VALUES ('Synthetic Workflow Validation Patient', phone) RETURNING id INTO patient;
  capacity_phone := '01' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  INSERT INTO public.patients (full_name, phone) VALUES ('Synthetic Capacity Validation Patient', capacity_phone) RETURNING id INTO capacity_patient;
  INSERT INTO public.appointments (patient_id, request_type, requested_date, requested_time, is_waitlist, status, source)
  VALUES (patient, 'first', duplicate_date, time '16:15', false, 'confirmed', 'validation');
  INSERT INTO public.appointments (patient_id, request_type, requested_date, requested_time, is_waitlist, status, source)
  VALUES (capacity_patient, 'first', capacity_date, time '16:15', false, 'confirmed', 'validation');
  UPDATE public.clinic_settings SET max_daily_slots = 1,
    closed_dates = array_append(coalesce(closed_dates, ARRAY[]::date[]), closed_date)
  WHERE id = true;
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('clinic.validation.patient_id', patient::text, true);
  PERFORM set_config('clinic.validation.visit_date', visit_date::text, true);
  PERFORM set_config('clinic.validation.duplicate_date', duplicate_date::text, true);
  PERFORM set_config('clinic.validation.capacity_date', capacity_date::text, true);
  PERFORM set_config('clinic.validation.closed_date', closed_date::text, true);
  PERFORM set_config('clinic.validation.request_key', gen_random_uuid()::text, true);
  PERFORM set_config('clinic.validation.appointment_id', '', true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  patient uuid := current_setting('clinic.validation.patient_id')::uuid;
  actor uuid := auth.uid();
  visit_date date := current_setting('clinic.validation.visit_date')::date;
  duplicate_date date := current_setting('clinic.validation.duplicate_date')::date;
  capacity_date date := current_setting('clinic.validation.capacity_date')::date;
  closed_date date := current_setting('clinic.validation.closed_date')::date;
  request_key uuid := current_setting('clinic.validation.request_key')::uuid;
  result jsonb;
  retry_result jsonb;
  v_appointment_id bigint;
  actual_status public.appointment_status;
  event_count integer;
BEGIN
  result := public.create_manual_appointment(patient, 'first', visit_date, time '16:00', true, 'Rollback-only atomic workflow test', request_key);
  v_appointment_id := (result ->> 'appointment_id')::bigint;
  IF v_appointment_id IS NULL OR coalesce((result ->> 'already_created')::boolean, true) THEN RAISE EXCEPTION 'manual booking did not create the expected test appointment'; END IF;
  PERFORM set_config('clinic.validation.appointment_id', v_appointment_id::text, true);
  retry_result := public.create_manual_appointment(patient, 'first', visit_date, time '16:00', true, 'Rollback-only atomic workflow test', request_key);
  IF (retry_result ->> 'appointment_id')::bigint <> v_appointment_id OR NOT coalesce((retry_result ->> 'already_created')::boolean, false) THEN RAISE EXCEPTION 'manual booking retry was not idempotent'; END IF;
  BEGIN
    PERFORM public.create_manual_appointment(patient, 'first', visit_date, time '16:00', true, 'Distinct request duplicate check', gen_random_uuid());
    RAISE EXCEPTION 'duplicate manual booking unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM public.record_appointment_workflow(v_appointment_id, 'new', 'contacted', '{"requested_time":"16:30","is_waitlist":true,"contact_note":"Rollback-only test"}'::jsonb, 'Rollback-only workflow test');
  SELECT a.status INTO actual_status FROM public.appointments AS a WHERE a.id = v_appointment_id;
  SELECT count(*) INTO event_count FROM public.appointment_events AS e WHERE e.appointment_id = v_appointment_id;
  IF actual_status <> 'contacted' OR event_count <> 2 THEN RAISE EXCEPTION 'appointment update and audit events did not agree'; END IF;
  BEGIN
    PERFORM public.record_appointment_workflow(v_appointment_id, 'contacted', 'rescheduled',
      jsonb_build_object('requested_date', duplicate_date::text, 'requested_time', '16:45', 'is_waitlist', true),
      'Rollback-only duplicate reschedule validation');
    RAISE EXCEPTION 'reschedule to a date with another active booking unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_appointment_workflow(v_appointment_id, 'contacted', 'rescheduled',
      jsonb_build_object('requested_date', capacity_date::text, 'requested_time', '16:45', 'is_waitlist', false),
      'Rollback-only capacity reschedule validation');
    RAISE EXCEPTION 'reschedule beyond daily capacity unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_appointment_workflow(v_appointment_id, 'contacted', 'rescheduled',
      jsonb_build_object('requested_date', closed_date::text, 'requested_time', '16:45', 'is_waitlist', true),
      'Rollback-only closed-date reschedule validation');
    RAISE EXCEPTION 'reschedule on a closed date unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT has_column_privilege('authenticated', 'public.appointments', 'status', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.appointments', 'patient_id', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.appointment_events', 'note', 'INSERT') THEN
    RAISE EXCEPTION 'expand-only validation found a legacy client grant was removed';
  END IF;
  PERFORM public.record_appointment_workflow(v_appointment_id, 'contacted', 'no_show', '{"outcome_reason":"validation_no_show"}'::jsonb, 'Rollback-only no-show archive validation');
END $$;

RESET ROLE;
DO $$
DECLARE
  archive_status text;
  archived_payload jsonb;
  v_validation_appointment_id bigint := nullif(current_setting('clinic.validation.appointment_id'), '')::bigint;
BEGIN
  IF v_validation_appointment_id IS NULL THEN RAISE EXCEPTION 'synthetic appointment id was not retained for archive check'; END IF;
  SELECT sync_status, payload INTO archive_status, archived_payload
    FROM public.clinic_closed_case_archive AS closed_archive
    WHERE closed_archive.appointment_id = v_validation_appointment_id;
  IF NOT FOUND OR archive_status <> 'pending' OR archived_payload ->> 'status' <> 'no_show' THEN
    RAISE EXCEPTION 'no-show archive snapshot was not queued with the expected status';
  END IF;
END $$;
-- ROLLBACK ONLY: no schema, grant or synthetic row is retained.
ROLLBACK;
