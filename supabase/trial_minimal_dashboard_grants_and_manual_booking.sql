-- Idempotent manual booking and narrowly scoped dashboard read grants.
begin;
alter table public.appointment_events add column if not exists source_event_id text;
alter table public.clinic_expenses add column if not exists source_event_id text;
alter table public.booking_alerts add column if not exists source_event_id text;
create unique index if not exists appointment_events_source_event_id_uidx on public.appointment_events(source_event_id) where source_event_id is not null;
create unique index if not exists clinic_expenses_source_event_id_uidx on public.clinic_expenses(source_event_id) where source_event_id is not null;
create unique index if not exists booking_alerts_source_event_id_uidx on public.booking_alerts(source_event_id) where source_event_id is not null;

revoke all on public.profiles, public.patients, public.appointments, public.appointment_events,
  public.clinic_settings, public.booking_alerts, public.payment_audit,
  public.clinic_expenses, public.patient_private_notes, public.clinic_admin_audit,
  public.clinic_team_events from public, anon, authenticated;
grant select (id, full_name, role, created_at) on public.profiles to authenticated;
grant select (id, full_name, phone, created_at, updated_at, clinic_births) on public.patients to authenticated;
grant select (id, booking_code, patient_id, request_type, requested_date, last_visit_date,
  message, attachment_name, attachment_type, status, source, staff_note, created_at,
  updated_at, requested_time, is_waitlist, outcome_reason, outcome_note, contact_note,
  clinic_birth_recorded) on public.appointments to authenticated;
grant select (id, appointment_id, actor_id, event_type, old_status, new_status, created_at)
  on public.appointment_events to authenticated;
grant select (id, clinic_name, work_start, work_end, max_daily_slots, closed_weekdays, closed_dates, updated_at)
  on public.clinic_settings to authenticated;
grant select (id, full_name, phone, request_type, requested_date, source_event_id, alert_type,
  reason, matched_appointment_id, status, resolution_note, resolved_by, resolved_at, created_at)
  on public.booking_alerts to authenticated;
grant select (id, appointment_id, changed_by, changed_by_name, old_amount_due, new_amount_due,
  old_amount_paid, new_amount_paid, old_payment_method, new_payment_method, old_payment_note,
  new_payment_note, changed_at) on public.payment_audit to authenticated;
grant select (id, expense_date, category, amount, note, created_by, created_at)
  on public.clinic_expenses to authenticated;
grant select (patient_id, private_note, updated_by, updated_at) on public.patient_private_notes to authenticated;
grant select (id, actor_id, action, entity_type, entity_id, changed_fields, created_at)
  on public.clinic_admin_audit to authenticated;
grant select (id, actor_id, target_user_id, target_email, action, old_role, new_role, created_at)
  on public.clinic_team_events to authenticated;

create or replace view public.staff_appointment_events with (security_invoker = true) as
  select id, appointment_id, actor_id, event_type, old_status, new_status, created_at
  from public.appointment_events;
grant select on public.staff_appointment_events to authenticated;
drop policy if exists "doctor reads clinic team audit" on public.clinic_team_events;
create policy "permitted team audit readers" on public.clinic_team_events
  for select to authenticated using (private.is_owner() or private.has_clinic_permission('team.view'));
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
  if v_actor is null or not private.is_staff() or not private.has_clinic_permission('appointments.create') then
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


revoke all on function public.create_manual_appointment(uuid,text,date,time,boolean,text,uuid) from public, anon;
grant execute on function public.create_manual_appointment(uuid,text,date,time,boolean,text,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

