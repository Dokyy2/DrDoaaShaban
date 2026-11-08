-- Make the archive's RLS boundary explicit for service-role Apps Script access.
create policy clinic_closed_archive_service_only
  on public.clinic_closed_case_archive
  for all
  to service_role
  using (true)
  with check (true);
