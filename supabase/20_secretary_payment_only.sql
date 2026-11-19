-- Secretaries may record one payment for a visit already closed by the doctor.
-- They cannot close visits, inspect payment history/reports, or manage finance.
-- Apply only to the confirmed clinic trial database after reviewing the target.
begin;

create or replace function public.staff_finance_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  return coalesce((select s.finance_enabled from public.clinic_settings s where s.id = true), false);
end;
$$;
revoke all on function public.staff_finance_enabled() from public, anon;
grant execute on function public.staff_finance_enabled() to authenticated;

create or replace function public.staff_payment_available(p_appointment_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'secretary') then
    raise exception 'secretary access required' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.appointments a
    join public.clinic_settings s on s.id = true and s.finance_enabled = true
    where a.id = p_appointment_id and a.status = 'completed'
      and a.amount_due is null and a.amount_paid is null
      and a.payment_method is null and a.payment_recorded_at is null
  );
end;
$$;
revoke all on function public.staff_payment_available(bigint) from public, anon;
grant execute on function public.staff_payment_available(bigint) to authenticated;

create or replace function public.record_appointment_completion(
  p_appointment_id bigint,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_payment_method text,
  p_payment_note text default '',
  p_birth_recorded boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.user_role;
  v_old_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  select p.role into v_actor_role from public.profiles p where p.id = v_actor;
  if v_actor_role::text not in ('doctor','owner') then
    raise exception 'only the doctor may close a visit' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinic_settings where id = true and finance_enabled = true) then
    raise exception 'clinic finance is disabled' using errcode = '23514';
  end if;
  if p_amount_due is null or p_amount_due < 0 or p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'payment amounts must be zero or greater' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then
    raise exception 'unsupported payment method' using errcode = '22023';
  end if;
  select a.status into v_old_status from public.appointments a where a.id = p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode = 'P0002'; end if;

  update public.appointments set status = 'completed', amount_due = p_amount_due,
    amount_paid = p_amount_paid, payment_method = p_payment_method,
    payment_note = coalesce(p_payment_note, ''), payment_recorded_by = v_actor,
    payment_recorded_at = now(),
    clinic_birth_recorded = case when request_type = 'birth' then coalesce(p_birth_recorded, false) else clinic_birth_recorded end
  where id = p_appointment_id;

  insert into public.appointment_events (appointment_id, actor_id, event_type, old_status, new_status, note)
  values (p_appointment_id, v_actor, 'updated', v_old_status, 'completed', 'تم تسجيل إتمام الزيارة.');
end;
$$;
revoke all on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) from public, anon;
grant execute on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) to authenticated;

create or replace function public.doctor_close_visit_without_payment(p_appointment_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_status public.appointment_status;
begin
  if v_actor is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinic_settings where id = true and finance_enabled = true) then
    raise exception 'clinic finance is disabled' using errcode = '23514';
  end if;
  select a.status into v_status from public.appointments a where a.id = p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode = 'P0002'; end if;
  if v_status not in ('new','contacted','confirmed','rescheduled','follow_up') then
    raise exception 'only an active visit can be closed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.appointments a where a.id = p_appointment_id
      and a.amount_due is null and a.amount_paid is null and a.payment_method is null and a.payment_recorded_at is null) then
    raise exception 'payment information already exists' using errcode = '23514';
  end if;
  update public.appointments set status = 'completed' where id = p_appointment_id;
  insert into public.appointment_events (appointment_id, actor_id, event_type, old_status, new_status, note)
  values (p_appointment_id, v_actor, 'updated', v_status, 'completed', 'تم إغلاق الزيارة مع تأجيل تسجيل الدفع.');
end;
$$;
revoke all on function public.doctor_close_visit_without_payment(bigint) from public, anon;
grant execute on function public.doctor_close_visit_without_payment(bigint) to authenticated;

create or replace function public.record_appointment_payment(
  p_appointment_id bigint,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_payment_method text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_status public.appointment_status;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'clinic staff access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_actor and p.role = 'secretary') then
    raise exception 'secretary payment entry only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinic_settings where id = true and finance_enabled = true) then
    raise exception 'clinic finance is disabled' using errcode = '23514';
  end if;
  if p_amount_due is null or p_amount_due < 0 or p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'payment amounts must be zero or greater' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then
    raise exception 'unsupported payment method' using errcode = '22023';
  end if;
  select a.status into v_status from public.appointments a where a.id = p_appointment_id for update;
  if not found then raise exception 'appointment not found' using errcode = 'P0002'; end if;
  if v_status <> 'completed' then raise exception 'doctor must close the visit before payment entry' using errcode = '42501'; end if;
  if not exists (select 1 from public.appointments a where a.id = p_appointment_id
      and a.amount_due is null and a.amount_paid is null and a.payment_method is null and a.payment_recorded_at is null) then
    raise exception 'payment is already recorded or unavailable' using errcode = '23514';
  end if;

  update public.appointments set amount_due = p_amount_due, amount_paid = p_amount_paid,
    payment_method = p_payment_method, payment_recorded_by = v_actor, payment_recorded_at = now()
  where id = p_appointment_id;
  insert into public.appointment_events (appointment_id, actor_id, event_type, old_status, new_status, note)
  values (p_appointment_id, v_actor, 'updated', 'completed', 'completed', 'تم تسجيل الدفع بواسطة السكرتارية.');
end;
$$;
revoke all on function public.record_appointment_payment(bigint,numeric,numeric,text) from public, anon;
grant execute on function public.record_appointment_payment(bigint,numeric,numeric,text) to authenticated;

-- Keep the Excel archive snapshot in sync when payment is entered after closure.
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
  if new.status not in ('completed','cancelled','no_show') then return new; end if;
  if old.status is not distinct from new.status
     and old.amount_due is not distinct from new.amount_due
     and old.amount_paid is not distinct from new.amount_paid
     and old.payment_method is not distinct from new.payment_method
     and old.payment_note is not distinct from new.payment_note
     and old.payment_recorded_at is not distinct from new.payment_recorded_at
     and old.payment_recorded_by is not distinct from new.payment_recorded_by then return new; end if;
  select * into patient from public.patients where id = new.patient_id;
  snapshot := jsonb_build_object(
    'appointment_id', new.id, 'booking_code', new.booking_code, 'full_name', patient.full_name,
    'phone', patient.phone, 'request_type', new.request_type, 'requested_date', new.requested_date,
    'requested_time', new.requested_time, 'last_visit_date', new.last_visit_date,
    'created_at', new.created_at, 'updated_at', new.updated_at, 'source', new.source,
    'message', new.message, 'attachment_name', new.attachment_name, 'attachment_type', new.attachment_type,
    'is_waitlist', new.is_waitlist, 'status', new.status, 'outcome_reason', new.outcome_reason,
    'outcome_note', new.outcome_note, 'contact_note', new.contact_note, 'staff_note', new.staff_note,
    'amount_due', new.amount_due, 'amount_paid', new.amount_paid, 'payment_method', new.payment_method,
    'payment_note', new.payment_note, 'payment_recorded_at', new.payment_recorded_at,
    'payment_recorded_by', new.payment_recorded_by, 'clinic_birth_recorded', new.clinic_birth_recorded,
    'closed_at', pg_catalog.now()
  );
  insert into public.clinic_closed_case_archive
    (appointment_id, booking_code, payload, sync_status, attempts, last_error, created_at, synced_at)
  values (new.id, coalesce(new.booking_code, new.id::text), snapshot, 'pending', 0, null, pg_catalog.now(), null)
  on conflict (appointment_id) do update set booking_code = excluded.booking_code, payload = excluded.payload,
    sync_status = 'pending', attempts = 0, last_error = null, created_at = pg_catalog.now(), synced_at = null;
  return new;
end;
$$;
revoke all on function public.enqueue_closed_case_sheet_archive() from public, anon, authenticated;
drop trigger if exists appointments_closed_case_sheet_archive on public.appointments;
create trigger appointments_closed_case_sheet_archive
after update of status, amount_due, amount_paid, payment_method, payment_note, payment_recorded_at, payment_recorded_by
on public.appointments for each row execute function public.enqueue_closed_case_sheet_archive();

create or replace function private.prevent_secretary_visit_closure()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'secretary')
     and (
       (new.status = 'completed' and old.status is distinct from 'completed')
       or (old.status in ('completed','cancelled','no_show') and new.status is distinct from old.status)
     ) then
    raise exception 'only the doctor may close or reopen a terminal visit' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_secretary_visit_closure() from public, anon, authenticated;
drop trigger if exists guard_secretary_visit_closure on public.appointments;
create trigger guard_secretary_visit_closure before update of status on public.appointments
for each row execute function private.prevent_secretary_visit_closure();

notify pgrst, 'reload schema';
commit;
