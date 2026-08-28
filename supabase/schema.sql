-- Dr. Doaa Shaban Clinic: execute once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.user_role as enum ('pending', 'secretary', 'doctor');
create type public.appointment_status as enum ('new', 'contacted', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique check (phone ~ '^01[0-9]{9}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id bigint generated always as identity primary key,
  booking_code text unique,
  patient_id uuid not null references public.patients(id),
  request_type text not null,
  requested_date date,
  last_visit_date date,
  message text,
  attachment_name text,
  attachment_type text,
  attachment_base64 text,
  status public.appointment_status not null default 'new',
  source text not null default 'website',
  staff_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id bigint not null references public.appointments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  old_status public.appointment_status,
  new_status public.appointment_status,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.clinic_settings (
  id boolean primary key default true check (id),
  clinic_name text not null default 'عيادة د. دعاء شعبان',
  work_start time not null default '16:00',
  work_end time not null default '22:00',
  max_daily_slots integer not null default 20 check (max_daily_slots > 0),
  closed_weekdays integer[] not null default array[4,5],
  closed_dates date[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.clinic_settings (id) values (true) on conflict do nothing;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger patients_touch before update on public.patients for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();

create or replace function public.set_booking_code() returns trigger
language plpgsql as $$ begin
  if new.booking_code is null then
    new.booking_code := 'BK-' || to_char(coalesce(new.requested_date, current_date), 'YYYYMMDD') || '-' || lpad(new.id::text, 5, '0');
  end if;
  return new;
end; $$;
create trigger appointments_code before insert on public.appointments for each row execute function public.set_booking_code();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$ begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end; $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_user();

-- Public website endpoint. It only creates a booking; all reads require staff login.
create or replace function public.create_booking(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_phone text := regexp_replace(coalesce(payload ->> 'phone', ''), '[^0-9]', '', 'g');
  v_type text := trim(coalesce(payload ->> 'type', ''));
  v_date date := nullif(payload ->> 'bookingDate', '')::date;
  v_patient uuid;
  v_appointment public.appointments;
  v_settings public.clinic_settings;
  v_count integer;
begin
  if v_type not in ('first', 'follow', 'consult', 'aesthetic', 'birth', 'labs', 'contacts') then
    return jsonb_build_object('status', 'error', 'message', 'نوع الطلب غير صحيح.');
  end if;
  -- Contact-list registrations are not appointments and must not consume daily capacity.
  if v_type = 'contacts' then
    v_date := null;
  end if;
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
  select * into v_settings from public.clinic_settings where id = true;
  if v_date is not null and (extract(dow from v_date)::integer = any(v_settings.closed_weekdays) or v_date = any(v_settings.closed_dates)) then
    return jsonb_build_object('status', 'error', 'message', 'هذا اليوم غير متاح للحجز.');
  end if;
  if v_date is not null and v_type in ('first', 'follow', 'consult', 'aesthetic') then
    select count(*) into v_count from public.appointments
      where requested_date = v_date
        and request_type in ('first', 'follow', 'consult', 'aesthetic')
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
grant usage on schema public to anon, authenticated;
revoke all on table public.profiles, public.patients, public.appointments, public.appointment_events, public.clinic_settings from anon, authenticated;
grant select, update on public.profiles, public.patients, public.appointments, public.appointment_events, public.clinic_settings to authenticated;
grant insert on public.appointment_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- A new Auth user is never staff by default. This helper is used by all staff
-- policies so an unapproved account cannot read patient data.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('secretary', 'doctor')
  );
$$;

create or replace function public.is_doctor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'doctor'
  );
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
create policy "user reads own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "staff reads patients" on public.patients for select to authenticated using (public.is_staff());
create policy "staff updates patients" on public.patients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff reads appointments" on public.appointments for select to authenticated using (public.is_staff());
create policy "staff updates appointments" on public.appointments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff reads events" on public.appointment_events for select to authenticated using (public.is_staff());
create policy "staff creates events" on public.appointment_events for insert to authenticated with check (public.is_staff() and auth.uid() = actor_id);
create policy "staff reads settings" on public.clinic_settings for select to authenticated using (public.is_staff());
create policy "doctor updates settings" on public.clinic_settings for update to authenticated using (public.is_doctor()) with check (public.is_doctor());

-- After creating staff accounts in Authentication, approve each account explicitly:
-- update public.profiles set role = 'doctor', full_name = 'د. دعاء شعبان' where id = '<doctor-user-uuid>';
-- update public.profiles set role = 'secretary', full_name = 'اسم السكرتارية' where id = '<secretary-user-uuid>';
