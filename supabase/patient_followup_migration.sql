-- المرحلة الثانية: شغّلي هذا الملف بعد نجاح 01_add_enum_values.sql.
-- يضيف دفتر المريضات، التنبيهات، الحجز اليدوي، ومنع الحجوزات المكررة.

alter table public.profiles alter column role set default 'pending';
alter table public.patients add column if not exists private_note text not null default '';

create table if not exists public.booking_alerts (
  id bigint generated always as identity primary key,
  full_name text not null,
  phone text not null,
  request_type text not null,
  requested_date date,
  alert_type text not null default 'duplicate_booking',
  reason text not null,
  message text not null default '',
  matched_appointment_id bigint references public.appointments(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'handled')),
  resolution_note text not null default '',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.booking_alerts add column if not exists alert_type text not null default 'duplicate_booking';
alter table public.booking_alerts add column if not exists message text not null default '';

create index if not exists appointments_patient_date_idx on public.appointments(patient_id, requested_date desc);
create index if not exists booking_alerts_status_created_idx on public.booking_alerts(status, created_at desc);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$ begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'pending');
  return new;
end; $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('secretary', 'doctor'));
$$;

create or replace function public.is_doctor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'doctor');
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_doctor() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_doctor() to authenticated;

alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.booking_alerts enable row level security;

drop policy if exists "staff reads profiles" on public.profiles;
drop policy if exists "user reads own profile" on public.profiles;
drop policy if exists "staff reads patients" on public.patients;
drop policy if exists "staff creates patients" on public.patients;
drop policy if exists "staff updates patients" on public.patients;
drop policy if exists "staff reads appointments" on public.appointments;
drop policy if exists "staff creates appointments" on public.appointments;
drop policy if exists "staff updates appointments" on public.appointments;
drop policy if exists "staff reads events" on public.appointment_events;
drop policy if exists "staff creates events" on public.appointment_events;
drop policy if exists "staff reads settings" on public.clinic_settings;
drop policy if exists "doctor updates settings" on public.clinic_settings;
drop policy if exists "staff reads booking alerts" on public.booking_alerts;
drop policy if exists "staff updates booking alerts" on public.booking_alerts;

create policy "user reads own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "staff reads patients" on public.patients for select to authenticated using (public.is_staff());
create policy "staff creates patients" on public.patients for insert to authenticated with check (public.is_staff());
create policy "staff updates patients" on public.patients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff reads appointments" on public.appointments for select to authenticated using (public.is_staff());
create policy "staff creates appointments" on public.appointments for insert to authenticated with check (public.is_staff());
create policy "staff updates appointments" on public.appointments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff reads events" on public.appointment_events for select to authenticated using (public.is_staff());
create policy "staff creates events" on public.appointment_events for insert to authenticated with check (public.is_staff() and auth.uid() = actor_id);
create policy "staff reads settings" on public.clinic_settings for select to authenticated using (public.is_staff());
create policy "doctor updates settings" on public.clinic_settings for update to authenticated using (public.is_doctor()) with check (public.is_doctor());
create policy "staff reads booking alerts" on public.booking_alerts for select to authenticated using (public.is_staff());
create policy "staff updates booking alerts" on public.booking_alerts for update to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, update on public.profiles, public.patients, public.appointments, public.appointment_events, public.clinic_settings to authenticated;
grant select, update on public.booking_alerts to authenticated;
grant insert on public.patients, public.appointments, public.appointment_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

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
  if v_type = 'contacts' then v_date := null; end if;
  if array_length(regexp_split_to_array(v_name, '[[:space:]]+'), 1) < 3 then
    return jsonb_build_object('status', 'error', 'message', 'من فضلكِ اكتبي الاسم الثلاثي.');
  end if;
  if v_phone !~ '^01[0-9]{9}$' then
    return jsonb_build_object('status', 'error', 'message', 'رقم الهاتف يجب أن يكون 11 رقمًا صحيحًا.');
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

  -- يمنع الحجز الجديد طالما يوجد حجز نشط بنفس رقم الهاتف.
  select a.id into v_existing_appointment
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where p.phone = v_phone
    and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts'
    and a.requested_date >= current_date
  order by a.created_at desc
  limit 1;
  if v_existing_appointment is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'محاولة حجز مكرر: يوجد حجز نشط بنفس رقم الهاتف.', 'يوجد حجز نشط بالفعل بنفس رقم الهاتف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'message', 'يوجد حجز قائم بالفعل بهذا الرقم. من فضلكِ تواصلي مع العيادة لتعديل أو تأكيد الموعد.');
  end if;

  -- الاسم الثلاثي نفسه مع رقم مختلف يحتاج مراجعة بشرية قبل إنشاء الحجز.
  v_name_normalized := lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));
  select id into v_name_match_patient
  from public.patients
  where lower(regexp_replace(trim(full_name), '[[:space:]]+', ' ', 'g')) = v_name_normalized
    and phone <> v_phone
  limit 1;
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
    select count(*) into v_count from public.appointments
      where requested_date = v_date and request_type in ('first', 'follow', 'consult', 'aesthetic')
        and status not in ('cancelled', 'no_show');
    if v_count >= v_settings.max_daily_slots then
      return jsonb_build_object('status', 'error', 'message', 'اكتمل عدد الحجوزات المتاح لهذا اليوم.');
    end if;
  end if;
  insert into public.patients (full_name, phone) values (v_name, v_phone)
    on conflict (phone) do update set full_name = excluded.full_name
    returning id into v_patient;
  insert into public.appointments (patient_id, request_type, requested_date, last_visit_date, message, attachment_name, attachment_type, attachment_base64, source)
    values (v_patient, v_type, v_date, nullif(payload ->> 'lastVisit', '')::date, nullif(payload ->> 'message', ''), nullif(payload ->> 'attachmentName', ''), nullif(payload ->> 'attachmentType', ''), nullif(payload ->> 'attachmentBase64', ''), 'website')
    returning * into v_appointment;
  insert into public.appointment_events (appointment_id, event_type, new_status, note)
    values (v_appointment.id, 'created', 'new', 'تم استلام طلب الحجز من الموقع.');
  return jsonb_build_object('status', 'success', 'id', v_appointment.booking_code, 'bookingId', v_appointment.booking_code);
exception when others then
  return jsonb_build_object('status', 'error', 'message', 'تعذر تسجيل الحجز الآن. يرجى المحاولة لاحقًا.');
end; $$;

grant execute on function public.create_booking(jsonb) to anon;
