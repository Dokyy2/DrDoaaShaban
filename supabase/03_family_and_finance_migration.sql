-- المرحلة الثالثة: شغّلي هذا الملف بعد 01 و patient_followup_migration.sql.
-- يضيف عضوية عائلة العيادة والحسابات؛ لا يحذف أي بيانات سابقة.

alter table public.clinic_settings
  add column if not exists service_prices jsonb not null default '{"first":0,"follow":0,"consult":0,"aesthetic":0,"birth":0,"labs":0}'::jsonb,
  add column if not exists finance_enabled boolean not null default false,
  add column if not exists finance_start_date date not null default current_date;

alter table public.appointments
  add column if not exists amount_due numeric(12,2),
  add column if not exists amount_paid numeric(12,2),
  add column if not exists payment_method text,
  add column if not exists payment_note text not null default '',
  add column if not exists payment_recorded_by uuid references public.profiles(id) on delete set null,
  add column if not exists payment_recorded_at timestamptz,
  add column if not exists contact_note text not null default '',
  add column if not exists clinic_birth_recorded boolean not null default false;

alter table public.patients
  add column if not exists clinic_births integer not null default 0 check (clinic_births >= 0);

-- وسائل الدفع التي تظهر للسكرتارية عند إتمام الزيارة.
alter table public.appointments drop constraint if exists appointments_payment_method_check;
update public.appointments
set payment_method = case payment_method
  when 'card' then 'visa'
  when 'wallet' then 'vodafone_cash'
  when 'transfer' then 'instapay'
  else payment_method
end
where payment_method in ('card','wallet','transfer');
alter table public.appointments add constraint appointments_payment_method_check
  check (payment_method is null or payment_method in ('cash','visa','instapay','vodafone_cash','other'));

create index if not exists appointments_payment_date_idx on public.appointments(payment_recorded_at desc) where amount_paid is not null;

-- تنظيم وقت الموعد، قائمة الانتظار، وأسباب الإلغاء أو عدم الحضور.
alter table public.appointments
  add column if not exists requested_time time,
  add column if not exists is_waitlist boolean not null default false,
  add column if not exists outcome_reason text not null default '',
  add column if not exists outcome_note text not null default '';
create index if not exists appointments_schedule_idx on public.appointments(requested_date, requested_time) where requested_time is not null;

-- سجل مستقل لكل تعديل مالي؛ يكتب تلقائيًا ولا يمكن تعديله من لوحة الإدارة.
create table if not exists public.payment_audit (
  id bigint generated always as identity primary key,
  appointment_id bigint not null references public.appointments(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text not null default '',
  old_amount_due numeric(12,2),
  new_amount_due numeric(12,2),
  old_amount_paid numeric(12,2),
  new_amount_paid numeric(12,2),
  old_payment_method text,
  new_payment_method text,
  old_payment_note text not null default '',
  new_payment_note text not null default '',
  changed_at timestamptz not null default now()
);
alter table public.payment_audit add column if not exists changed_by_name text not null default '';
alter table public.payment_audit add column if not exists old_amount_due numeric(12,2);
alter table public.payment_audit add column if not exists new_amount_due numeric(12,2);
alter table public.payment_audit enable row level security;
drop policy if exists "staff reads payment audit" on public.payment_audit;
create policy "staff reads payment audit" on public.payment_audit for select to authenticated using (public.is_staff());
grant select on public.payment_audit to authenticated;

create or replace function public.log_payment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_staff_name text := '';
begin
  if old.amount_paid is distinct from new.amount_paid
     or old.amount_due is distinct from new.amount_due
     or old.payment_method is distinct from new.payment_method
     or old.payment_note is distinct from new.payment_note then
    select coalesce(full_name, '') into v_staff_name from public.profiles where id = auth.uid();
    insert into public.payment_audit (appointment_id, changed_by, changed_by_name, old_amount_due, new_amount_due, old_amount_paid, new_amount_paid, old_payment_method, new_payment_method, old_payment_note, new_payment_note)
    values (new.id, auth.uid(), v_staff_name, old.amount_due, new.amount_due, old.amount_paid, new.amount_paid, old.payment_method, new.payment_method, coalesce(old.payment_note, ''), coalesce(new.payment_note, ''));
  end if;
  return new;
end; $$;
drop trigger if exists appointments_payment_audit on public.appointments;
create trigger appointments_payment_audit after update on public.appointments
for each row execute function public.log_payment_change();

-- لا تُسجل الولادة إلا من بطاقة حجز ولادة داخل لوحة الإدارة، والعداد يُحدّث تلقائيًا.
create or replace function public.sync_clinic_birth_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.request_type = 'birth' and new.clinic_birth_recorded is true and coalesce(old.clinic_birth_recorded, false) is false then
    update public.patients set clinic_births = clinic_births + 1 where id = new.patient_id;
  elsif new.request_type = 'birth' and new.clinic_birth_recorded is false and coalesce(old.clinic_birth_recorded, false) is true then
    update public.patients set clinic_births = greatest(clinic_births - 1, 0) where id = new.patient_id;
  end if;
  return new;
end; $$;
drop trigger if exists appointments_birth_counter on public.appointments;
create trigger appointments_birth_counter after update of clinic_birth_recorded on public.appointments
for each row execute function public.sync_clinic_birth_count();

-- المصروفات تظهر للدكتورة فقط، ثم تدخل في صافي دخل الشهر.
create table if not exists public.clinic_expenses (
  id bigint generated always as identity primary key,
  expense_date date not null default current_date,
  category text not null default 'أخرى',
  amount numeric(12,2) not null check (amount >= 0),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.clinic_expenses enable row level security;
drop policy if exists "doctor manages clinic expenses" on public.clinic_expenses;
create policy "doctor manages clinic expenses" on public.clinic_expenses for all to authenticated using (public.is_doctor()) with check (public.is_doctor());
grant select, insert, update, delete on public.clinic_expenses to authenticated;
grant usage, select on sequence public.clinic_expenses_id_seq to authenticated;

-- كل مريضة لديها ملف سابق تُعد بالفعل من عائلة العيادة.
-- عند تسجيل رقم موجود من شاشة العائلة لا ينشئ طلبًا مكررًا، ويعرض رسالة ترحيب بدلًا من ذلك.
create or replace function public.create_booking(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_name_normalized text;
  v_phone text := regexp_replace(coalesce(payload ->> 'phone', ''), '[^0-9]', '', 'g');
  v_type text := trim(coalesce(payload ->> 'type', ''));
  v_date date := nullif(payload ->> 'bookingDate', '')::date;
  v_patient uuid;
  v_appointment public.appointments;
  v_settings public.clinic_settings;
  v_count integer;
  v_existing_appointment bigint;
  v_name_match_patient uuid;
begin
  if v_type not in ('first', 'follow', 'consult', 'aesthetic', 'birth', 'labs', 'contacts') then
    return jsonb_build_object('status', 'error', 'message', 'نوع الطلب غير صحيح.');
  end if;
  if array_length(regexp_split_to_array(v_name, '[[:space:]]+'), 1) < 3 then
    return jsonb_build_object('status', 'error', 'message', 'من فضلكِ اكتبي الاسم الثلاثي.');
  end if;
  if v_phone !~ '^01[0-9]{9}$' then
    return jsonb_build_object('status', 'error', 'message', 'رقم الهاتف يجب أن يكون 11 رقمًا صحيحًا.');
  end if;

  if v_type = 'contacts' then
    select id into v_patient from public.patients where phone = v_phone limit 1;
    if v_patient is not null then
      return jsonb_build_object('status', 'family_member', 'message', 'أنتِ من عائلة العيادة بالفعل منذ أول حجز لكِ معنا. يسعدنا استمرارك معنا دائمًا.');
    end if;
    v_date := null;
  end if;
  if v_type <> 'contacts' and v_date is null then
    return jsonb_build_object('status', 'error', 'message', 'من فضلكِ اختاري تاريخ الحجز.');
  end if;
  if v_date is not null and v_date < current_date then
    return jsonb_build_object('status', 'error', 'message', 'لا يمكن اختيار تاريخ سابق للحجز.');
  end if;
  if length(coalesce(payload ->> 'attachmentBase64', '')) > 7000000 then
    return jsonb_build_object('status', 'error', 'message', 'حجم المرفق كبير جدًا. يرجى إرسال ملف أصغر من 5 ميجابايت.');
  end if;

  select a.id into v_existing_appointment
  from public.appointments a join public.patients p on p.id = a.patient_id
  where p.phone = v_phone and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts' and a.requested_date >= current_date
  order by a.created_at desc limit 1;
  if v_existing_appointment is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'محاولة حجز مكرر: يوجد حجز نشط بنفس رقم الهاتف.', 'يوجد حجز نشط بالفعل بنفس رقم الهاتف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'message', 'يوجد حجز قائم بالفعل بهذا الرقم. من فضلكِ تواصلي مع العيادة لتعديل أو تأكيد الموعد.');
  end if;

  v_name_normalized := lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));
  select id into v_name_match_patient from public.patients
  where lower(regexp_replace(trim(full_name), '[[:space:]]+', ' ', 'g')) = v_name_normalized and phone <> v_phone limit 1;
  if v_name_match_patient is not null then
    select id into v_existing_appointment from public.appointments where patient_id = v_name_match_patient order by created_at desc limit 1;
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'تطابق الاسم الثلاثي مع رقم هاتف مختلف؛ يلزم مراجعة العيادة.', 'تم العثور على نفس الاسم الثلاثي برقم هاتف مختلف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'message', 'يوجد ملف سابق بنفس الاسم الثلاثي برقم مختلف. من فضلكِ تواصلي مع العيادة لإتمام الحجز.');
  end if;

  select * into v_settings from public.clinic_settings where id = true;
  if v_date is not null and (extract(dow from v_date)::integer = any(v_settings.closed_weekdays) or v_date = any(v_settings.closed_dates)) then
    return jsonb_build_object('status', 'error', 'message', 'هذا اليوم غير متاح للحجز.');
  end if;
  if v_date is not null and v_type in ('first', 'follow', 'consult', 'aesthetic') then
    select count(*) into v_count from public.appointments where requested_date = v_date and request_type in ('first', 'follow', 'consult', 'aesthetic') and status not in ('cancelled', 'no_show');
    if v_count >= v_settings.max_daily_slots then
      return jsonb_build_object('status', 'error', 'message', 'اكتمل عدد الحجوزات المتاح لهذا اليوم.');
    end if;
  end if;
  insert into public.patients (full_name, phone) values (v_name, v_phone)
    on conflict (phone) do update set full_name = excluded.full_name returning id into v_patient;
  insert into public.appointments (patient_id, request_type, requested_date, last_visit_date, message, attachment_name, attachment_type, attachment_base64, source)
    values (v_patient, v_type, v_date, nullif(payload ->> 'lastVisit', '')::date, nullif(payload ->> 'message', ''), nullif(payload ->> 'attachmentName', ''), nullif(payload ->> 'attachmentType', ''), nullif(payload ->> 'attachmentBase64', ''), 'website') returning * into v_appointment;
  insert into public.appointment_events (appointment_id, event_type, new_status, note)
    values (v_appointment.id, 'created', 'new', 'تم استلام طلب الحجز من الموقع.');
  return jsonb_build_object('status', 'success', 'id', v_appointment.booking_code, 'bookingId', v_appointment.booking_code);
exception when others then
  return jsonb_build_object('status', 'error', 'message', 'تعذر تسجيل الحجز الآن. يرجى المحاولة لاحقًا.');
end; $$;

grant execute on function public.create_booking(jsonb) to anon;
