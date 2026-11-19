begin;
create table if not exists public.patient_private_notes (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  private_note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.patient_private_notes enable row level security;
revoke all on public.patient_private_notes from public, anon, authenticated;
commit;
