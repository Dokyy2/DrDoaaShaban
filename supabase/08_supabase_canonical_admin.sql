-- Supabase is canonical for the admin-enabled local trial.
-- This does not change the original workbook or the no-admin release.
begin;

-- Keep the public booking RPC callable only by the server-side Edge Function.
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to service_role;
alter function public.create_booking(jsonb) set search_path = pg_catalog, public;

-- Staff retain read access under the existing role-aware RLS policies.
grant select (id, full_name, role, created_at) on public.profiles to authenticated;
grant select (id, full_name, phone, created_at, updated_at, clinic_births)
  on public.patients to authenticated;

-- The attachment body is fetched only on explicit staff request, never in list queries.
grant select (
  id, booking_code, patient_id, request_type, requested_date, last_visit_date,
  message, attachment_name, attachment_type, attachment_base64, status, source,
  staff_note, created_at, updated_at, requested_time, is_waitlist,
  outcome_reason, outcome_note, contact_note, amount_due, amount_paid,
  payment_method, payment_note, payment_recorded_by, payment_recorded_at,
  clinic_birth_recorded
) on public.appointments to authenticated;
grant insert (
  patient_id, request_type, requested_date, requested_time, is_waitlist,
  message, status, source
) on public.appointments to authenticated;
grant update (
  status, requested_date, requested_time, is_waitlist, contact_note,
  outcome_reason, outcome_note, staff_note, amount_due, amount_paid,
  payment_method, payment_note, payment_recorded_by, payment_recorded_at,
  clinic_birth_recorded
) on public.appointments to authenticated;

grant select (id, appointment_id, actor_id, event_type, old_status, new_status, note, created_at)
  on public.appointment_events to authenticated;
grant insert (appointment_id, actor_id, event_type, old_status, new_status, note)
  on public.appointment_events to authenticated;

grant select (id, clinic_name, work_start, work_end, max_daily_slots,
  closed_weekdays, closed_dates, service_prices, finance_enabled,
  finance_start_date, updated_at) on public.clinic_settings to authenticated;
grant update (clinic_name, work_start, work_end, max_daily_slots,
  closed_weekdays, closed_dates, service_prices, finance_enabled,
  finance_start_date) on public.clinic_settings to authenticated;

grant select (id, full_name, phone, request_type, requested_date, alert_type,
  reason, message, matched_appointment_id, status, resolution_note,
  resolved_by, resolved_at, created_at, source_event_id)
  on public.booking_alerts to authenticated;
grant update (status, resolution_note, resolved_by, resolved_at)
  on public.booking_alerts to authenticated;

grant select (id, appointment_id, changed_by, changed_by_name,
  old_amount_due, new_amount_due, old_amount_paid, new_amount_paid,
  old_payment_method, new_payment_method, old_payment_note,
  new_payment_note, changed_at) on public.payment_audit to authenticated;
grant select (id, expense_date, category, amount, note, created_by, created_at)
  on public.clinic_expenses to authenticated;
grant insert (expense_date, category, amount, note, created_by)
  on public.clinic_expenses to authenticated;
grant select (patient_id, private_note, updated_by, updated_at)
  on public.patient_private_notes to authenticated;
grant insert (patient_id, private_note, updated_by)
  on public.patient_private_notes to authenticated;
grant update (private_note, updated_by)
  on public.patient_private_notes to authenticated;

-- Keep role checks in RLS. No browser-facing service-role key is introduced.
drop policy if exists "staff creates appointments" on public.appointments;
create policy "staff creates appointments" on public.appointments
  for insert to authenticated with check (private.is_staff());
drop policy if exists "staff updates appointments" on public.appointments;
create policy "staff updates appointments" on public.appointments
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
drop policy if exists "staff creates events" on public.appointment_events;
create policy "staff creates events" on public.appointment_events
  for insert to authenticated with check (private.is_staff() and auth.uid() = actor_id);
drop policy if exists "doctor updates settings" on public.clinic_settings;
create policy "doctor updates settings" on public.clinic_settings
  for update to authenticated using (private.is_doctor()) with check (private.is_doctor());
drop policy if exists "staff updates booking alerts" on public.booking_alerts;
create policy "staff updates booking alerts" on public.booking_alerts
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
drop policy if exists "doctor creates clinic expenses" on public.clinic_expenses;
create policy "doctor creates clinic expenses" on public.clinic_expenses
  for insert to authenticated with check (private.is_doctor() and created_by = auth.uid());
drop policy if exists "doctor reads patient private notes" on public.patient_private_notes;
create policy "doctor reads patient private notes" on public.patient_private_notes
  for select to authenticated using (private.is_doctor());
drop policy if exists "doctor inserts patient private notes" on public.patient_private_notes;
create policy "doctor inserts patient private notes" on public.patient_private_notes
  for insert to authenticated with check (private.is_doctor() and updated_by = auth.uid());
drop policy if exists "doctor updates patient private notes" on public.patient_private_notes;
create policy "doctor updates patient private notes" on public.patient_private_notes
  for update to authenticated using (private.is_doctor())
  with check (private.is_doctor() and updated_by = auth.uid());

commit;
