-- Empty optional clinic notes arrive as NULL from older Sheet projections.
-- Keep the NOT NULL contract while normalizing those legacy values.
begin;

create or replace function public.normalize_appointment_staff_note()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.staff_note := coalesce(new.staff_note, '');
  return new;
end;
$$;

revoke all on function public.normalize_appointment_staff_note() from public, anon, authenticated;

drop trigger if exists appointments_normalize_staff_note on public.appointments;
create trigger appointments_normalize_staff_note
before insert or update of staff_note on public.appointments
for each row execute function public.normalize_appointment_staff_note();

commit;
