-- Extend the archived snapshot to match the booking workbook's available fields.
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
  if new.status not in ('completed','cancelled') or old.status is not distinct from new.status then
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
    'closed_at', now()
  );

  insert into public.clinic_closed_case_archive
    (appointment_id, booking_code, payload, sync_status, attempts, last_error, created_at, synced_at)
  values (new.id, coalesce(new.booking_code, new.id::text), snapshot, 'pending', 0, null, now(), null)
  on conflict (appointment_id) do update set
    booking_code = excluded.booking_code,
    payload = excluded.payload,
    sync_status = 'pending',
    attempts = 0,
    last_error = null,
    created_at = now(),
    synced_at = null;

  return new;
end;
$$;

revoke all on function public.enqueue_closed_case_sheet_archive() from public, anon, authenticated;
