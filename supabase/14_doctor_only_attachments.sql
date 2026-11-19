-- Doctor-only access to appointment attachment bodies.
-- Apply only to the isolated trial project after review; never expose the body
-- through a direct PostgREST table select for general authenticated staff.
begin;

-- Clear any broad SELECT privilege while retaining the minimum appointment
-- columns used by the staff dashboard. Finance remains available only through
-- the existing doctor finance RPCs.
revoke select on public.appointments from public, anon, authenticated;
revoke select (attachment_base64) on public.appointments from public, anon, authenticated;
grant select (
  id, booking_code, patient_id, request_type, requested_date, last_visit_date,
  message, attachment_name, attachment_type, status, source, staff_note,
  created_at, updated_at, requested_time, is_waitlist, outcome_reason,
  outcome_note, contact_note, clinic_birth_recorded
) on public.appointments to authenticated;

create or replace function public.doctor_appointment_attachment(p_appointment_id bigint)
returns table (attachment_base64 text, attachment_type text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;

  return query
  select a.attachment_base64, a.attachment_type
  from public.appointments as a
  where a.id = p_appointment_id
    and a.attachment_base64 is not null;
end;
$$;

revoke all on function public.doctor_appointment_attachment(bigint) from public, anon;
grant execute on function public.doctor_appointment_attachment(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
