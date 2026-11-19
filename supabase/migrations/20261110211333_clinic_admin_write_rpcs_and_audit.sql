begin;

-- Record administration actions without copying amounts, notes, or patient text.
create table if not exists public.clinic_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (action in (
    'clinic_expense.created', 'clinic_expense.updated', 'clinic_expense.deleted',
    'clinic_settings.updated', 'patient_private_note.created', 'patient_private_note.updated',
    'booking_alert.resolved'
  )),
  entity_type text not null check (entity_type in (
    'clinic_expense', 'clinic_settings', 'patient_private_note', 'booking_alert'
  )),
  entity_id text not null,
  changed_fields text[] not null check (cardinality(changed_fields) > 0),
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists clinic_admin_audit_entity_idx
  on public.clinic_admin_audit (entity_type, entity_id, created_at desc);

alter table public.clinic_admin_audit enable row level security;
revoke all on public.clinic_admin_audit from public, anon, authenticated;
grant select on public.clinic_admin_audit to authenticated;
drop policy if exists "doctor reads clinic admin audit" on public.clinic_admin_audit;
create policy "doctor reads clinic admin audit"
  on public.clinic_admin_audit
  for select to authenticated
  using (private.is_doctor());

create or replace function public.audit_clinic_expense_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
  v_action text;
  v_entity_id text;
begin
  if tg_op = 'INSERT' then
    v_action := 'clinic_expense.created';
    v_entity_id := new.id::text;
    v_fields := array['expense_date', 'category', 'amount', 'note'];
  elsif tg_op = 'UPDATE' then
    v_action := 'clinic_expense.updated';
    v_entity_id := new.id::text;
    v_fields := array_remove(array[
      case when old.expense_date is distinct from new.expense_date then 'expense_date' end,
      case when old.category is distinct from new.category then 'category' end,
      case when old.amount is distinct from new.amount then 'amount' end,
      case when old.note is distinct from new.note then 'note' end
    ], null);
  elsif tg_op = 'DELETE' then
    v_action := 'clinic_expense.deleted';
    v_entity_id := old.id::text;
    v_fields := array['expense_date', 'category', 'amount', 'note'];
  else
    raise exception 'unsupported clinic expense operation' using errcode = '22023';
  end if;

  if cardinality(v_fields) > 0 then
    insert into public.clinic_admin_audit
      (actor_id, action, entity_type, entity_id, changed_fields)
    values
      (auth.uid(), v_action, 'clinic_expense', v_entity_id, v_fields);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_clinic_expense_change() from public, anon, authenticated;
drop trigger if exists clinic_expenses_audit on public.clinic_expenses;
create trigger clinic_expenses_audit
  after insert or update or delete on public.clinic_expenses
  for each row execute function public.audit_clinic_expense_change();

create or replace function public.record_clinic_expense(
  p_expense_date date,
  p_category text,
  p_amount numeric,
  p_note text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_id bigint;
  v_category text := btrim(coalesce(p_category, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_actor is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if p_expense_date is null then
    raise exception 'expense date is required' using errcode = '22023';
  end if;
  if v_category = '' or char_length(v_category) > 80 then
    raise exception 'expense category must be 1 to 80 characters' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 9999999999.99
     or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'expense amount is outside the supported range' using errcode = '22023';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'expense note is too long' using errcode = '22023';
  end if;

  insert into public.clinic_expenses (expense_date, category, amount, note, created_by)
  values (p_expense_date, v_category, p_amount, v_note, v_actor)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'expense_date', p_expense_date,
    'amount', p_amount
  );
end;
$$;

revoke all on function public.record_clinic_expense(date, text, numeric, text) from public, anon;
grant execute on function public.record_clinic_expense(date, text, numeric, text) to authenticated;

-- Settings, private notes, and alert resolution share the same value-free audit log.
create or replace function public.audit_clinic_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text;
  v_entity_id text;
  v_action text;
  v_fields text[] := array[]::text[];
begin
  if tg_table_name = 'clinic_settings' and tg_op = 'UPDATE' then
    v_entity_type := 'clinic_settings';
    v_entity_id := 'true';
    v_action := 'clinic_settings.updated';
    v_fields := array_remove(array[
      case when old.clinic_name is distinct from new.clinic_name then 'clinic_name' end,
      case when old.work_start is distinct from new.work_start then 'work_start' end,
      case when old.work_end is distinct from new.work_end then 'work_end' end,
      case when old.max_daily_slots is distinct from new.max_daily_slots then 'max_daily_slots' end,
      case when old.closed_weekdays is distinct from new.closed_weekdays then 'closed_weekdays' end,
      case when old.closed_dates is distinct from new.closed_dates then 'closed_dates' end,
      case when old.service_prices is distinct from new.service_prices then 'service_prices' end,
      case when old.finance_enabled is distinct from new.finance_enabled then 'finance_enabled' end
    ], null);
  elsif tg_table_name = 'patient_private_notes' and tg_op in ('INSERT', 'UPDATE') then
    v_entity_type := 'patient_private_note';
    v_entity_id := new.patient_id::text;
    v_action := case when tg_op = 'INSERT' then 'patient_private_note.created' else 'patient_private_note.updated' end;
    if tg_op = 'INSERT' then
      v_fields := array['private_note'];
    elsif old.private_note is distinct from new.private_note then
      v_fields := array['private_note'];
    end if;
  elsif tg_table_name = 'booking_alerts' and tg_op = 'UPDATE' then
    if new.resolved_at is null or old.resolved_at is not distinct from new.resolved_at then
      return new;
    end if;
    v_entity_type := 'booking_alert';
    v_entity_id := new.id::text;
    v_action := 'booking_alert.resolved';
    v_fields := array_remove(array[
      case when old.status is distinct from new.status then 'status' end,
      case when old.resolved_at is distinct from new.resolved_at then 'resolved_at' end,
      case when old.resolved_by is distinct from new.resolved_by then 'resolved_by' end
    ], null);
  else
    raise exception 'unsupported clinic admin audit operation' using errcode = '22023';
  end if;

  if cardinality(v_fields) > 0 then
    insert into public.clinic_admin_audit
      (actor_id, action, entity_type, entity_id, changed_fields)
    values (v_actor, v_action, v_entity_type, v_entity_id, v_fields);
  end if;
  return new;
end;
$$;

revoke all on function public.audit_clinic_admin_change() from public, anon, authenticated;
drop trigger if exists clinic_settings_audit on public.clinic_settings;
create trigger clinic_settings_audit after update on public.clinic_settings
  for each row execute function public.audit_clinic_admin_change();
drop trigger if exists patient_private_notes_audit on public.patient_private_notes;
create trigger patient_private_notes_audit after insert or update on public.patient_private_notes
  for each row execute function public.audit_clinic_admin_change();
drop trigger if exists booking_alerts_audit on public.booking_alerts;
create trigger booking_alerts_audit after update on public.booking_alerts
  for each row execute function public.audit_clinic_admin_change();

create or replace function public.save_clinic_settings(
  p_clinic_name text,
  p_work_start time,
  p_work_end time,
  p_max_daily_slots integer,
  p_closed_weekdays integer[],
  p_closed_dates date[],
  p_service_prices jsonb,
  p_finance_enabled boolean
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_name text := btrim(coalesce(p_clinic_name, ''));
  v_price jsonb;
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'clinic name must be 2 to 120 characters' using errcode = '22023';
  end if;
  if p_work_start is null or p_work_end is null or p_work_start = p_work_end then
    raise exception 'valid clinic working hours are required' using errcode = '22023';
  end if;
  if p_max_daily_slots is null or p_max_daily_slots < 1 then
    raise exception 'daily capacity must be at least 1' using errcode = '22023';
  end if;
  if p_closed_weekdays is null or cardinality(p_closed_weekdays) > 7
     or exists (select 1 from unnest(p_closed_weekdays) as days(day) where day is null or day < 0 or day > 6) then
    raise exception 'closed weekdays must be values from 0 to 6' using errcode = '22023';
  end if;
  if p_closed_dates is null or cardinality(p_closed_dates) > 366
     or exists (select 1 from unnest(p_closed_dates) as dates(closed_date) where closed_date is null) then
    raise exception 'closed dates list is invalid' using errcode = '22023';
  end if;
  if p_service_prices is null or jsonb_typeof(p_service_prices) <> 'object' then
    raise exception 'service prices must be an object' using errcode = '22023';
  end if;
  for v_price in select value from jsonb_each(p_service_prices) loop
    if jsonb_typeof(v_price) <> 'number' or (v_price #>> '{}')::numeric < 0
       or (v_price #>> '{}')::numeric > 9999999999.99 then
      raise exception 'service price is outside the supported range' using errcode = '22023';
    end if;
  end loop;

  update public.clinic_settings
  set clinic_name = v_name,
      work_start = p_work_start,
      work_end = p_work_end,
      max_daily_slots = p_max_daily_slots,
      closed_weekdays = p_closed_weekdays,
      closed_dates = p_closed_dates,
      service_prices = p_service_prices,
      finance_enabled = coalesce(p_finance_enabled, false)
  where id = true;
  if not found then raise exception 'clinic settings row is missing' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create or replace function public.save_patient_private_note(
  p_patient_id uuid,
  p_private_note text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_note text := btrim(coalesce(p_private_note, ''));
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if p_patient_id is null or not exists (select 1 from public.patients where id = p_patient_id) then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  if char_length(v_note) > 10000 then
    raise exception 'private note is too long' using errcode = '22023';
  end if;
  insert into public.patient_private_notes (patient_id, private_note, updated_by)
  values (p_patient_id, v_note, auth.uid())
  on conflict (patient_id) do update
    set private_note = excluded.private_note,
        updated_by = excluded.updated_by;
  return true;
end;
$$;

create or replace function public.resolve_clinic_alerts(p_alert_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not private.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if p_alert_ids is null or cardinality(p_alert_ids) = 0 or cardinality(p_alert_ids) > 1000
     or exists (select 1 from unnest(p_alert_ids) as ids(alert_id) where alert_id is null or alert_id < 1) then
    raise exception 'alert ids are invalid' using errcode = '22023';
  end if;
  update public.booking_alerts
  set status = 'handled', resolved_at = pg_catalog.now(), resolved_by = auth.uid()
  where id = any(p_alert_ids) and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_clinic_settings(text, time, time, integer, integer[], date[], jsonb, boolean) from public, anon;
grant execute on function public.save_clinic_settings(text, time, time, integer, integer[], date[], jsonb, boolean) to authenticated;
revoke all on function public.save_patient_private_note(uuid, text) from public, anon;
grant execute on function public.save_patient_private_note(uuid, text) to authenticated;
revoke all on function public.resolve_clinic_alerts(bigint[]) from public, anon;
grant execute on function public.resolve_clinic_alerts(bigint[]) to authenticated;

notify pgrst, 'reload schema';
commit;
