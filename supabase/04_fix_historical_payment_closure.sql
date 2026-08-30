-- إصلاح إقفال البيانات التاريخية بعد ظهور خطأ changed_by_name.
-- شغّلي هذا الملف مرة واحدة فقط إذا كانت ترقية المرحلة الثالثة توقفت بهذا الخطأ.

create or replace function public.log_payment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_staff_name text := '';
begin
  if old.amount_paid is distinct from new.amount_paid
     or old.amount_due is distinct from new.amount_due
     or old.payment_method is distinct from new.payment_method
     or old.payment_note is distinct from new.payment_note then
    select coalesce(full_name, '') into v_staff_name from public.profiles where id = auth.uid();
    v_staff_name := coalesce(nullif(v_staff_name, ''), 'إقفال تاريخي للنظام');
    insert into public.payment_audit (
      appointment_id, changed_by, changed_by_name,
      old_amount_due, new_amount_due, old_amount_paid, new_amount_paid,
      old_payment_method, new_payment_method, old_payment_note, new_payment_note
    ) values (
      new.id, auth.uid(), v_staff_name,
      old.amount_due, new.amount_due, old.amount_paid, new.amount_paid,
      old.payment_method, new.payment_method,
      coalesce(old.payment_note, ''), coalesce(new.payment_note, '')
    );
  end if;
  return new;
end; $$;

update public.clinic_settings
set finance_start_date = date '2026-09-01'
where id = true;

update public.appointments a
set
  amount_due = coalesce(a.amount_due, (select coalesce((s.service_prices ->> a.request_type)::numeric, 0) from public.clinic_settings s where s.id = true)),
  amount_paid = coalesce(a.amount_paid, (select coalesce((s.service_prices ->> a.request_type)::numeric, 0) from public.clinic_settings s where s.id = true)),
  payment_method = coalesce(a.payment_method, 'cash'),
  payment_note = case when coalesce(a.payment_note, '') = '' then 'إقفال تاريخي قبل بداية الحسابات الجديدة' else a.payment_note end,
  payment_recorded_at = coalesce(a.payment_recorded_at, a.created_at, now())
where a.status = 'completed'
  and a.requested_date < date '2026-09-01'
  and (a.amount_paid is null or a.payment_method is null);
