-- Adds Monday without removing any other configured weekly closed days.
-- Keeps the server-side booking RPC aligned with the v2.7 booking UI.
-- Birth bookingDate is an expected due date, not the appointment date, so it is not compared with weekly closures.
-- Safe to run repeatedly; review before applying to any connected Supabase project.
alter table public.clinic_settings
  alter column closed_weekdays set default array[1,4,5];

update public.clinic_settings as settings
set closed_weekdays = (
  select array_agg(day order by day)
  from (
    select distinct unnest(coalesce(settings.closed_weekdays, array[]::integer[]) || array[1,4,5]) as day
  ) as unique_days
)
where settings.id = true;

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
  v_existing_booking_code text;
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
    -- لا نعرض رسالة «من العائلة» إلا إذا كان لهذا الرقم حجز فعلي سابق،
    -- وليس لمجرد إنشاء بيانات اتصال سابقة.
    select p.id into v_patient
    from public.patients p
    where p.phone = v_phone
      and exists (
        select 1 from public.appointments a
        where a.patient_id = p.id and a.request_type <> 'contacts'
      )
    limit 1;
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

  select a.id, a.booking_code into v_existing_appointment, v_existing_booking_code
  from public.appointments a join public.patients p on p.id = a.patient_id
  where p.phone = v_phone and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts' and a.requested_date >= current_date
  order by a.created_at desc limit 1;
  if v_existing_appointment is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'محاولة حجز مكرر: يوجد حجز نشط بنفس رقم الهاتف.', 'يوجد حجز نشط بالفعل بنفس رقم الهاتف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'bookingId', v_existing_booking_code, 'message', 'تم إيقاف الطلب لأنه حجز مكرر بنفس رقم الهاتف. من فضلكِ تواصلي مع العيادة باستخدام رقم الكشف الظاهر أمامك.');
  end if;

  v_name_normalized := lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));
  -- تطابق الاسم وحده يمنع الحجز فقط إذا كان للملف الآخر حجز نشط.
  -- الحجز الملغي أو الذي لم تحضر صاحبته لا يمنع المريضة من الحجز مرة أخرى.
  select p.id, a.id, a.booking_code into v_name_match_patient, v_existing_appointment, v_existing_booking_code
  from public.patients p join public.appointments a on a.patient_id = p.id
  where lower(regexp_replace(trim(p.full_name), '[[:space:]]+', ' ', 'g')) = v_name_normalized
    and p.phone <> v_phone
    and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts'
    and a.requested_date >= current_date
  order by a.created_at desc limit 1;
  if v_name_match_patient is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'تطابق الاسم الثلاثي مع رقم هاتف مختلف؛ يلزم مراجعة العيادة.', 'تم العثور على نفس الاسم الثلاثي برقم هاتف مختلف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'bookingId', v_existing_booking_code, 'message', 'تم إيقاف الطلب لأنه حجز مكرر بنفس الاسم الثلاثي. من فضلكِ استخدمي رقم الكشف الظاهر أمامك فقط.');
  end if;

  select * into v_settings from public.clinic_settings where id = true;
  if v_date is not null and v_type <> 'birth' and (extract(dow from v_date)::integer = any(v_settings.closed_weekdays) or v_date = any(v_settings.closed_dates)) then
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
