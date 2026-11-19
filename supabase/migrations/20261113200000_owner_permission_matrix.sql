-- Owner-managed, per-account permission matrix for the clinic trial project.
-- Applied on 2026-11-13 to project ccuharkcusmsjdxfuamq after the user
-- identified it as the trial database. This stores and serves the matrix;
-- existing role-based RPC/RLS checks remain in force until each operation is
-- explicitly converted to permission-aware authorization.
begin;

create table if not exists public.clinic_member_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  permissions text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.clinic_member_permissions enable row level security;
revoke all on public.clinic_member_permissions from public, anon, authenticated;

create or replace function private.clinic_permission_catalog()
returns text[] language sql immutable
set search_path = pg_catalog as $$
  select array[
    'home.view','appointments.view','appointments.manage','appointments.create',
    'patients.view','patients.private_notes','attachments.view','calendar.view',
    'alerts.view','alerts.resolve','visits.close','payments.record',
    'reports.view','finance.view','closing.view','expenses.view','expenses.add',
    'backup.export','settings.view','settings.edit','team.view','team.invite','team.manage'
  ]::text[];
$$;

create or replace function private.default_clinic_permissions(p_role text)
returns text[] language sql immutable
set search_path = pg_catalog, private as $$
  select case
    when p_role in ('owner','doctor') then private.clinic_permission_catalog()
    when p_role = 'secretary' then array[
      'home.view','appointments.view','appointments.manage','appointments.create',
      'patients.view','calendar.view','alerts.view','alerts.resolve','payments.record'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function private.has_clinic_permission(p_permission text)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare v_role text; v_permissions text[];
begin
  if auth.uid() is null then return false; end if;
  select role::text into v_role from public.profiles where id=auth.uid();
  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;
  select permissions into v_permissions from public.clinic_member_permissions where user_id=auth.uid();
  if v_permissions is null then v_permissions := private.default_clinic_permissions(v_role); end if;
  return p_permission = any(v_permissions);
end;
$$;

revoke all on function private.clinic_permission_catalog() from public, anon, authenticated;
revoke all on function private.default_clinic_permissions(text) from public, anon, authenticated;
revoke all on function private.has_clinic_permission(text) from public, anon;
grant execute on function private.has_clinic_permission(text) to authenticated;

create or replace function public.my_clinic_permissions()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare v_role text; v_permissions text[]; v_custom boolean;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select role::text into v_role from public.profiles where id=auth.uid();
  if v_role not in ('owner','doctor','secretary') then raise exception 'clinic staff access required' using errcode='42501'; end if;
  select permissions into v_permissions from public.clinic_member_permissions where user_id=auth.uid();
  v_custom := found;
  if v_role='owner' then v_permissions := private.clinic_permission_catalog();
  elsif v_permissions is null then v_permissions := private.default_clinic_permissions(v_role);
  end if;
  return jsonb_build_object('permissions',to_jsonb(v_permissions),'custom',v_custom);
end;
$$;

create or replace function public.owner_list_clinic_permissions()
returns table(user_id uuid, permissions text[])
language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  return query select p.id,
    coalesce(cmp.permissions, private.default_clinic_permissions(p.role::text))
  from public.profiles p
  left join public.clinic_member_permissions cmp on cmp.user_id=p.id
  where p.role::text in ('owner','doctor','secretary','pending')
  order by case p.role::text when 'owner' then 0 when 'doctor' then 1 when 'secretary' then 2 else 3 end,
           lower(coalesce(p.full_name,''));
end;
$$;

create or replace function public.owner_set_clinic_permissions(p_user_id uuid, p_permissions text[])
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_role text; v_selected text[]; v_allowed text[] := private.clinic_permission_catalog();
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  if p_user_id=auth.uid() then raise exception 'owner account is protected' using errcode='42501'; end if;
  select role::text into v_role from public.profiles where id=p_user_id for update;
  if v_role not in ('doctor','secretary','pending') then
    raise exception 'only non-owner team accounts can be managed' using errcode='42501';
  end if;
  if p_permissions is null then
    delete from public.clinic_member_permissions where user_id=p_user_id;
    return;
  end if;
  select coalesce(array_agg(distinct permission_key order by permission_key),'{}'::text[])
    into v_selected from unnest(p_permissions) as permissions(permission_key);
  if not (v_selected <@ v_allowed) then raise exception 'unknown permission key' using errcode='22023'; end if;
  insert into public.clinic_member_permissions(user_id,permissions,updated_by,updated_at)
    values(p_user_id,v_selected,auth.uid(),now())
  on conflict(user_id) do update set permissions=excluded.permissions,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end;
$$;

revoke all on function public.my_clinic_permissions() from public, anon;
revoke all on function public.owner_list_clinic_permissions() from public, anon;
revoke all on function public.owner_set_clinic_permissions(uuid,text[]) from public, anon;
grant execute on function public.my_clinic_permissions() to authenticated;
grant execute on function public.owner_list_clinic_permissions() to authenticated;
grant execute on function public.owner_set_clinic_permissions(uuid,text[]) to authenticated;

notify pgrst,'reload schema';
commit;
