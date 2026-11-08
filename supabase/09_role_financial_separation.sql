-- Enforce the clinic/doctor boundary for financial appointment data.
begin;

-- Authenticated staff can operate appointment workflow, but cannot read or
-- directly mutate payment fields through the REST table API.
revoke select (amount_due, amount_paid, payment_method, payment_note,
  payment_recorded_by, payment_recorded_at)
  on public.appointments from authenticated;
revoke update (amount_due, amount_paid, payment_method, payment_note,
  payment_recorded_by, payment_recorded_at)
  on public.appointments from authenticated;

-- Prices and finance enablement are visible to the doctor only.
revoke select (service_prices, finance_enabled, finance_start_date)
  on public.clinic_settings from authenticated;

create or replace function public.doctor_finance_snapshot()
returns table (
  appointment_id bigint,
  amount_due numeric,
  amount_paid numeric,
  payment_method text,
  payment_note text,
  payment_recorded_by uuid,
  payment_recorded_at timestamptz
)
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
    select a.id, a.amount_due, a.amount_paid, a.payment_method,
           a.payment_note, a.payment_recorded_by, a.payment_recorded_at
    from public.appointments a;
end;
$$;
revoke all on function public.doctor_finance_snapshot() from public, anon;
grant execute on function public.doctor_finance_snapshot() to authenticated;

create or replace function public.doctor_finance_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'finance_enabled', s.finance_enabled,
    'service_prices', s.service_prices,
    'finance_start_date', s.finance_start_date
  ) into result
  from public.clinic_settings s where s.id = true;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.doctor_finance_settings() from public, anon;
grant execute on function public.doctor_finance_settings() to authenticated;

create or replace function public.record_appointment_completion(
  p_appointment_id bigint,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_payment_method text,
  p_payment_note text default '',
  p_birth_recorded boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status public.appointment_status;
begin
  if v_actor is null or not private.is_doctor() then
    raise exception 'doctor access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinic_settings where id = true and finance_enabled = true) then
    raise exception 'clinic finance is disabled' using errcode = '23514';
  end if;
  if p_amount_due is null or p_amount_due < 0 or p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'payment amounts must be zero or greater' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash','visa','instapay','vodafone_cash','other') then
    raise exception 'unsupported payment method' using errcode = '22023';
  end if;

  select a.status into v_old_status
    from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  update public.appointments
    set status = 'completed',
        amount_due = p_amount_due,
        amount_paid = p_amount_paid,
        payment_method = p_payment_method,
        payment_note = coalesce(p_payment_note, ''),
        payment_recorded_by = v_actor,
        payment_recorded_at = now(),
        clinic_birth_recorded = coalesce(p_birth_recorded, false)
    where id = p_appointment_id;

  insert into public.appointment_events (
    appointment_id, actor_id, event_type, old_status, new_status, note
  ) values (
    p_appointment_id, v_actor, 'updated', v_old_status, 'completed',
    'تم تسجيل إتمام الزيارة.'
  );
end;
$$;
revoke all on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) from public, anon;
grant execute on function public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean) to authenticated;

-- Expose event metadata to staff while withholding free-text notes, which may
-- contain amounts or other private details. The invoker view retains base RLS.
grant select (id, appointment_id, actor_id, event_type, old_status, new_status, created_at)
  on public.appointment_events to authenticated;
create or replace view public.staff_appointment_events
with (security_invoker = true) as
select id, appointment_id, actor_id, event_type, old_status, new_status, created_at
from public.appointment_events;
grant select on public.staff_appointment_events to authenticated;

notify pgrst, 'reload schema';
commit;
