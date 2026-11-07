-- Sheet-first security cutover for the commercial edition.
-- DO NOT APPLY until the separate Apps Script bridge has been deployed,
-- configured with Script Properties, and all website/dashboard writes use it.
-- The bridge writes with its server-only service role; browser sessions stay read-only.
-- Apply in Supabase SQL Editor only after reviewing the target project and backup.

begin;

-- Add idempotency keys before column-level grants reference them.
alter table public.appointment_events add column if not exists source_event_id text;
alter table public.clinic_expenses add column if not exists source_event_id text;
alter table public.booking_alerts add column if not exists source_event_id text;

-- Remove broad table grants so column grants below can keep attachment bodies
-- and private clinic notes out of secretary/PostgREST reads.
revoke all on public.profiles, public.patients, public.appointments,
  public.appointment_events, public.clinic_settings, public.booking_alerts,
  public.payment_audit, public.clinic_expenses
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant select (id, full_name, phone, created_at, updated_at, clinic_births)
  on public.patients to authenticated;
grant select (
  id, booking_code, patient_id, request_type, requested_date, last_visit_date,
  message, attachment_name, attachment_type, status, source, staff_note,
  created_at, updated_at, requested_time, is_waitlist, outcome_reason,
  outcome_note, amount_due, amount_paid, payment_method, payment_note,
  payment_recorded_by, payment_recorded_at, contact_note, clinic_birth_recorded
) on public.appointments to authenticated;
grant select (id, appointment_id, actor_id, event_type, old_status, new_status, note, created_at)
  on public.appointment_events to authenticated;
grant select (id, clinic_name, work_start, work_end, max_daily_slots,
  closed_weekdays, closed_dates, service_prices, finance_enabled,
  updated_at) on public.clinic_settings to authenticated;
grant select (id, source_event_id, appointment_id, alert_type, reason, matched_appointment_id,
  status, resolved_at, resolved_by, created_at) on public.booking_alerts to authenticated;
grant select (id, appointment_id, changed_by, changed_by_name, old_amount_due,
  new_amount_due, old_amount_paid, new_amount_paid, old_payment_method,
  new_payment_method, old_payment_note, new_payment_note, changed_at)
  on public.payment_audit to authenticated;
grant select (id, expense_date, category, amount, note, created_by, created_at)
  on public.clinic_expenses to authenticated;

-- Row-level role boundaries complement column grants. Policies are read-only;
-- all mutations must pass the Apps Script role check and Sheet-first write.
drop policy if exists "staff reads patients" on public.patients;
drop policy if exists "staff updates patients" on public.patients;
create policy "staff reads patient directory" on public.patients
  for select to authenticated using (public.is_staff());
drop policy if exists "staff updates appointments" on public.appointments;
drop policy if exists "staff creates events" on public.appointment_events;
drop policy if exists "doctor reads payment audit" on public.payment_audit;
drop policy if exists "staff reads payment audit" on public.payment_audit;
create policy "doctor reads payment audit" on public.payment_audit
  for select to authenticated using (public.is_doctor());
drop policy if exists "doctor manages clinic expenses" on public.clinic_expenses;
create policy "doctor reads clinic expenses" on public.clinic_expenses
  for select to authenticated using (public.is_doctor());
drop policy if exists "doctor updates settings" on public.clinic_settings;

-- Bridge writes use the service role, so auth.uid() is empty. The bridge stamps
-- payment_recorded_by after validating the staff session; use that verified id
-- so the existing audit trigger records the correct staff member.
create or replace function public.log_payment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor_id uuid;
  v_staff_name text := '';
begin
  v_actor_id := coalesce(auth.uid(), new.payment_recorded_by);
  if old.amount_paid is distinct from new.amount_paid
     or old.amount_due is distinct from new.amount_due
     or old.payment_method is distinct from new.payment_method
     or old.payment_note is distinct from new.payment_note then
    select coalesce(full_name, '') into v_staff_name
      from public.profiles where id = v_actor_id;
    v_staff_name := coalesce(nullif(v_staff_name, ''), 'مستخدم العيادة');
    insert into public.payment_audit (
      appointment_id, changed_by, changed_by_name, old_amount_due,
      new_amount_due, old_amount_paid, new_amount_paid, old_payment_method,
      new_payment_method, old_payment_note, new_payment_note
    ) values (
      new.id, v_actor_id, v_staff_name, old.amount_due, new.amount_due,
      old.amount_paid, new.amount_paid, old.payment_method, new.payment_method,
      coalesce(old.payment_note, ''), coalesce(new.payment_note, '')
    );
  end if;
  return new;
end;
$$;

-- Public booking RPC is disabled only after the new Sheet-first booking flow is live.
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;

-- Move sensitive notes to a doctor-only relation. The old column remains in place
-- for rollback, but receives no authenticated column grant after this cutover.
create table if not exists public.patient_private_notes (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  private_note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists appointment_events_source_event_id_uidx
  on public.appointment_events(source_event_id) where source_event_id is not null;
create unique index if not exists clinic_expenses_source_event_id_uidx
  on public.clinic_expenses(source_event_id) where source_event_id is not null;
create unique index if not exists booking_alerts_source_event_id_uidx
  on public.booking_alerts(source_event_id) where source_event_id is not null;
alter table public.patient_private_notes enable row level security;
revoke all on public.patient_private_notes from public, anon, authenticated;
grant all on public.patient_private_notes to service_role;
grant select (patient_id, private_note, updated_by, updated_at)
  on public.patient_private_notes to authenticated;
drop policy if exists "doctor reads patient private notes" on public.patient_private_notes;
create policy "doctor reads patient private notes" on public.patient_private_notes
  for select to authenticated using (public.is_doctor());
insert into public.patient_private_notes (patient_id, private_note)
select id, private_note from public.patients
where nullif(btrim(private_note), '') is not null
on conflict (patient_id) do nothing;

-- Attachment bodies are fetched only when a doctor opens the appointment detail.
create or replace function public.get_appointment_attachment(p_appointment_id bigint)
returns table(attachment_base64 text, attachment_type text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_doctor() then
    raise exception 'doctor role required' using errcode = '42501';
  end if;
  return query select a.attachment_base64, a.attachment_type
    from public.appointments a where a.id = p_appointment_id;
end;
$$;
revoke all on function public.get_appointment_attachment(bigint) from public, anon;
grant execute on function public.get_appointment_attachment(bigint) to authenticated;

commit;

-- Rollback (only if intentionally restoring the previous Supabase-first portal):
-- Re-run the project's reviewed prior security migration and restore its explicit
-- table grants/policies. Do not grant browser writes while the Sheet is canonical.
