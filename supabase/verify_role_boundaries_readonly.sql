-- Read-only role-boundary smoke check for the isolated trial project.
-- Run in Supabase SQL Editor only after the platform connection is available.
-- No table rows are inserted, updated, or deleted. Staff workflow calls use a
-- nonexistent appointment (expected P0002) or incomplete manual-booking input
-- (expected 22023), proving the staff gate without reaching any write path.

do $$
declare
  v_secretary uuid;
  v_doctor uuid;
  v_result jsonb;
begin
  select id into v_secretary
  from public.profiles
  where role = 'secretary'
  order by created_at
  limit 1;

  select id into v_doctor
  from public.profiles
  where role = 'doctor'
  order by created_at
  limit 1;

  if v_secretary is null or v_doctor is null then
    raise exception 'FAIL: active secretary and doctor profiles are required';
  end if;

  perform set_config('request.jwt.claim.sub', v_secretary::text, true);
  if auth.uid() is distinct from v_secretary
     or private.is_staff() is not true
     or private.is_doctor() is not false then
    raise exception 'FAIL: secretary role helper boundary';
  end if;

  begin
    perform public.doctor_finance_settings();
    raise exception 'FAIL: secretary read doctor finance settings';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.doctor_finance_snapshot();
    raise exception 'FAIL: secretary read doctor finance snapshot';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.doctor_appointment_attachment(-1);
    raise exception 'FAIL: secretary called doctor attachment reader';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_appointment_completion(-1, 0, 0, 'cash', '', false);
    raise exception 'FAIL: secretary called doctor payment completion';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_appointment_workflow(
      -1, 'new', 'contacted', '{}'::jsonb, 'Read-only role check'
    );
    raise exception 'FAIL: workflow unexpectedly accepted a nonexistent appointment';
  exception when no_data_found then null;
  end;

  begin
    perform public.create_manual_appointment(
      null, 'first', current_date, null, false, '', gen_random_uuid()
    );
    raise exception 'FAIL: manual booking unexpectedly accepted incomplete input';
  exception when invalid_parameter_value then null;
  end;

  perform set_config('request.jwt.claim.sub', v_doctor::text, true);
  if auth.uid() is distinct from v_doctor
     or private.is_staff() is not true
     or private.is_doctor() is not true then
    raise exception 'FAIL: doctor role helper boundary';
  end if;

  v_result := public.doctor_finance_settings();
  if v_result is null then
    raise exception 'FAIL: doctor finance settings should be readable';
  end if;

  if has_function_privilege('anon', 'public.doctor_finance_settings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.doctor_finance_snapshot()', 'EXECUTE')
     or has_function_privilege('anon', 'public.doctor_appointment_attachment(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_appointment_completion(bigint,numeric,numeric,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_appointment_workflow(bigint,public.appointment_status,public.appointment_status,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_manual_appointment(uuid,text,date,time,boolean,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon has execute on a protected function';
  end if;

  raise notice 'PASS: secretary denied doctor-only calls; staff workflow/manual paths reached validation without writes; doctor finance allowed; anon execute denied. No records changed.';
end;
$$;
