-- إصلاح عرض وحفظ مصروفات العيادة للدكتورة.
-- شغّلي هذا الملف مرة واحدة إذا كانت المصروفات لا تبقى ظاهرة بعد التحديث.

alter table public.clinic_expenses enable row level security;

drop policy if exists "doctor manages clinic expenses" on public.clinic_expenses;
create policy "doctor manages clinic expenses"
on public.clinic_expenses
for all to authenticated
using (public.is_doctor())
with check (public.is_doctor());

grant select, insert, update, delete on public.clinic_expenses to authenticated;
grant usage, select on sequence public.clinic_expenses_id_seq to authenticated;
