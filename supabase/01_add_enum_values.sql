-- المرحلة الأولى: شغّلي هذا الملف وحده أولًا في Supabase SQL Editor.
-- بعد ظهور Success، انتقلي إلى ملف 02_patient_followup_migration.sql.
-- لا يلمس هذا الملف أي حجوزات أو بيانات مريضات.

alter type public.user_role add value if not exists 'pending';
alter type public.appointment_status add value if not exists 'follow_up';
