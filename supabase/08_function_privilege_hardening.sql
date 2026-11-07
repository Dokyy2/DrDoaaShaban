-- Tighten callable function privileges before the full Sheet-first cutover.
-- The public create_booking RPC remains available only to anonymous visitors
-- until the Apps Script bridge is deployed and migration 07 disables it.

begin;

alter function public.touch_updated_at() set search_path = pg_catalog, public;
alter function public.set_booking_code() set search_path = pg_catalog, public;

-- Trigger functions are invoked by existing triggers; web roles must not call
-- them through PostgREST RPC endpoints.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_payment_change() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.sync_clinic_birth_count() from public, anon, authenticated;

-- RLS helper functions may be evaluated by signed-in staff policies only.
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.is_doctor() from public, anon, authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_doctor() to authenticated;

-- Keep the existing public booking route functioning for anonymous patients,
-- while removing the redundant authenticated/public grants. Migration 07 will
-- revoke anon too after the Sheet-first web app has passed live verification.
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon;

commit;
