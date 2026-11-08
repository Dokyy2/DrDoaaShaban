-- Make public booking idempotent and serialize duplicate/capacity checks.
-- Admin-enabled edition uses Supabase as its only booking data source.
create or replace function public.create_booking(payload jsonb) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_name_normalized text;
  v_phone text := regexp_replace(coalesce(payload ->> 'phone', ''), '[^0-9]', '', 'g');
  v_type text := trim(coalesce(payload ->> 'type', ''));
  v_date date := nullif(payload ->> 'bookingDate', '')::date;
  v_clinic_today date := (now() at time zone 'Africa/Cairo')::date;
  v_booking_code text := upper(trim(coalesce(payload ->> 'bookingCode', '')));
  v_patient uuid;
  v_appointment public.appointments;
  v_settings public.clinic_settings;
  v_count integer;
  v_existing_appointment bigint;
  v_existing_booking_code text;
  v_existing_name text;
  v_existing_phone text;
  v_existing_type text;
  v_existing_date date;
  v_existing_message text;
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
    v_date := null;
    if v_booking_code !~ '^C-[A-F0-9]{12}$' then
      return jsonb_build_object('status', 'error', 'message', 'تعذر التحقق من رقم الطلب. حدّثي الصفحة وحاولي مرة أخرى.');
    end if;
  else
    if v_date is null then
      return jsonb_build_object('status', 'error', 'message', 'من فضلكِ اختاري تاريخ الحجز.');
    end if;
    if v_date < v_clinic_today then
      return jsonb_build_object('status', 'error', 'message', 'لا يمكن اختيار تاريخ سابق للحجز.');
    end if;
    if v_booking_code !~ ('^BK-' || to_char(v_date, 'YYYYMMDD') || '-[A-F0-9]{8}$') then
      return jsonb_build_object('status', 'error', 'message', 'تعذر التحقق من رقم الطلب. حدّثي الصفحة وابدئي طلبًا جديدًا.');
    end if;
  end if;
  if length(coalesce(payload ->> 'attachmentBase64', '')) > 7000000 then
    return jsonb_build_object('status', 'error', 'message', 'حجم المرفق كبير جدًا. يرجى إرسال ملف أصغر من 5 ميجابايت.');
  end if;

  -- Serialize retries for this idempotency key, then requests for this phone.
  perform pg_advisory_xact_lock(hashtextextended('clinic-booking-code:' || v_booking_code, 0));
  select a.id, a.booking_code, p.full_name, p.phone, a.request_type, a.requested_date, a.message
    into v_existing_appointment, v_existing_booking_code, v_existing_name, v_existing_phone,
         v_existing_type, v_existing_date, v_existing_message
  from public.appointments a join public.patients p on p.id = a.patient_id
  where a.booking_code = v_booking_code limit 1;
  if v_existing_appointment is not null then
    if regexp_replace(lower(trim(v_existing_name)), '[[:space:]]+', ' ', 'g') = regexp_replace(lower(v_name), '[[:space:]]+', ' ', 'g')
       and v_existing_phone = v_phone and v_existing_type = v_type and v_existing_date is not distinct from v_date
       and coalesce(v_existing_message, '') = coalesce(nullif(payload ->> 'message', ''), '') then
      return jsonb_build_object('status', 'success', 'id', v_existing_booking_code,
        'bookingId', v_existing_booking_code, 'message', 'تم استلام الطلب مسبقًا، والعيادة ستراجعه.');
    end if;
    return jsonb_build_object('status', 'error', 'message', 'رقم الطلب مستخدم لبيانات مختلفة. حدّثي الصفحة وابدئي طلبًا جديدًا.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clinic-booking-phone:' || v_phone, 0));
  select a.id, a.booking_code into v_existing_appointment, v_existing_booking_code
  from public.appointments a join public.patients p on p.id = a.patient_id
  where p.phone = v_phone and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts' and a.requested_date >= v_clinic_today
  order by a.created_at desc limit 1;
  if v_existing_appointment is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'محاولة حجز مكرر: يوجد حجز نشط بنفس رقم الهاتف.', 'يوجد حجز نشط بالفعل بنفس رقم الهاتف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'bookingId', v_existing_booking_code,
      'message', 'تم إيقاف الطلب لأنه حجز مكرر بنفس رقم الهاتف. من فضلكِ تواصلي مع العيادة باستخدام رقم الكشف الظاهر أمامك.');
  end if;

  v_name_normalized := lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));
  select p.id, a.id, a.booking_code into v_name_match_patient, v_existing_appointment, v_existing_booking_code
  from public.patients p join public.appointments a on a.patient_id = p.id
  where lower(regexp_replace(trim(p.full_name), '[[:space:]]+', ' ', 'g')) = v_name_normalized
    and p.phone <> v_phone
    and a.status in ('new', 'contacted', 'confirmed', 'rescheduled', 'follow_up')
    and a.request_type <> 'contacts' and a.requested_date >= v_clinic_today
  order by a.created_at desc limit 1;
  if v_name_match_patient is not null then
    insert into public.booking_alerts (full_name, phone, request_type, requested_date, reason, message, matched_appointment_id)
    values (v_name, v_phone, v_type, v_date, 'تطابق الاسم الثلاثي مع رقم هاتف مختلف؛ يلزم مراجعة العيادة.', 'تم العثور على نفس الاسم الثلاثي برقم هاتف مختلف.', v_existing_appointment);
    return jsonb_build_object('status', 'duplicate', 'bookingId', v_existing_booking_code,
      'message', 'تم إيقاف الطلب لأنه حجز مكرر بنفس الاسم الثلاثي. من فضلكِ استخدمي رقم الكشف الظاهر أمامك فقط.');
  end if;

  select * into v_settings from public.clinic_settings where id = true;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'إعدادات مواعيد العيادة غير مكتملة.');
  end if;
  if v_date is not null and v_type <> 'birth' and
     (extract(dow from v_date)::integer = any(v_settings.closed_weekdays) or v_date = any(v_settings.closed_dates)) then
    return jsonb_build_object('status', 'error', 'message', 'هذا اليوم غير متاح للحجز.');
  end if;
  if v_date is not null and v_type in ('first', 'follow', 'consult', 'aesthetic') then
    perform pg_advisory_xact_lock(hashtextextended('clinic-booking-date:' || v_date::text, 0));
    select count(*) into v_count from public.appointments
    where requested_date = v_date and request_type in ('first', 'follow', 'consult', 'aesthetic')
      and status not in ('cancelled', 'no_show');
    if v_count >= v_settings.max_daily_slots then
      return jsonb_build_object('status', 'error', 'message', 'اكتمل عدد الحجوزات المتاح لهذا اليوم.');
    end if;
  end if;

  insert into public.patients (full_name, phone) values (v_name, v_phone)
    on conflict (phone) do update set full_name = excluded.full_name returning id into v_patient;
  insert into public.appointments (
    booking_code, patient_id, request_type, requested_date, last_visit_date, message,
    attachment_name, attachment_type, attachment_base64, source
  ) values (
    v_booking_code, v_patient, v_type, v_date, nullif(payload ->> 'lastVisit', '')::date,
    nullif(payload ->> 'message', ''), nullif(payload ->> 'attachmentName', ''),
    nullif(payload ->> 'attachmentType', ''), nullif(payload ->> 'attachmentBase64', ''), 'website'
  ) returning * into v_appointment;
  insert into public.appointment_events (appointment_id, event_type, new_status, note)
  values (v_appointment.id, 'created', 'new', 'تم استلام طلب الحجز من الموقع.');
  return jsonb_build_object('status', 'success', 'id', v_appointment.booking_code,
    'bookingId', v_appointment.booking_code, 'message', 'تم تسجيل طلبك لدى العيادة بنجاح.');
exception when others then
  return jsonb_build_object('status', 'error', 'message', 'تعذر تسجيل الحجز الآن. يرجى المحاولة لاحقًا.');
end;
$function$;

-- The public browser cannot call this function directly. The Edge Function uses service_role.
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to service_role;
alter function public.create_booking(jsonb) set search_path = pg_catalog, public;
notify pgrst, 'reload schema';
