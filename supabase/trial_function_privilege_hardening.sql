-- Trial-specific callable-function hardening, aligned to functions present in the clean baseline.
begin;
alter function public.touch_updated_at() set search_path = pg_catalog, public;
alter function public.set_booking_code() set search_path = pg_catalog, public;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_payment_change() from public, anon, authenticated;
revoke all on function public.sync_clinic_birth_count() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.is_doctor() from public, anon, authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_doctor() to authenticated;
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon;
commit;
