-- DRAFT ONLY: review and validate with the Supabase CLI/PostgreSQL before use.
-- Keep the staff-facing event view read-only for authenticated staff.
-- The underlying appointment_events table remains protected by its own RLS.
begin;

revoke all on table public.staff_appointment_events from public, anon, authenticated;
grant select on table public.staff_appointment_events to authenticated;

notify pgrst, 'reload schema';
commit;
