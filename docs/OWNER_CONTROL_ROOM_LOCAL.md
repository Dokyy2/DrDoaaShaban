# Local owner control room

Date: 2026-11-11
Build: local candidate, owner-control-room UX pass
Publication: not published; the `main` and `with-admin` GitHub builds remain untouched.

## Role model

- `owner`: full doctor-level clinic access plus exclusive authority to change team roles and suspend/reactivate team accounts.
- `doctor`: full clinic workflow and finance access, may invite doctors and secretaries, but cannot change the role of an existing user or suspend them.
- `secretary`: clinic workflow as currently implemented; payment entry only when enabled.
- `pending`: no clinic access.

Only ordinary roles (`doctor`, `secretary`) can be assigned from the dashboard. The owner role is intentionally protected from dashboard reassignment and must be bootstrapped by an authorized database operator against the exact Auth user UUID.

## Database rollout

Run these SQL files in order on the intended trial database:

1. `supabase/21_owner_role_enum.sql`
2. `supabase/22_owner_control_room.sql`

The first statement is separate because PostgreSQL must commit the new enum value before a later migration uses it. The second file updates staff/doctor guards and team role changes. It does not assign an owner, create a user, or set a password.

After confirming the exact user in Supabase Auth, use that user's UUID for a one-time owner assignment in the SQL editor:

```sql
update public.profiles
set role = 'owner', full_name = 'Bassem Ashraf'
where id = '<CONFIRMED_AUTH_USER_UUID>';
```

Confirm exactly one row changed. Do not select an account by display name, do not assign owner through a browser request, and do not put a password in project files. Create or recover the owner login through Supabase Auth and use a new strong password; any password previously pasted into chat should be considered exposed.

## UX work included

- Light, low-glare admin shell with softer clinic colors and improved contrast.
- Responsive mobile drawer navigation with backdrop and accessible menu state.
- Smaller-screen cards and controls, safe-area spacing, and larger tap targets.
- Owner badge, owner-only control room wording, role descriptions, and protected owner account row.
- Doctors can invite normal team roles; only the owner receives existing-member role and account-status controls.

## Fine-grained permission candidate — 2026-11-14

**Current runtime boundary:** Docker currently has only the PostgreSQL container on port `54322`; the local Supabase API/Auth endpoint on `127.0.0.1:54321` is not listening, and Supabase CLI is not installed. `js/config.js` still targets the hosted `ccuharkcusmsjdxfuamq.supabase.co` endpoint. Therefore the website/dashboard must not be used to test writes until a local full Supabase stack is started and the client is explicitly pointed at that local stack. No browser/API write test was made in this validation.

**Full-stack setup attempt (2026-11-14):** Installing/discovering the CLI stopped at `npm view supabase version` with `ENOSPC` in npm cache; the execution environment reports zero free C: space. No CLI or Docker images were downloaded and no project/client configuration changed. Resume only after free storage or a verified alternate cache location is available.

- The local candidate adds named permission groups with a required unique name and classification (doctor, assistant, or secretary). Action permissions automatically include the read scopes they require, and the server expands the same dependencies.
- The local database migration enforces these permissions at RPC/RLS boundaries, including payment entry, visit closure, attachments, settings, finance, expenses, private notes, alerts, and team invitations. Owner-only account role changes and suspension remain owner-only.
- `team.view` now opens the team page, and `team.invite` controls both the invite form and its Edge Function/database path. Changing an assigned permission refreshes the open dashboard when it returns to focus.
- Validation: 51/51 source guard and booking checks passed; dashboard JavaScript syntax and targeted whitespace checks passed. On 2026-11-14 the migration chain was also applied to the local Docker PostgreSQL database after adding missing prerequisites (21, 22, and the 20261113200000 permission matrix migration). A rollback-only role workflow test passed owner management, doctor closure, secretary payment after closure, and the corresponding denied actions/attachment access after revocation. All synthetic rows were rolled back and the relevant tables were confirmed empty.
- The migrations were applied directly with local `psql`; there was no Supabase migration ledger, and no CLI migration history was recorded. No hosted Supabase or GitHub branch was changed.
- This proves database policy/RPC behavior only. Local Auth, REST, and Storage services were not running, so browser sign-in and full attachment/payment UI flows remain unverified. Do not mark the complete admin app closed until the browser is confirmed to use the local full stack and those UI flows pass.

## Supabase owner bootstrap — 2026-11-13

- Applied `add_owner_role_enum` (`20261113161725`) and `owner_control_room` (`20261113161758`) to Supabase project `ccuharkcusmsjdxfuamq`.
- Assigned the existing Bassem Ashraf profile the `owner` role using the Auth UUID confirmed from the Supabase Users screen. A follow-up read verified the profile role as `owner`.
- No password or account credentials were changed. No GitHub branch was changed or published.
- The Supabase project details show `ACTIVE_HEALTHY` and the branch listing returned no development branches; the Supabase Studio screenshot labels the selected branch `main · PRODUCTION`. This conflicts with the earlier description of this database as a trial database. Treat the project as production until that environment label is reconciled.
- Still required: sign out/in in the local admin candidate, verify the owner control room and role-change flow, confirm doctor/secretary cannot invoke owner actions, and review a mobile viewport. The database role is verified, but these UI workflows have not been verified. No public deployment is authorized by this local build note.

## 2026-11-13 — إصلاح ظهور حسابات غرفة المالك

- حُسم أن العمل الجاري يخص النسخة المحلية فقط؛ GitHub `main` للحجز Excel v2.8.0 و`with-admin` المنشور يظلان دون تعديل.
- التشخيص: الحسابات الثلاثة موجودة في `public.profiles` (المالك باسم، الطبيبة، والسكرتارية)، لكن `clinic-team-admin` المستضافة كانت v3 وتسمح بدور الطبيبة وحده، فكانت ترفض طلب `team.list` من المالك. مصدر النسخة المحلية كان يسمح للطبيبة والمالك.
- نُشرت نسخة `clinic-team-admin` رقم v4 على مشروع Supabase `ccuharkcusmsjdxfuamq` بعد تأكيد باسم السابق أن هذا المشروع هو قاعدة التجربة. أصبحت خدمة الفريق تقبل المالك لعرض الحسابات، وتحصر تغيير الأدوار وإيقاف الحسابات به؛ كما وُحّدت عناوين CORS/الدعوات المحلية مع المصدر المحلي. لم تُغيّر بيانات الحسابات أو الحجوزات أو الأدوار في هذه الخطوة، ولم يتغير أي فرع GitHub.
- النشر تحقق من خلال استجابة Supabase التي أعادت الحالة `ACTIVE` والإصدار v4. لم نتحقق بعد من تسجيل دخول المالك وظهور الحسابات من واجهة المتصفح بعد التحديث؛ هذه هي خطوة التحقق المتبقية. ملاحظة البيئة السابقة قائمة: Studio يعرض `main · PRODUCTION` رغم تأكيد باسم أنها قاعدة تجريبية.

## 2026-11-13 — مصفوفة الصلاحيات المحلية

- توسعت واجهة إدارة الحسابات إلى مربعات اختيار ضمن مجموعات: الاستقبال والمتابعة، التقارير والحسابات، وإدارة النظام. تتضمن تحديد كل مجموعة أو جميع الصلاحيات، مع إمكانية إعادة إعدادات الدور الافتراضية.
- أضيفت صلاحيات منفصلة للعرض والتعديل، مثل عرض التقفيل اليومي مقابل الاطلاع المالي، عرض المصروفات السابقة مقابل إضافة مصروف، تسجيل الدفع، إغلاق الزيارة، إدارة التنبيهات، الملاحظات الخاصة، المرفقات، والإعدادات والفريق.
- أضيفت الهجرة `supabase/migrations/20261113200000_owner_permission_matrix.sql` لتخزين اختيارات كل حساب وتوفير دوال مالك محمية لقراءتها وتغييرها. طُبقت على مشروع Supabase `ccuharkcusmsjdxfuamq` بعد أن أكد باسم أنه قاعدة التجربة. لم يتغير GitHub.
- اختُبر الحفظ من واجهة المالك على حساب السكرتارية: أُلغي مؤقتًا إذن «إضافة حجز يدوي»، حُفظ وتأكد ظهوره في جدول الصلاحيات، ثم أُعيدت صلاحيات الدور الافتراضية وحُذف السجل المخصص. عاد مربع الإذن مفعّلًا كما كان.
- الصلاحيات الجديدة ليست بعد حاجزًا أمنيًا كاملًا للخادم: الهجرة تحفظ المصفوفة وتوفر دالة فحص، لكنها لا تحول كل RPC وسياسات RLS الحالية من حواجز الدور إلى الصلاحيات الدقيقة. لذلك لا يجوز اعتبار إعطاء السكرتارية إذنًا عبر مربع مصروفات أو تقفيل كافيًا لتفعيل العملية بأمان قبل استكمال حواجز قاعدة البيانات، خصوصًا أن إضافة المصروفات والتقفيل المالي ما زالا مقيدين في المسارات الحالية.
- «إغلاق الدرج» كعملية تحفظ قفلًا/تسوية نهائية غير موجود حاليًا؛ الموجود شاشة ملخص تقفيل محسوبة للقراءة فقط. لم أضف إذنًا وهميًا للعملية غير الموجودة.
- بقيت الصلاحيات الدقيقة مخزنة ومعروضة في الواجهة، لكن دالة `private.has_clinic_permission` لم تُربط بعد بكل RPC وسياسات RLS. لذلك لا تعتبر مربعات الصلاحيات وحدها حماية كاملة على مستوى قاعدة البيانات أو حواجز لكل العمليات.
