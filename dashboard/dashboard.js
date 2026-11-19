import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

window.CLINIC_DASHBOARD_READY = true;
const app = document.getElementById('app');
const config = window.CLINIC_SUPABASE || {};
let authLinkType = new URLSearchParams(location.hash.slice(1)).get('type') || new URLSearchParams(location.search).get('type') || '';
const statusLabels = { new:'طلب جديد', contacted:'تم التواصل', confirmed:'موعد مؤكد', follow_up:'متابعة لاحقة', completed:'تمت الزيارة', no_show:'لم تحضر', cancelled:'أُلغي', rescheduled:'تم التأجيل' };
const statusIcons = { new:'fa-bell', contacted:'fa-phone-volume', confirmed:'fa-circle-check', follow_up:'fa-rotate', completed:'fa-heart-circle-check', no_show:'fa-user-clock', cancelled:'fa-ban', rescheduled:'fa-clock-rotate-left' };
const staffRoles = new Set(['secretary', 'doctor', 'owner']);
const PERMISSION_GROUPS = [
  { id:'reception', title:'الاستقبال والمتابعة', icon:'fa-headset', items:[
    ['home.view','متابعة اليوم'], ['appointments.view','كل الطلبات'], ['appointments.manage','تحديث حالة الطلب والتواصل'], ['appointments.create','إضافة حجز يدوي'],
    ['patients.view','عائلة العيادة وملفات المريضات'], ['patients.private_notes','الملاحظات السرية'], ['births.record','تسجيل ولادة العيادة'], ['attachments.view','عرض المرفقات الطبية'],
    ['calendar.view','التقويم والمواعيد'], ['alerts.view','عرض التنبيهات'], ['alerts.resolve','مراجعة وإغلاق التنبيهات'],
    ['visits.close','إغلاق الزيارة'], ['payments.record','تسجيل الدفع']
  ]},
  { id:'finance', title:'التقارير والحسابات', icon:'fa-chart-pie', items:[
    ['reports.view','ملخصات وتقارير الشهور'], ['finance.view','الحسابات وتفاصيل التحصيل'],
    ['closing.view','عرض التقفيل اليومي'],
    ['expenses.view','عرض المصروفات السابقة'], ['expenses.add','إضافة مصروف جديد'], ['backup.export','تنزيل نسخة Excel']
  ]},
  { id:'system', title:'إدارة النظام', icon:'fa-sliders', items:[
    ['settings.view','عرض إعدادات العيادة'], ['settings.edit','تعديل إعدادات العيادة'],
    ['team.view','عرض حسابات الفريق'], ['team.invite','دعوة طبيب أو مساعد'], ['team.manage','تغيير الأدوار وإيقاف الحسابات']
  ]}
];
const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(group => group.items.map(([key]) => key));
// The UI makes necessary read scopes explicit whenever an action needs them.
// This avoids saving a checkbox that cannot open its required page or record.
const PERMISSION_DEPENDENCIES = {
  'appointments.manage':['appointments.view','patients.view'],
  'appointments.create':['patients.view'],
  'visits.close':['appointments.view','patients.view'],
  'payments.record':['appointments.view','patients.view'],
  'attachments.view':['appointments.view'],
  'births.record':['appointments.view','patients.view'],
  'calendar.view':['appointments.view'],
  'alerts.resolve':['alerts.view'],
  'reports.view':['appointments.view'],
  'finance.view':['appointments.view','patients.view'],
  'settings.edit':['settings.view'],
  'team.invite':['team.view'],
  'team.manage':['team.view'],
  'backup.export':['appointments.view','patients.view']
};
function withPermissionDependencies(permissions) {
  const result = new Set(permissions || []);
  const addRequirements = key => (PERMISSION_DEPENDENCIES[key] || []).forEach(required => {
    if (!result.has(required)) result.add(required);
    addRequirements(required);
  });
  [...result].forEach(addRequirements);
  return [...result].filter(key => ALL_PERMISSION_KEYS.includes(key));
}
function defaultPermissionsFor(role) {
  if (role === 'owner') return [...ALL_PERMISSION_KEYS];
  if (role === 'doctor') return [...ALL_PERMISSION_KEYS];
  return ['home.view','appointments.view','appointments.manage','appointments.create','patients.view','calendar.view','alerts.view','alerts.resolve','payments.record'];
}
function permissionTemplateName(role) { return ({ doctor:'طبيبة', assistant:'مساعدة', secretary:'سكرتارية' }[role] || 'مجموعة مخصصة'); }
function isOwner() { return profile?.role === 'owner'; }
function isDoctorRole() { return ['doctor','owner'].includes(profile?.role); }
function hasAssignedPermission(key) { return isOwner() || (Array.isArray(profile?.permissions) && profile.permissions.includes(key)); }
function hasPermission(key) {
  if (isOwner()) return true;
  const enabled = Array.isArray(profile?.permissions) ? profile.permissions : defaultPermissionsFor(profile?.role);
  if (!enabled.includes(key)) return false;
  if (key === 'payments.record' && profile?.role === 'secretary' && staffFinanceEnabled !== true) return false;
  if (['finance.view','expenses.view','expenses.add'].includes(key) && settings?.finance_enabled !== true) return false;
  return true;
}
// Role answers who the account is; permissions answer what it may do.
// Never use a permission on one page to imply broad doctor access elsewhere.
function hasDoctorAccess() { return hasPermission('finance.view') || hasPermission('settings.view') || hasPermission('settings.edit'); }
function canViewPaymentAudit() { return hasPermission('finance.view'); }
function canRecordPayment() { return hasPermission('payments.record'); }
function canCloseVisit() { return hasPermission('visits.close'); }
let supabase, session, profile, appointments = [], patients = [], alerts = [], settings, staffFinanceEnabled = null, paymentAudits = [], expenses = [], dataWarnings = [], teamMembers = [], teamEvents = [], teamLoading = false, permissionMatrixAvailable = false, activeView = 'home', selectedDate = new Date().toISOString().slice(0, 10), reportMonth = new Date().toISOString().slice(0, 7), calendarMonth = new Date().toISOString().slice(0, 7), financeMonth = new Date().toISOString().slice(0, 7), appointmentPreset = '', dailyPaymentFilter = '', patientSort = 'alphabetical', reminderTimer, clockTimer, reminderSnoozes = {};
let permissionProfiles = [], closingSnapshot = { enabled:false, counts:{}, payments:[] };
let permissionRefreshInstalled = false, permissionRefreshRunning = false;

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function safePhone(value = '') { return String(value).replace(/\D/g, ''); }
function privateNoteOf(patient) { const notes = patient?.patient_private_notes; return Array.isArray(notes) ? String(notes[0]?.private_note || '') : String(notes?.private_note || ''); }
async function fetchAllRows(buildQuery, pageSize = 1000, maxPages = 100) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const result = await buildQuery().range(from, from + pageSize - 1);
    if (result.error) return { data:null, error:result.error };
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data:rows, error:null };
  }
  return { data:rows, error:{ message:'تجاوز عدد السجلات الحد الآمن للتحميل.' } };
}
function safeAttachmentType(value = '') { return ['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(value) ? value : 'application/octet-stream'; }
function attachmentData(a) { const base64 = String(a.attachment_base64 || '').replace(/[^A-Za-z0-9+/=]/g, ''); return base64 ? `data:${safeAttachmentType(a.attachment_type)};base64,${base64}` : ''; }
function typeText(type) { return { first:'كشف أول مرة', follow:'كشف متابعة', consult:'استشارة متابعة', aesthetic:'تجميل نسائي', birth:'حجز ولادة', labs:'تحاليل أو أشعة', contacts:'عائلة العيادة' }[type] || 'طلب من الموقع'; }
function money(value) { return `${Number(value || 0).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج.م`; }
function priceForType(type) { return hasDoctorAccess() ? Number(settings?.service_prices?.[type] || 0) : 0; }
function financeEnabled() { return settings?.finance_enabled === true || staffFinanceEnabled === true; }
function financeWorkflowEnabled() { return financeEnabled() || (profile?.role === 'secretary' && staffFinanceEnabled); }
function financeTrialNotice() { return window.CLINIC_FINANCE_TRIAL === true ? `<aside class="finance-trial-warning" role="status"><i class="fa-solid fa-flask"></i><span><b>بيانات مالية تجريبية</b> الأسعار والمبالغ هنا للاختبار فقط وليست أسعارًا أو تحصيلات معتمدة للعيادة.</span></aside>` : ''; }
function paymentMethodText(method) { return { cash:'نقدًا', visa:'فيزا', instapay:'إنستا باي', vodafone_cash:'فودافون كاش', other:'أخرى' }[method] || 'لم تُحدد'; }
function outcomeReasonText(reason) { return { changed_mind:'اعتذرت / غيّرت رأيها', no_response:'لم ترد', emergency:'ظرف طارئ', rescheduled_elsewhere:'حددت موعدًا آخر', price:'لم يناسبها السعر', other:'سبب آخر' }[reason] || ''; }
function formatTime(time) { return time ? new Date(`2000-01-01T${time}`).toLocaleTimeString('ar-EG',{hour:'numeric',minute:'2-digit'}) : 'لم يُحدد الوقت'; }
function completedVisits(patientId) { return appointments.filter(a => a.patient_id === patientId && a.status === 'completed').length; }
function isVipPatient(patientId) { return completedVisits(patientId) >= 5; }
function paymentDate(a) { return String(a.payment_recorded_at || '').slice(0, 10); }
function eventSummary(event) {
  if (event.event_type === 'created') return 'تم استلام الحجز وتسجيله في النظام.';
  const oldStatus = statusLabels[event.old_status] || '';
  const newStatus = statusLabels[event.new_status] || '';
  return oldStatus && newStatus ? `تغيرت الحالة من «${oldStatus}» إلى «${newStatus}».` : 'تم تحديث بيانات الطلب.';
}
function paidOnDay(date = selectedDate) { return appointments.filter(a => paymentDate(a) === date && a.amount_paid !== null && a.amount_paid !== undefined); }
function paymentIncomplete(a) { return financeEnabled() && a.status === 'completed' && (a.amount_paid === null || a.amount_paid === undefined || !a.payment_method); }
function auditForAppointment(id) { return paymentAudits.filter(row => Number(row.appointment_id) === Number(id)).sort((a,b) => new Date(b.changed_at) - new Date(a.changed_at)); }
function formatDate(date, short = false) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', short ? { day:'numeric', month:'short' } : { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : 'لم يُحدد موعد'; }
function requestDate(a) { return a.requested_date ? formatDate(a.requested_date) : (a.request_type === 'contacts' ? 'تسجيل بيانات للتواصل' : 'بانتظار تحديد موعد'); }
function wa(a) { const phone = safePhone(a.patients?.phone).replace(/^0/, '20'); const text = `مرحباً ${a.patients?.full_name || ''}، بخصوص ${typeText(a.request_type)}${a.requested_date ? ` بتاريخ ${a.requested_date}` : ''} في عيادة د. دعاء شعبان.`; return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`; }
function clinicToday() { const parts = new Intl.DateTimeFormat('en', { timeZone:'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()); const part = type => parts.find(item => item.type === type)?.value || ''; return `${part('year')}-${part('month')}-${part('day')}`; }
function currentWorkflow(a, statuses) { return statuses.includes(a.status) && (!a.requested_date || a.requested_date >= clinicToday()); }
function pending(a) { return currentWorkflow(a, ['new', 'contacted', 'rescheduled']); }
function activeBooking(a) { return currentWorkflow(a, ['new', 'contacted', 'confirmed', 'rescheduled', 'follow_up']); }
function followUpNeeded(a) { return currentWorkflow(a, ['new', 'contacted', 'rescheduled', 'follow_up']); }
function patientList() { return patients; }
function birthCount(patientId) { return Number(patientList().find(p => p.id === patientId)?.clinic_births || 0); }
function patientBadges(patientId) { const visits = completedVisits(patientId); const births = birthCount(patientId); return `${visits ? `<em class="visit-badge"><i class="fa-solid fa-heart-pulse"></i> ${visits} زيارة</em>` : ''}${isVipPatient(patientId) ? ` <em class="vip-badge"><i class="fa-solid fa-crown"></i> عضوة مميزة</em>` : ''}${births ? ` <em class="birth-badge"><i class="fa-solid fa-baby"></i> ولدت معنا ×${births}</em>` : ''}`; }
function normalize(value = '') { return String(value).trim().toLowerCase().replace(/\s+/g, ' '); }
function lastFour(value = '') { return safePhone(value).slice(-4); }
function futureVisits(patientId) { return appointments.filter(a => a.patient_id === patientId && activeBooking(a) && a.requested_date && a.requested_date >= selectedDate).sort((a,b) => a.requested_date.localeCompare(b.requested_date)); }
function overdueDays(patientId) { const last = lastCompletedVisit(patientId); if (!last?.requested_date) return 0; return Math.floor((new Date(`${selectedDate}T12:00:00`) - new Date(`${last.requested_date}T12:00:00`)) / 86400000); }
function hasAttachment(a) { return Boolean(a.attachment_name || attachmentData(a)); }
function appointmentById(id) { return appointments.find(a => a.id === Number(id)); }

if (!config.url || !config.anonKey) renderSetup(); else boot();

async function boot() {
  try {
    supabase = createClient(config.url, config.anonKey);
    ({ data: { session } } = await withTimeout(supabase.auth.getSession()));
    if (session && ['invite', 'recovery'].includes(authLinkType)) return renderPasswordSetup(authLinkType);
    if (!session) {
      const authError = new URLSearchParams(location.hash.slice(1)).get('error_code') || new URLSearchParams(location.search).get('error_code') || '';
      return renderLogin(authError === 'otp_expired' ? 'انتهت صلاحية رابط الدعوة أو استُخدم قبل ذلك. استخدمي «نسيت كلمة المرور؟» لإعداد كلمة مرور جديدة.' : '');
    }
    if (await withTimeout(loadData())) { renderApp(); installPermissionRefresh(); }
  } catch (error) {
    console.error(error);
    renderConnectionError();
  }
}

function renderSetup() { app.innerHTML = `<section class="login-page"><div class="login-card"><div class="clinic-mark"><i class="fa-solid fa-lock"></i></div><h1>لوحة إدارة العيادة</h1><p>أضيفي بيانات Supabase في ملف الإعدادات ثم أعيدي فتح الصفحة.</p></div></section>`; }
function renderConnectionError() { app.innerHTML = `<section class="login-page"><div class="login-card"><div class="clinic-mark"><i class="fa-solid fa-wifi"></i></div><h1>تعذر فتح لوحة الإدارة</h1><p>تأكدي من اتصال الإنترنت وأن ملف <b>js/config.js</b> ومجلد <b>dashboard</b> تم رفعهما كاملين إلى الاستضافة.</p><button class="primary-btn" type="button" onclick="location.reload()">إعادة المحاولة</button></div></section>`; }
function withTimeout(promise, milliseconds = 12000) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), milliseconds))]); }
function renderLogin(error = '') {
  app.innerHTML = `<section class="login-page"><form class="login-card" id="loginForm"><div class="clinic-mark"><i class="fa-solid fa-heart-pulse"></i></div><h1>إدارة عيادة د. دعاء شعبان</h1><p>دخول المالك والطبيبة وفريق العيادة</p><label class="field">البريد الإلكتروني<input type="email" name="email" required autocomplete="username" placeholder="name@clinic.com"></label><label class="field">كلمة المرور<input type="password" name="password" required autocomplete="current-password" placeholder="••••••••"></label><div class="error" role="status">${escapeHtml(error)}</div><button class="primary-btn" type="submit">تسجيل الدخول <i class="fa-solid fa-arrow-left"></i></button><button class="ghost-btn" id="forgotPasswordButton" type="button" style="width:100%;margin-top:10px">نسيت كلمة المرور؟</button></form></section>`;
  document.getElementById('loginForm').addEventListener('submit', login);
  document.getElementById('forgotPasswordButton').addEventListener('click', sendPasswordRecovery);
}
async function sendPasswordRecovery(event) {
  const form = document.getElementById('loginForm');
  const emailInput = form?.querySelector('input[name="email"]');
  const errorBox = form?.querySelector('.error');
  const button = event.currentTarget;
  const email = String(emailInput?.value || '').trim();
  if (!email) { errorBox.textContent = 'اكتبي البريد الإلكتروني أولًا، ثم اختاري نسيت كلمة المرور.'; emailInput?.focus(); return; }
  button.disabled = true;
  errorBox.textContent = '';
  try {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(email, { redirectTo }));
    if (error) throw error;
    errorBox.textContent = 'إذا كان البريد مسجلًا، ستصلك رسالة لإعداد كلمة مرور جديدة. افتحيها من هذا الجهاز بعد تشغيل الموقع المحلي.';
  } catch (error) {
    console.error('تعذر إرسال رابط استعادة كلمة المرور:', error);
    errorBox.textContent = 'تعذر إرسال رسالة الاستعادة الآن. تحققي من الاتصال وانتظري قليلًا إذا ظهرت رسالة حد الإرسال.';
    button.disabled = false;
  }
}
function renderPasswordSetup(type) {
  const title = type === 'invite' ? 'تفعيل حساب الفريق' : 'اختيار كلمة مرور جديدة';
  app.innerHTML = `<section class="login-page"><form class="login-card" id="passwordSetupForm"><div class="clinic-mark"><i class="fa-solid fa-shield-heart"></i></div><h1>${title}</h1><p>اختاري كلمة مرور جديدة لا تقل عن 12 حرفًا.</p><label class="field">كلمة المرور الجديدة<input type="password" name="password" required minlength="12" autocomplete="new-password"></label><label class="field">تأكيد كلمة المرور<input type="password" name="confirm_password" required minlength="12" autocomplete="new-password"></label><div class="error" role="status"></div><button class="primary-btn" type="submit">حفظ كلمة المرور</button></form></section>`;
  document.getElementById('passwordSetupForm').addEventListener('submit', savePasswordSetup);
}
async function savePasswordSetup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const password = String(fields.get('password') || '');
  const confirmPassword = String(fields.get('confirm_password') || '');
  const errorBox = form.querySelector('.error');
  if (password.length < 12) { errorBox.textContent = 'كلمة المرور يجب ألا تقل عن 12 حرفًا.'; return; }
  if (password !== confirmPassword) { errorBox.textContent = 'تأكيد كلمة المرور غير مطابق.'; return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  errorBox.textContent = '';
  try {
    const { error } = await withTimeout(supabase.auth.updateUser({ password }));
    if (error) throw error;
    history.replaceState({}, document.title, location.pathname);
    authLinkType = '';
    ({ data: { session } } = await withTimeout(supabase.auth.getSession()));
    if (await withTimeout(loadData())) { renderApp(); installPermissionRefresh(); }
    else renderLogin('تم حفظ كلمة المرور، لكن تعذر فتح لوحة العيادة. سجّلي الدخول الآن.');
  } catch (error) {
    errorBox.textContent = 'تعذر حفظ كلمة المرور. قد يكون رابط الدعوة منتهيًا؛ اطلبي دعوة جديدة.';
    button.disabled = false;
  }
}
async function login(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await withTimeout(supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') }));
    if (error) return renderLogin('بيانات الدخول غير صحيحة أو الحساب غير مفعّل.');
    ({ data: { session } } = await withTimeout(supabase.auth.getSession()));
    if (await withTimeout(loadData())) { renderApp(); installPermissionRefresh(); }
  } catch (error) {
    console.error('تعذر تسجيل الدخول أو تحميل بيانات لوحة الإدارة:', error);
    renderLogin('تعذر الاتصال بقاعدة البيانات الآن. تحققي من الإنترنت ثم حاولي تسجيل الدخول مرة أخرى.');
  }
}
async function loadData() {
  const profileRes = await supabase.from('profiles').select('id,full_name,role').eq('id', session.user.id).single();
  if (profileRes.error) throw profileRes.error;
  profile = profileRes.data;
  if (!profile || !staffRoles.has(profile.role)) { await supabase.auth.signOut(); session = null; renderLogin('هذا الحساب غير مخوّل لاستخدام لوحة الإدارة.'); return false; }
  const permissionsRes = await supabase.rpc('my_clinic_permissions');
  if (permissionsRes.error) {
    profile.permissions = defaultPermissionsFor(profile.role);
    profile.has_custom_permissions = false;
    dataWarnings = ['مصفوفة الصلاحيات غير مفعّلة في قاعدة البيانات بعد؛ عُرضت صلاحيات الدور الافتراضية للقراءة.'];
  } else {
    profile.permissions = Array.isArray(permissionsRes.data?.permissions) ? permissionsRes.data.permissions : defaultPermissionsFor(profile.role);
    profile.has_custom_permissions = permissionsRes.data?.custom === true;
  }

  // Avoid fetching the attachment body and doctor-only clinical notes in list queries.
  // The note field is not selected for clinic staff; finance audit/expense data is doctor-only.
  const patientFields = hasPermission('patients.private_notes')
    ? 'id,full_name,phone,created_at,clinic_births,patient_private_notes(private_note)'
    : 'id,full_name,phone,created_at,clinic_births';
  const appointmentFields = 'id,booking_code,patient_id,request_type,requested_date,last_visit_date,message,attachment_name,attachment_type,status,source,staff_note,created_at,updated_at,requested_time,is_waitlist,outcome_reason,outcome_note,contact_note,clinic_birth_recorded';
  const patientDirectoryFields = hasPermission('patients.private_notes') ? 'id,full_name,phone,created_at,clinic_births,patient_private_notes(private_note)' : 'id,full_name,phone,created_at,clinic_births';
  const canReadAppointments = hasPermission('appointments.view');
  const canReadPatients = hasPermission('patients.view');
  const canReadSettings = ['settings.view','settings.edit','home.view','appointments.view','calendar.view'].some(hasPermission);
  const settingsFields = 'id,clinic_name,work_start,work_end,max_daily_slots,closed_weekdays,closed_dates,updated_at';
  const [appointmentsRes, patientsRes, settingsRes, alertsRes, paymentAuditRes, expensesRes, eventsRes, financeRes, financeSettingsRes, staffFinanceRes] = await Promise.all([
    canReadAppointments ? fetchAllRows(() => supabase.from('appointments').select(`${appointmentFields}, patients(${patientFields})`).order('created_at', { ascending:false })) : Promise.resolve({ data:[], error:null }),
    canReadPatients ? fetchAllRows(() => supabase.from('patients').select(patientDirectoryFields).order('created_at', { ascending:false })) : Promise.resolve({ data:[], error:null }),
    canReadSettings ? supabase.from('clinic_settings').select(settingsFields).eq('id', true).single() : Promise.resolve({ data:null, error:null }),
    hasPermission('alerts.view') ? supabase.from('booking_alerts').select('id,source_event_id,alert_type,reason,matched_appointment_id,status,resolved_at,resolved_by,created_at').order('created_at', { ascending:false }).limit(300) : Promise.resolve({ data:[], error:null }),
    hasAssignedPermission('finance.view') ? supabase.from('payment_audit').select('id,appointment_id,changed_by,changed_by_name,old_amount_due,new_amount_due,old_amount_paid,new_amount_paid,old_payment_method,new_payment_method,old_payment_note,new_payment_note,changed_at').order('changed_at', { ascending:false }).limit(1500) : Promise.resolve({ data:[], error:null }),
    hasAssignedPermission('expenses.view') ? supabase.from('clinic_expenses').select('id,expense_date,category,amount,note,created_by,created_at').order('expense_date', { ascending:false }).limit(1000) : Promise.resolve({ data:[], error:null }),
    canReadAppointments ? fetchAllRows(() => supabase.from('staff_appointment_events').select('id,appointment_id,event_type,old_status,new_status,created_at').order('created_at', { ascending:false })) : Promise.resolve({ data:[], error:null }),
    hasAssignedPermission('finance.view') ? supabase.rpc('doctor_finance_snapshot') : Promise.resolve({ data:[], error:null }),
    (hasAssignedPermission('finance.view') || hasAssignedPermission('settings.view') || hasAssignedPermission('settings.edit')) ? supabase.rpc('doctor_finance_settings') : Promise.resolve({ data:{}, error:null }),
    profile.role === 'secretary' && (hasAssignedPermission('payments.record') || hasAssignedPermission('expenses.add')) ? supabase.rpc('staff_finance_enabled') : Promise.resolve({ data:false, error:null })
  ]);
  const essentialError = appointmentsRes.error || patientsRes.error || settingsRes.error || eventsRes.error || financeRes.error || financeSettingsRes.error;
  if (essentialError) throw essentialError;
  dataWarnings = [...dataWarnings];
  staffFinanceEnabled = profile.role === 'secretary' ? (staffFinanceRes.error ? null : staffFinanceRes.data === true) : null;
  if (staffFinanceRes.error && profile.role === 'secretary') dataWarnings.push('تعذر التحقق من تفعيل تسجيل الدفع؛ لن يظهر إجراء إنهاء الزيارة حتى يتاح الاتصال الآمن.');
  if (alertsRes.error) dataWarnings.push('تعذر تحميل التنبيهات؛ قد لا تظهر التنبيهات المفتوحة مؤقتًا.');
  if (paymentAuditRes.error && hasAssignedPermission('finance.view')) dataWarnings.push('تعذر تحميل سجل تغييرات الدفع؛ بيانات الحجز الأساسية متاحة.');
  if (expensesRes.error && hasAssignedPermission('expenses.view')) dataWarnings.push('تعذر تحميل المصروفات؛ راجعي الاتصال قبل الاعتماد على التقارير المالية.');
  appointments = appointmentsRes.data || [];
  if (hasAssignedPermission('finance.view')) {
    const financeByAppointment = new Map((financeRes.data || []).map(row => [Number(row.appointment_id), row]));
    appointments = appointments.map(row => ({ ...row, ...(financeByAppointment.get(Number(row.id)) || {}) }));
  }
  const eventsByAppointment = new Map();
  for (const event of eventsRes.data || []) {
    const key = Number(event.appointment_id);
    if (!eventsByAppointment.has(key)) eventsByAppointment.set(key, []);
    eventsByAppointment.get(key).push(event);
  }
  appointments = appointments.map(row => ({ ...row, appointment_events:eventsByAppointment.get(Number(row.id)) || [] }));
  patients = patientsRes.data || []; settings = { ...(settingsRes.data || {}), ...(hasDoctorAccess() || hasAssignedPermission('finance.view') ? (financeSettingsRes.data || {}) : {}), ...(staffFinanceEnabled !== null ? { finance_enabled:staffFinanceEnabled } : {}) }; alerts = alertsRes.data || []; paymentAudits = paymentAuditRes.data || []; expenses = expensesRes.data || [];
  if (hasPermission('closing.view')) await loadClosingSnapshot(selectedDate);
  if (dataWarnings.length) console.warn('تحميل جزئي للوحة الإدارة:', dataWarnings);
  return true;
}
function installPermissionRefresh() {
  if (permissionRefreshInstalled) return;
  permissionRefreshInstalled = true;
  window.addEventListener('focus', refreshPermissionsIfChanged);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPermissionsIfChanged(); });
}
async function refreshPermissionsIfChanged() {
  if (!session || !profile || document.hidden || permissionRefreshRunning) return;
  permissionRefreshRunning = true;
  try {
    const [profileResult, permissionResult] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', session.user.id).single(),
      supabase.rpc('my_clinic_permissions')
    ]);
    if (profileResult.error || permissionResult.error || !profileResult.data) return;
    const nextPermissions = Array.isArray(permissionResult.data?.permissions) ? permissionResult.data.permissions : defaultPermissionsFor(profileResult.data.role);
    const oldPermissions = [...(profile.permissions || [])].sort().join('|');
    const newPermissions = [...nextPermissions].sort().join('|');
    const changed = profile.role !== profileResult.data.role
      || oldPermissions !== newPermissions
      || profile.has_custom_permissions !== (permissionResult.data?.custom === true);
    if (!changed) return;
    if (await loadData()) {
      if (!canOpenView(activeView)) activeView = 'home';
      renderApp();
      showToast('تم تحديث صلاحيات الحساب من غرفة التحكم.');
    }
  } catch (error) {
    console.warn('تعذر تحديث صلاحيات الحساب بعد العودة للصفحة:', error);
  } finally {
    permissionRefreshRunning = false;
  }
}
async function loadClosingSnapshot(date = selectedDate) {
  if (!hasPermission('closing.view')) { closingSnapshot = { enabled:false, counts:{}, payments:[] }; return; }
  const { data, error } = await supabase.rpc('staff_daily_closing_snapshot', { p_date:date });
  if (error) throw error;
  closingSnapshot = data && typeof data === 'object' ? data : { enabled:false, counts:{}, payments:[] };
}

function renderApp() {
  const staffName = escapeHtml(profile.full_name || session.user.email);
  const openAlerts = alerts.filter(a => !a.resolved_at).length;
  app.innerHTML = `<div class="app-shell"><button class="mobile-scrim" data-action="close-mobile-menu" aria-label="إغلاق القائمة"></button><aside class="sidebar"><div class="brand"><i class="fa-solid fa-heart-pulse"></i><div><b>عيادة د. دعاء</b><span>لوحة متابعة الحجوزات</span></div></div><nav class="menu">
    ${menuGroup('الاستقبال والمتابعة', [['home','home.view','fa-house','متابعة اليوم'],['appointments','appointments.view','fa-clipboard-list','كل الطلبات'],['patients','patients.view','fa-users','عائلة العيادة'],['calendar','calendar.view','fa-calendar-days','التقويم'],['alerts','alerts.view','fa-triangle-exclamation',`التنبيهات ${openAlerts ? `(${openAlerts})` : ''}`]])}
     ${menuGroup('التقارير والحسابات', [['reports','reports.view','fa-chart-pie','ملخصات الشهور'],['finance','finance.view','fa-wallet','الحسابات'],['expenses','expenses.view','fa-receipt','سجل المصروفات'],['expense_add','expenses.add','fa-circle-plus','إضافة مصروف'],['closing','closing.view','fa-cash-register','التقفيل اليومي']])}
    ${menuGroup('إدارة النظام', [['settings','settings.view','fa-gear','إعدادات العيادة'],['team','team.view', 'fa-user-gear',isOwner() ? 'غرفة التحكم' : 'إدارة الفريق']])}
  </nav><div class="side-bottom">${hasPermission('backup.export') ? '<button class="ghost-btn" data-action="backup"><i class="fa-solid fa-file-csv"></i> نسخة Excel</button>' : ''}<small>${staffName}</small><button class="ghost-btn" data-action="logout">تسجيل الخروج</button></div></aside><section class="workspace"><header class="topline"><button class="mobile-menu-toggle" data-action="toggle-mobile-menu" aria-label="فتح القائمة" aria-expanded="false"><i class="fa-solid fa-bars"></i></button><div class="topline-title"><h1>${viewTitle()}</h1><p>${new Date().toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} <b class="live-clock" id="liveClock"></b></p></div><div class="user-chip"><i class="fa-solid ${isOwner() ? 'fa-crown' : 'fa-user-shield'}"></i><span>${staffName}</span><b>${isOwner() ? 'مالك النظام' : isDoctorRole() ? 'الطبيبة' : 'السكرتارية'}</b></div></header>${(!window.CLINIC_SUPABASE?.url || !window.CLINIC_SUPABASE?.anonKey) ? `<aside class="bridge-warning" role="status"><i class="fa-solid fa-link-slash"></i><span><b>الاتصال بقاعدة البيانات غير مكتمل</b> لا يمكن عرض البيانات أو حفظ الحجوزات حتى يكتمل إعداد Supabase.</span></aside>` : ''}${dataWarnings.length ? `<aside class="bridge-warning" role="status"><i class="fa-solid fa-triangle-exclamation"></i><span><b>تحميل جزئي لبعض بيانات الإدارة</b><br>${dataWarnings.map(escapeHtml).join('<br>')}</span></aside>` : ''}<div id="view"></div></section></div><div class="toast" id="toast" role="status"></div>`;
  renderView(); bindEvents(); startSmartReminders(); startLiveClock();
}
function startLiveClock() { clearInterval(clockTimer); updateLiveClock(); clockTimer = setInterval(updateLiveClock, 1000); }
function updateLiveClock() { const clock = document.getElementById('liveClock'); if (clock) clock.textContent = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true }); }
function viewTitle() { return { home:'متابعة الحجوزات', appointments:'كل طلبات الحجز', patients:'عائلة العيادة', calendar:'تقويم المواعيد', alerts:'تنبيهات ومتابعة', reports:'ملخصات الشهور', finance:'الحسابات', expenses:'سجل المصروفات', expense_add:'إضافة مصروف', closing:'التقفيل والتقرير اليومي', settings:'إعدادات العيادة', team:isOwner() ? 'غرفة تحكم المالك' : 'إدارة الفريق' }[activeView]; }
const VIEW_PERMISSIONS = { home:'home.view', appointments:'appointments.view', patients:'patients.view', calendar:'calendar.view', alerts:'alerts.view', reports:'reports.view', finance:'finance.view', expenses:'expenses.view', expense_add:'expenses.add', closing:'closing.view', settings:'settings.view', team:'team.view' };
function canOpenView(view) { return hasPermission(VIEW_PERMISSIONS[view]) || (view === 'settings' && hasPermission('settings.edit')); }
function menuGroup(title, links) { const visible = links.filter(([view,permission]) => canOpenView(view) && (['finance','expenses','expense_add'].includes(view) ? financeEnabled() : view === 'closing' ? (financeEnabled() || closingSnapshot.enabled === true) : true)); if (!visible.length) return ''; return `<div class="menu-group"><span class="menu-group-title">${title}</span>${visible.map(([view,permission,icon,label]) => `<button data-view="${view}" class="${activeView === view ? 'active' : ''}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}</div>`; }
function renderView() { const view = document.getElementById('view'); if (!canOpenView(activeView)) activeView = Object.keys(VIEW_PERMISSIONS).find(canOpenView) || ''; if (!activeView) { view.innerHTML = `<section class="panel">${emptyState('fa-lock','لا توجد صفحات مفعّلة لهذا الحساب. تواصلي مع مالك النظام.')}</section>`; return; }
  view.innerHTML = activeView === 'home' ? homeView() : activeView === 'appointments' ? appointmentsView() : activeView === 'patients' ? patientsView() : activeView === 'calendar' ? calendarView() : activeView === 'alerts' ? alertsView() : activeView === 'reports' ? reportsView() : activeView === 'finance' ? financeViewFiltered() : activeView === 'expenses' ? expensesHistoryView() : activeView === 'expense_add' ? expenseEntryView() : activeView === 'closing' ? closingPage() : activeView === 'team' ? teamView() : settingsView(); if (activeView === 'settings' && !hasPermission('settings.edit')) { const form = view.querySelector('#settingsForm'); form?.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; }); } decorateViewCards(); setupFinanceSwitch(); }

function decorateViewCards() { document.querySelectorAll('.request-main[data-id]').forEach(button => { const appointment = appointmentById(button.dataset.id); const name = button.querySelector('b'); if (appointment?.patient_id && name && !name.querySelector('.inline-visit-badge')) name.insertAdjacentHTML('beforeend', `<span class="inline-visit-badge">${completedVisits(appointment.patient_id)} زيارة${isVipPatient(appointment.patient_id) ? ' · مميزة' : ''}</span>`); if (hasPermission('finance.view') && financeEnabled() && appointment?.amount_paid !== null && appointment?.amount_paid !== undefined && !button.querySelector('.card-payment-summary')) button.insertAdjacentHTML('beforeend', `<small class="card-payment-summary"><i class="fa-solid fa-wallet"></i> دفعت ${money(appointment.amount_paid)} · ${paymentMethodText(appointment.payment_method)}</small>`); }); if (hasPermission('finance.view') && financeEnabled()) { document.querySelectorAll('.patient-card[data-patient]').forEach(card => { const total = appointments.filter(a => a.patient_id === card.dataset.patient && a.amount_paid !== null && a.amount_paid !== undefined).reduce((sum,a) => sum + Number(a.amount_paid || 0), 0); if (total && !card.querySelector('.patient-paid-total')) card.querySelector('span:nth-child(2)')?.insertAdjacentHTML('beforeend', `<small class="patient-paid-total">إجمالي ما دفعته: ${money(total)}</small>`); }); }
  if (activeView === 'alerts') document.querySelectorAll('.alert-row').forEach(row => { const button = row.querySelector('[data-action="resolve-alert"]'); const alert = alerts.find(item => String(item.id) === String(button?.dataset.id)); if (!alert || row.querySelector('.alert-details')) return; const matched = appointmentById(alert.matched_appointment_id); const details = `<div class="alert-details"><span><b>سبب التنبيه:</b> ${escapeHtml(alert.reason || 'محاولة حجز مكرر')}</span>${matched ? `<span><b>الحجز المرتبط:</b> ${escapeHtml(matched.booking_code || '—')} · ${escapeHtml(matched.patients?.full_name || 'مريضة')} · <bdi>${escapeHtml(safePhone(matched.patients?.phone))}</bdi></span>` : ''}</div>`; row.querySelector('div')?.insertAdjacentHTML('beforeend', details); }); }
function setupFinanceSwitch() { const input = document.querySelector('input[name="finance_enabled"]'); if (!input || input.dataset.ready) return; const area = input.closest('.finance-switch'); const label = area?.querySelector('em'); if (area && !area.querySelector('.finance-save-hint')) area.insertAdjacentHTML('beforeend', `<small class="finance-save-hint"></small>`); const sync = () => { area?.classList.toggle('is-enabled', input.checked); if (label) label.innerHTML = input.checked ? `<i class="fa-solid fa-circle"></i> الحسابات شغّالة` : `<i class="fa-solid fa-circle"></i> الحسابات متوقفة`; const note = area?.querySelector('.finance-save-hint'); if (note) note.textContent = input.checked ? 'بعد الضغط على «حفظ الإعدادات»: تظهر صفحة الحسابات والتقفيل وخانات الدفع.' : 'بعد الضغط على «حفظ الإعدادات»: تختفي صفحة الحسابات وخانات الدفع من السكرتارية.'; }; input.dataset.ready = 'true'; input.addEventListener('change', sync); sync(); }
function stat(label, value, icon, tone = '') { return `<article class="stat ${tone}"><i class="fa-solid ${icon}"></i><span>${label}</span><b>${value}</b></article>`; }

function homeView() {
  const day = appointments.filter(a => a.requested_date === selectedDate);
  const followUp = appointments.filter(followUpNeeded);
  const confirmed = day.filter(a => a.status === 'confirmed');
  const completed = day.filter(a => a.status === 'completed');
  const due30 = patientList().filter(p => overdueDays(p.id) >= 30 && overdueDays(p.id) < 60 && !futureVisits(p.id).length);
  const due60 = patientList().filter(p => overdueDays(p.id) >= 60 && !futureVisits(p.id).length);
  const duplicates = alerts.filter(a => !a.resolved_at && (a.alert_type || 'duplicate_booking') === 'duplicate_booking');
  const reminderTomorrow = appointments.filter(a => a.requested_date === nextDate() && activeBooking(a));
  const incompletePayments = appointments.filter(paymentIncomplete);
  return `<section class="quick-guide"><div><b><i class="fa-solid fa-circle-info"></i> طريقة العمل</b><span>كل مربع يفتح قائمته مباشرة. ابدئي بالمتابعة والتنبيهات، ثم افتحي ملف المريضة عند الحاجة.</span></div><button class="ghost-btn" data-action="go-pending">عرض الطلبات الجديدة</button></section><div class="stat-grid clickable-stats"><button class="stat attention" data-action="preset" data-preset="follow"><i class="fa-solid fa-bell"></i><span>تحتاج متابعة</span><b>${followUp.length}</b></button><button class="stat" data-action="preset" data-preset="today"><i class="fa-solid fa-calendar-day"></i><span>مواعيد اليوم</span><b>${day.length}</b></button><button class="stat good" data-action="preset" data-preset="tomorrow"><i class="fa-solid fa-whatsapp"></i><span>تذكير الغد</span><b>${reminderTomorrow.length}</b></button><button class="stat attention" data-action="show-overdue" data-days="30"><i class="fa-solid fa-user-clock"></i><span>تأخر 30 يومًا</span><b>${due30.length}</b></button><button class="stat attention" data-action="show-overdue" data-days="60"><i class="fa-solid fa-triangle-exclamation"></i><span>تأخر 60+ يومًا</span><b>${due60.length}</b></button><button class="stat" data-action="go-alerts"><i class="fa-solid fa-copy"></i><span>حجز مكرر</span><b>${duplicates.length}</b></button>${financeEnabled() ? `<button class="stat attention" data-action="preset" data-preset="unpaid"><i class="fa-solid fa-wallet"></i><span>دفع يحتاج مراجعة</span><b>${incompletePayments.length}</b></button>` : ''}</div>${financeEnabled() ? dailyClosingView() : ''}${waitlistView()}<section class="panel urgent-panel"><div class="panel-title"><div><h2>طلبات تحتاج متابعة</h2><p>الحالات الجديدة، التي تحتاج اتصالًا، أو متابعة لاحقة.</p></div><span class="count-badge">${followUp.length}</span></div><div class="appointment-grid">${followUp.length ? followUp.slice(0, 8).map(requestCard).join('') : emptyState('fa-circle-check', 'لا توجد طلبات تحتاج متابعة الآن.')}</div></section><section class="panel"><div class="panel-title"><div><h2>مواعيد ${formatDate(selectedDate)}</h2><p>اختاري يومًا آخر لمراجعة جدول المواعيد.</p></div><input type="date" id="dayPicker" value="${selectedDate}"></div><div class="appointment-grid compact">${day.length ? day.map(requestCard).join('') : emptyState('fa-calendar-xmark', 'لا توجد مواعيد مسجلة لهذا اليوم.')}</div></section>`;
}
function waitlistView() { const list = appointments.filter(a => a.requested_date === selectedDate && a.is_waitlist && activeBooking(a)); if (!list.length) return ''; return `<section class="panel waitlist-panel"><div class="panel-title"><div><h2><i class="fa-solid fa-hourglass-half"></i> قائمة انتظار اليوم</h2><p>عند إلغاء موعد، افتحي بطاقة المريضة من هنا وحددي الوقت ثم أزيلي علامة الانتظار.</p></div><span class="count-badge">${list.length}</span></div><div class="appointment-grid compact">${list.map(requestCard).join('')}</div></section>`; }
function dailyClosingView() { return activeView === 'closing' ? closingCardsView() : ''; }
function closingCardsView() {
  const payments = (closingSnapshot.payments || []).map(a => ({ ...a, patients:{ full_name:a.patient_name } }));
  const counts = closingSnapshot.counts || {};
  const filtered = dailyPaymentFilter ? payments.filter(a => a.payment_method === dailyPaymentFilter) : payments;
  const sum = list => list.reduce((total, a) => total + Number(a.amount_paid || 0), 0);
  const byMethod = method => payments.filter(a => a.payment_method === method);
  const cash = byMethod('cash');
  const electronic = payments.filter(a => ['visa','instapay','vodafone_cash'].includes(a.payment_method));
  const attendance = [
    ['fa-calendar-day','موعد اليوم',Number(counts.total || 0),''],
    ['fa-heart-circle-check','حضرت',Number(counts.completed || 0),'attended'],
    ['fa-user-clock','لم تحضر',Number(counts.no_show || 0),'missed'],
    ['fa-ban','أُلغي',Number(counts.cancelled || 0),'cancelled']
  ];
  const methods = [
    ['', 'fa-layer-group', 'كل التحصيلات', sum(payments), 'all'],
    ['cash', 'fa-money-bill-wave', 'نقدًا في الدرج', sum(cash), 'cash'],
    ['visa', 'fa-credit-card', 'فيزا', sum(byMethod('visa')), 'visa'],
    ['instapay', 'fa-mobile-screen-button', 'إنستا باي', sum(byMethod('instapay')), 'instapay'],
    ['vodafone_cash', 'fa-wallet', 'فودافون كاش', sum(byMethod('vodafone_cash')), 'vodafone']
  ];
  return `<section class="closing-dashboard-card"><header class="closing-card-head"><div><span class="closing-kicker"><i class="fa-solid fa-calendar-check"></i> ملخص واضح لليوم</span><h2>ملخص ${formatDate(selectedDate, true)}</h2><p>تتحدث الأرقام تلقائيًا فور تسجيل الدفع أو تعديل حالة الموعد.</p></div><label class="closing-date-field">اختاري اليوم<input type="date" id="closingDate" value="${selectedDate}"></label></header><section class="closing-section"><div class="closing-section-title"><h3><i class="fa-solid fa-users"></i> حالة المواعيد</h3><span>${Number(counts.total || 0)} موعد مسجل</span></div><div class="attendance-cards">${attendance.map(([icon,label,value,tone]) => `<article class="attendance-card ${tone}"><i class="fa-solid ${icon}"></i><span>${label}</span><b>${value}</b></article>`).join('')}</div></section><section class="closing-section"><div class="closing-section-title"><h3><i class="fa-solid fa-coins"></i> ملخص المبالغ</h3><span>من عمليات الدفع المسجلة فقط</span></div><div class="closing-summary-cards"><article class="closing-summary-card drawer"><i class="fa-solid fa-cash-register"></i><span>الموجود في الدرج</span><b>${money(sum(cash))}</b><small>النقدية فقط</small></article><article class="closing-summary-card collected"><i class="fa-solid fa-sack-dollar"></i><span>إجمالي تحصيل اليوم</span><b>${money(sum(payments))}</b><small>${payments.length} عملية دفع</small></article><article class="closing-summary-card electronic"><i class="fa-solid fa-building-columns"></i><span>المدفوع إلكترونيًا</span><b>${money(sum(electronic))}</b><small>فيزا + إنستا باي + فودافون كاش</small></article></div></section><section class="closing-section"><div class="closing-section-title"><h3><i class="fa-solid fa-credit-card"></i> وسائل الدفع</h3><span>اضغطي على بطاقة لتصفية العمليات بالأسفل</span></div><div class="payment-summary-cards">${methods.map(([method,icon,label,value,tone]) => `<button class="payment-summary-card ${tone} ${dailyPaymentFilter === method ? 'active' : ''}" data-action="filter-daily-payment" data-method="${method}"><i class="fa-solid ${icon}"></i><span>${label}</span><b>${money(value)}</b></button>`).join('')}</div></section><section class="closing-section closing-transactions"><div class="closing-section-title"><h3><i class="fa-solid fa-receipt"></i> عمليات الدفع${dailyPaymentFilter ? `: ${paymentMethodText(dailyPaymentFilter)}` : ''}</h3><span>${filtered.length} عملية</span></div><div class="daily-payment-list">${filtered.length ? filtered.map(a => `<article><div><b>${escapeHtml(a.patients?.full_name || 'مريضة')}</b><small>${escapeHtml(typeText(a.request_type))}</small></div><span class="payment-chip ${escapeHtml(a.payment_method || 'other')}">${paymentMethodText(a.payment_method)}</span><b>${money(a.amount_paid)}</b></article>`).join('') : '<p class="muted">لا توجد عمليات دفع مسجلة لهذا اليوم.</p>'}</div></section></section>`;
}
dailyClosingView = function() { return activeView === 'closing' ? closingCardsView() : ''; };
function closingPage() { if (!financeEnabled() && closingSnapshot.enabled !== true) return `<section class="panel feature-off-card"><i class="fa-solid fa-lock"></i><h2>التقفيل اليومي غير متاح الآن</h2><p>تحتاج العيادة إلى تشغيل نظام الحسابات أولًا.</p></section>`; return `<section class="closing-page-intro"><div><span class="closing-kicker"><i class="fa-solid fa-cash-register"></i> صفحة مستقلة</span><h2>التقفيل اليومي</h2><p>ملخص يومي محدود للحضور والتحصيل دون فتح الحسابات الشهرية.</p></div><button class="ghost-btn" data-view="home"><i class="fa-solid fa-arrow-right"></i> العودة للمتابعة</button></section>${dailyClosingView()}`; }

function requestCard(a) {
  const phone = safePhone(a.patients?.phone); const attachment = hasAttachment(a) ? `<span class="attachment-badge"><i class="fa-solid fa-paperclip"></i> مرفق</span>` : ''; const vip = a.patient_id && isVipPatient(a.patient_id) ? `<span class="vip-badge request-vip-badge"><i class="fa-solid fa-crown"></i> عضوة مميزة</span>` : ''; const visits = a.patient_id ? `<span class="visit-badge"><i class="fa-solid fa-heart-pulse"></i> ${completedVisits(a.patient_id)} زيارة</span>` : ''; const births = a.patient_id && birthCount(a.patient_id) ? `<span class="birth-badge"><i class="fa-solid fa-baby"></i> ولدت معنا ×${birthCount(a.patient_id)}</span>` : ''; const waiting = a.is_waitlist ? `<span class="waitlist-badge"><i class="fa-solid fa-hourglass-half"></i> قائمة انتظار</span>` : ''; const incomplete = paymentIncomplete(a) ? `<span class="payment-alert-badge"><i class="fa-solid fa-wallet"></i> دفع غير مكتمل</span>` : ''; const schedule = a.requested_time ? `<span><i class="fa-solid fa-clock"></i> ${formatTime(a.requested_time)}</span>` : '';
  return `<article class="request-card status-${a.status} ${vip ? 'request-vip-card' : ''}"><div class="request-card-top"><span class="status ${escapeHtml(a.status)}"><i class="fa-solid ${statusIcons[a.status] || 'fa-circle'}"></i> ${statusLabels[a.status] || 'طلب جديد'}</span><span class="card-badges">${vip}${waiting}${incomplete}${attachment}</span></div><button class="request-main" data-action="details" data-id="${Number(a.id)}"><b>${escapeHtml(a.patients?.full_name || 'مريضة غير مسجلة')}</b><span><i class="fa-solid fa-stethoscope"></i> ${escapeHtml(typeText(a.request_type))}</span><span><i class="fa-solid fa-calendar"></i> ${escapeHtml(requestDate(a))}</span>${schedule}${a.outcome_reason ? `<small class="outcome-line">${escapeHtml(outcomeReasonText(a.outcome_reason))}${a.outcome_note ? ` · ${escapeHtml(a.outcome_note)}` : ''}</small>` : (a.message ? `<small>“${escapeHtml(a.message)}”</small>` : '<small class="muted">لا توجد رسالة إضافية</small>')}</button><div class="request-actions"><a href="tel:${phone}" class="icon-action call" title="اتصال"><i class="fa-solid fa-phone"></i><span>اتصال</span></a><button class="icon-action whatsapp" data-action="whatsapp" data-id="${Number(a.id)}" title="واتساب"><i class="fa-brands fa-whatsapp"></i><span>واتساب</span></button><button class="icon-action details" data-action="details" data-id="${Number(a.id)}"><i class="fa-solid fa-arrow-left"></i><span>التفاصيل</span></button></div></article>`;
}
function emptyState(icon, message) { return `<div class="empty"><i class="fa-solid ${icon}"></i><span>${message}</span></div>`; }
function appointmentsView() { const paymentFilter = financeEnabled() ? `<select id="paymentFilter"><option value="">كل وسائل الدفع</option><option value="cash">نقدًا</option><option value="visa">فيزا</option><option value="instapay">إنستا باي</option><option value="vodafone_cash">فودافون كاش</option></select>` : ''; return `<section class="panel"><div class="panel-title"><div><h2>كل الطلبات</h2><p>ابحثي بالاسم، أو آخر 4 أرقام من الهاتف، وحددي الحالة والتاريخ.</p></div><button class="ghost-btn" data-action="clear-filters">مسح التصفية</button></div><div class="toolbar"><input id="searchAppointments" placeholder="اسم المريضة أو آخر 4 أرقام"><select id="statusFilter"><option value="">كل الحالات</option>${Object.entries(statusLabels).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select>${paymentFilter}<input type="date" id="filterDate" value=""></div><div id="appointmentsList" class="appointment-grid all-requests">${appointments.length ? appointments.map(requestCard).join('') : emptyState('fa-calendar-xmark', 'لا توجد طلبات مسجلة بعد.')}</div></section>`; }
function patientsView() { const patients = sortPatients(patientList()); return `<section class="panel"><div class="panel-title"><div><h2>عائلة العيادة</h2><p>ابحثي بالاسم أو آخر 4 أرقام من الهاتف، وافتحي ملف المريضة للحجز والمتابعة.</p></div><div class="family-tools"><input id="searchPatients" placeholder="اسم المريضة أو آخر 4 أرقام"><label>ترتيب القائمة<select id="patientSort"><option value="alphabetical" ${patientSort === 'alphabetical' ? 'selected' : ''}>أبجديًا</option><option value="newest" ${patientSort === 'newest' ? 'selected' : ''}>الأحدث انضمامًا</option><option value="oldest" ${patientSort === 'oldest' ? 'selected' : ''}>الأقدم انضمامًا</option><option value="last_visit" ${patientSort === 'last_visit' ? 'selected' : ''}>آخر زيارة (الأحدث)</option><option value="overdue" ${patientSort === 'overdue' ? 'selected' : ''}>الأكثر تأخرًا للمتابعة</option><option value="vip" ${patientSort === 'vip' ? 'selected' : ''}>العضوات المميزات أولًا</option><option value="births" ${patientSort === 'births' ? 'selected' : ''}>الولادات معنا أولًا</option></select></label></div></div><div class="card-color-guide" aria-label="دليل ألوان بطاقات عائلة العيادة"><span><i class="guide-dot regular"></i> بطاقة عادية</span><span><i class="guide-dot vip"></i> عضوة مميزة: 5 زيارات مكتملة أو أكثر</span><span><i class="guide-dot overdue"></i> تحتاج متابعة</span></div><div id="patientsList" class="patients-list patient-card-grid">${patients.length ? patients.map(patientCard).join('') : emptyState('fa-users', 'لا توجد مريضات مسجلات بعد.')}</div></section>`; }
function lastCompletedVisit(patientId) { return appointments.filter(a => a.patient_id === patientId && a.status === 'completed' && a.requested_date).sort((a,b) => b.requested_date.localeCompare(a.requested_date))[0]; }
function patientCard(patient) { const visits = appointments.filter(a => a.patient_id === patient.id); const completedCount = visits.filter(a => a.status === 'completed').length; const isVip = completedCount >= 5; const births = Number(patient.clinic_births || 0); const lastVisit = lastCompletedVisit(patient.id); const next = futureVisits(patient.id)[0]; const days = overdueDays(patient.id); const overdue = days >= 30 && !next ? `<em class="overdue">تحتاج متابعة منذ ${days} يومًا</em>` : ''; const cardClass = isVip ? ' patient-vip-card' : (overdue ? ' patient-overdue-card' : ''); const badge = isVip ? `<em class="vip-badge"><i class="fa-solid fa-crown"></i> عضوة مميزة</em>` : ''; return `<button class="patient-card${cardClass}" data-action="patient" data-patient="${escapeHtml(patient.id)}"><span class="patient-avatar">${escapeHtml(patient.full_name?.trim().charAt(0) || 'م')}</span><span><b>${escapeHtml(patient.full_name)} ${badge}</b><small dir="ltr">${escapeHtml(safePhone(patient.phone))}</small><small>${completedCount} زيارة مكتملة${births ? ` · ولدت معنا ×${births}` : ''} · ${lastVisit ? `آخر زيارة ${formatDate(lastVisit.requested_date, true)}` : 'لا توجد زيارة مكتملة'}</small>${next ? `<small class="next-visit">القادم: ${formatDate(next.requested_date, true)}</small>` : overdue}</span><i class="fa-solid fa-arrow-left"></i></button>`; }
function reportsView() { const month = appointments.filter(a => (a.requested_date || a.created_at || '').slice(0, 7) === reportMonth); const completed = month.filter(a => a.status === 'completed').length; const rate = month.length ? Math.round(completed / month.length * 100) : 0; const types = {}; const sources = {}; month.forEach(a => { const name = typeText(a.request_type); types[name] = (types[name] || 0) + 1; const source = a.source || 'الموقع'; sources[source] = (sources[source] || 0) + 1; }); return `<section class="panel"><div class="panel-title"><div><h2>ملخص الشهر</h2><p>اختاري أي شهر سابق أو حالي لمراجعة الأرقام.</p></div><input type="month" id="reportMonth" value="${reportMonth}"></div></section><div class="stat-grid report-stats">${stat('إجمالي الحجوزات', month.length, 'fa-calendar')}${stat('تمت الزيارة', completed, 'fa-heart-circle-check', 'good')}${stat('نسبة الحضور', `${rate}%`, 'fa-chart-line')}${stat('لم تحضر / أُلغي', month.filter(a => ['cancelled','no_show'].includes(a.status)).length, 'fa-ban')}${stat('مرفقات', month.filter(hasAttachment).length, 'fa-paperclip')}</div><section class="panel"><h2>الطلبات حسب الخدمة</h2><div class="report-grid">${Object.entries(types).map(([name,count]) => `<div class="report-item"><span>${escapeHtml(name)}</span><b>${count}</b></div>`).join('') || emptyState('fa-chart-pie', 'لا توجد بيانات لهذا الشهر.')}</div></section><section class="panel"><h2>مصدر المريضات</h2><div class="report-grid">${Object.entries(sources).map(([name,count]) => `<div class="report-item"><span>${escapeHtml(name)}</span><b>${count}</b></div>`).join('') || emptyState('fa-chart-pie', 'لا توجد بيانات مصدر مسجلة لهذا الشهر.')}</div></section>`; }
function financeView() { if (!financeEnabled()) return `<section class="panel feature-off-card"><i class="fa-solid fa-lock"></i><h2>نظام الحسابات مغلق حاليًا</h2><p>يمكن للدكتورة تشغيله من إعدادات العيادة عند الحاجة، حتى لو كانت الأسعار ما زالت صفرًا.</p><button class="primary-btn" data-view="settings">فتح الإعدادات</button></section>`; const payments = appointments.filter(a => (a.payment_recorded_at || '').slice(0,7) === financeMonth && a.amount_paid !== null && a.amount_paid !== undefined); const monthExpenses = expenses.filter(e => String(e.expense_date || '').slice(0,7) === financeMonth); const sum = list => list.reduce((total,item) => total + Number(item.amount_paid ?? item.amount ?? 0), 0); const due = payments.reduce((total,a) => total + Number(a.amount_due || 0), 0); const paid = sum(payments); const expenseTotal = sum(monthExpenses); const difference = paid - due; const net = paid - expenseTotal; return `${financeTrialNotice()}<section class="panel"><div class="panel-title"><div><h2>الحسابات</h2><p>سجل التحصيل والمصروفات؛ يظهر للدكتورة فقط.</p></div><input id="financeMonth" type="month" value="${financeMonth}"></div></section><div class="stat-grid finance-stats">${stat('المحصل', money(paid), 'fa-sack-dollar','good')}${stat('المصروفات', money(expenseTotal), 'fa-receipt','attention')}${stat('صافي الشهر', money(net), 'fa-scale-balanced', net >= 0 ? 'good' : 'attention')}${stat(difference < 0 ? 'إجمالي المتبقي' : 'فرق زائد', money(Math.abs(difference)), difference < 0 ? 'fa-arrow-down' : 'fa-arrow-up', difference < 0 ? 'attention' : '')}${stat('عمليات دفع', payments.length, 'fa-money-bill-wave')}</div><section class="finance-two-col"><section class="panel"><div class="panel-title"><div><h2>تفاصيل الدفع</h2><p>الأحمر يعني متبقيًا على المريضة، والأخضر سدادًا كاملًا أو زيادة.</p></div></div><div class="finance-list">${payments.length ? payments.sort((a,b) => new Date(b.payment_recorded_at) - new Date(a.payment_recorded_at)).map(a => { const delta=Number(a.amount_paid||0)-Number(a.amount_due||0); return `<article class="finance-row ${delta < 0 ? 'is-short' : 'is-settled'}"><div><b>${escapeHtml(a.patients?.full_name || 'مريضة')}</b><span>${escapeHtml(typeText(a.request_type))} · ${a.requested_date ? formatDate(a.requested_date,true) : 'بدون تاريخ'}</span></div><div><span>المطلوب</span><b>${money(a.amount_due)}</b></div><div><span>المدفوع</span><b>${money(a.amount_paid)}</b></div><div><span>${delta < 0 ? 'المتبقي' : delta > 0 ? 'زيادة' : 'الحالة'}</span><b>${delta === 0 ? 'مكتمل' : money(Math.abs(delta))}</b></div><div><span>الوسيلة</span><b>${paymentMethodText(a.payment_method)}</b></div></article>`; }).join('') : emptyState('fa-wallet','لا توجد عمليات دفع مسجلة لهذا الشهر.')}</div></section><section class="panel expense-panel"><div class="panel-title"><div><h2>مصروفات العيادة</h2><p>تظهر للدكتورة فقط وتدخل في صافي الشهر.</p></div><span class="count-badge">${money(expenseTotal)}</span></div><form id="expenseForm" class="expense-form"><label class="field">التاريخ<input name="expense_date" type="date" value="${selectedDate}" required></label><label class="field">التصنيف<select name="category"><option>مستلزمات</option><option>إيجار</option><option>رواتب</option><option>إعلانات</option><option>صيانة</option><option>أخرى</option></select></label><label class="field">المبلغ<input name="amount" type="number" min="0" step="0.01" required></label><label class="field full">ملاحظة اختيارية<textarea name="note" placeholder="مثال: مستلزمات كشف"></textarea></label><button class="primary-btn" type="submit"><i class="fa-solid fa-plus"></i> إضافة مصروف</button></form><div class="expense-list">${monthExpenses.length ? monthExpenses.map(e => `<article><div><b>${escapeHtml(e.category)}</b><small>${formatDate(e.expense_date,true)}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</small></div><b>${money(e.amount)}</b></article>`).join('') : '<p class="muted">لا توجد مصروفات مسجلة لهذا الشهر.</p>'}</div></section></section>`; }
function financeViewFiltered() { return financeView(); }
function expensesHistoryView() { const visible = [...expenses].sort((a,b) => String(b.expense_date || '').localeCompare(String(a.expense_date || ''))); return `<section class="panel"><div class="panel-title"><div><h2>سجل المصروفات</h2><p>عرض المصروفات السابقة فقط؛ لا يتضمن تفاصيل تحصيل المريضات.</p></div><button class="primary-btn" data-view="expense_add"><i class="fa-solid fa-plus"></i> إضافة مصروف</button></div><div class="expense-list">${visible.length ? visible.map(item => `<article><div><b>${escapeHtml(item.category)}</b><small>${formatDate(item.expense_date,true)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div><b>${money(item.amount)}</b></article>`).join('') : '<p class="muted">لا توجد مصروفات مسجلة.</p>'}</div></section>`; }
function expenseEntryView() { if (!financeEnabled()) return `<section class="panel feature-off-card"><i class="fa-solid fa-lock"></i><h2>تسجيل المصروفات متوقف</h2><p>تحتاج العيادة إلى تشغيل الحسابات أولًا. لا تعرض هذه الصفحة أي مصروفات سابقة.</p></section>`; return `<section class="panel expense-entry-only"><div class="panel-title"><div><span class="closing-kicker"><i class="fa-solid fa-receipt"></i> إدخال مستقل</span><h2>إضافة مصروف يومي</h2><p>تسجيل مصروف جديد فقط؛ لا تظهر في هذا الحساب سجلات أو إجماليات المصروفات السابقة.</p></div></div><form id="expenseForm" class="expense-form"><label class="field">التاريخ<input name="expense_date" type="date" value="${selectedDate}" required></label><label class="field">التصنيف<select name="category"><option>مستلزمات</option><option>إيجار</option><option>رواتب</option><option>إعلانات</option><option>صيانة</option><option>أخرى</option></select></label><label class="field">المبلغ<input name="amount" type="number" min="0" step="0.01" required></label><label class="field full">ملاحظة اختيارية<textarea name="note" maxlength="2000" placeholder="مثال: مستلزمات كشف"></textarea></label><button class="primary-btn" type="submit"><i class="fa-solid fa-plus"></i> حفظ المصروف</button></form></section>`; }
function nextDate() { const tomorrow = new Date(`${selectedDate}T12:00:00`); tomorrow.setDate(tomorrow.getDate() + 1); return tomorrow.toISOString().slice(0, 10); }
function calendarView() { const [year, month] = calendarMonth.split('-').map(Number); const start = new Date(year, month - 1, 1); const end = new Date(year, month, 0); const startOffset = (start.getDay() + 1) % 7; const cells = Array.from({ length: startOffset + end.getDate() }, (_, i) => { if (i < startOffset) return '<div class="calendar-cell blank"></div>'; const day = i - startOffset + 1; const date = `${calendarMonth}-${String(day).padStart(2,'0')}`; const items = appointments.filter(a => a.requested_date === date && !['cancelled','no_show'].includes(a.status)); return `<button class="calendar-cell ${items.length ? 'has-bookings' : 'no-bookings'} ${date === selectedDate ? 'selected' : ''}" data-action="calendar-day" data-date="${date}"><b>${day}</b>${items.length ? `<span>${items.length} حجز</span>` : '<span>—</span>'}</button>`; }).join(''); const selected = appointments.filter(a => a.requested_date === selectedDate); return `<section class="panel"><div class="panel-title"><div><h2>تقويم المواعيد</h2><p>كل بطاقة ملوّنة تعرض عدد الحجوزات فقط، وباقي التفاصيل تظهر عند اختيار اليوم.</p></div><input id="calendarMonth" type="month" value="${calendarMonth}"></div><div class="calendar-grid calendar-grid-no-labels">${cells}</div></section><section class="panel"><div class="panel-title"><h2>${formatDate(selectedDate)}</h2><span class="count-badge">${selected.length}</span></div><div class="appointment-grid compact">${selected.length ? selected.map(requestCard).join('') : emptyState('fa-calendar-xmark', 'لا توجد مواعيد لهذا اليوم.')}</div></section>`; }
function alertsView() { const open = alerts.filter(a => !a.resolved_at); const overdue30 = patientList().filter(p => overdueDays(p.id) >= 30 && overdueDays(p.id) < 60 && !futureVisits(p.id).length); const overdue60 = patientList().filter(p => overdueDays(p.id) >= 60 && !futureVisits(p.id).length); const alertRows = open.map(a => { const duplicate = (a.alert_type || 'duplicate_booking') === 'duplicate_booking'; return `<article class="alert-row"><i class="fa-solid ${duplicate ? 'fa-copy' : 'fa-triangle-exclamation'}"></i><div><b>${duplicate ? 'محاولة حجز مكررة' : 'تنبيه حجز'}</b><span>${escapeHtml(a.message || a.reason || 'راجعي بيانات الحجز.')}</span><small>${new Date(a.created_at).toLocaleString('ar-EG')}</small></div><button class="ghost-btn" data-action="resolve-alert" data-id="${a.id}">تمت المراجعة</button></article>`; }).join(''); const overdueRow = p => `<article class="alert-row"><i class="fa-solid fa-user-clock"></i><div><b>${escapeHtml(p.full_name)}</b><span>${overdueDays(p.id)} يومًا منذ آخر زيارة، ولا يوجد موعد قادم.</span><small dir="ltr">${escapeHtml(safePhone(p.phone))}</small></div><button class="ghost-btn" data-action="patient" data-patient="${p.id}">فتح الملف</button></article>`; return `<section class="panel"><div class="panel-title"><div><h2>تنبيهات الحجوزات المكررة</h2><p>تظهر هنا أي محاولة أوقفها الموقع بسبب رقم هاتف أو اسم مطابق.</p></div><div class="alert-title-actions"><span class="count-badge">${open.length}</span>${open.length ? '<button class="ghost-btn resolve-all-btn" data-action="resolve-all-alerts"><i class="fa-solid fa-check-double"></i> تمت مراجعة الكل</button>' : ''}</div></div><div class="alert-list">${alertRows || emptyState('fa-circle-check','لا توجد تنبيهات جديدة.')}</div></section><section class="panel"><div class="panel-title"><div><h2>مريضات تحتاج متابعة بعد 30 يومًا</h2><p>لا يظهر هنا من لديها موعد قادم.</p></div><span class="count-badge">${overdue30.length}</span></div><div class="alert-list">${overdue30.length ? overdue30.map(overdueRow).join('') : emptyState('fa-circle-check','لا توجد مريضات متأخرات 30 يومًا.')}</div></section><section class="panel"><div class="panel-title"><div><h2>تأخر أكثر من 60 يومًا</h2><p>أولوية أعلى للاتصال والمتابعة.</p></div><span class="count-badge">${overdue60.length}</span></div><div class="alert-list">${overdue60.length ? overdue60.map(overdueRow).join('') : emptyState('fa-circle-check','لا توجد مريضات متأخرات أكثر من 60 يومًا.')}</div></section>`; }
function settingsView() { if (!settings) return `<section class="panel">${emptyState('fa-triangle-exclamation', 'تعذر تحميل الإعدادات.')}</section>`; const prices = settings.service_prices || {}; const priceField = (key, label) => `<label class="field">${label}<input name="price_${key}" type="number" min="0" step="0.01" value="${Number(prices[key] || 0)}" placeholder="0"></label>`; return `<section class="panel"><div class="panel-title"><div><h2>تشغيل العيادة</h2><p>هذه الإعدادات والأسعار تظهر للدكتورة فقط.</p></div><span class="status confirmed">للدكتورة فقط</span></div><form id="settingsForm" class="settings-grid"><label class="field">اسم العيادة<input name="clinic_name" value="${escapeHtml(settings.clinic_name)}"></label><label class="field">الحد الأقصى للحجوزات يوميًا<input name="max_daily_slots" type="number" min="1" value="${Number(settings.max_daily_slots) || 1}"></label><label class="field">بداية العمل<input name="work_start" type="time" value="${escapeHtml(settings.work_start)}"></label><label class="field">نهاية العمل<input name="work_end" type="time" value="${escapeHtml(settings.work_end)}"></label><label class="field">تواريخ الإجازات (كل تاريخ في سطر)<textarea name="closed_dates">${escapeHtml((settings.closed_dates || []).join('\n'))}</textarea></label><label class="field">أيام الإجازة الأسبوعية<select name="closed_weekdays" multiple><option value="4" ${(settings.closed_weekdays || []).includes(4) ? 'selected' : ''}>الخميس</option><option value="5" ${(settings.closed_weekdays || []).includes(5) ? 'selected' : ''}>الجمعة</option><option value="6" ${(settings.closed_weekdays || []).includes(6) ? 'selected' : ''}>السبت</option></select></label><section class="finance-switch"><div><b><i class="fa-solid fa-wallet"></i> تشغيل نظام الحسابات</b><small>عند الإغلاق لا يظهر تسجيل الدفع أو صفحة الحسابات. يمكن تشغيله دون إدخال أسعار الآن.</small></div><label class="switch"><input name="finance_enabled" type="checkbox" ${financeEnabled() ? 'checked' : ''}><span></span><em>${financeEnabled() ? 'مفتوح' : 'مغلق'}</em></label></section><section class="price-settings"><h3><i class="fa-solid fa-tags"></i> أسعار الخدمات (جنيه مصري)</h3><p>اختيارية تمامًا؛ اتركيها صفرًا ثم أضيفيها لاحقًا عند تشغيل الحسابات.</p>${financeTrialNotice()}<div class="price-grid">${priceField('first','كشف أول مرة')}${priceField('follow','كشف متابعة')}${priceField('consult','استشارة متابعة')}${priceField('aesthetic','تجميل نسائي')}${priceField('birth','حجز ولادة')}${priceField('labs','تحاليل أو أشعة')}</div></section><button class="primary-btn" type="submit">حفظ الإعدادات</button></form></section>`; }

function teamView() {
  if (!hasPermission('team.view')) return `<section class="panel">${emptyState('fa-lock','إدارة الفريق غير متاحة لهذا الحساب.')}</section>`;
  const owner = isOwner();
  const activeCount = teamMembers.filter(member => ['owner','doctor','secretary'].includes(member.role) && !member.disabled).length;
  const roleName = role => ({ owner:'مالك النظام', doctor:'طبيبة', secretary:'سكرتارية', pending:'موقوف' }[role] || 'غير محدد');
  const rows = teamMembers.map(member => {
    const protectedAccount = member.role === 'owner';
    const canEditPermissionDraft = owner && hasPermission('team.manage') && !member.is_self && !protectedAccount;
    const canManage = canEditPermissionDraft && permissionMatrixAvailable;
    const permissions = withPermissionDependencies(Array.isArray(member.permissions) ? member.permissions : defaultPermissionsFor(member.role));
    const editor = PERMISSION_GROUPS.map(group => { const checkedCount = group.items.filter(([key]) => permissions.includes(key)).length; return `<section class="permission-group"><header><div><i class="fa-solid ${group.icon}"></i><b>${group.title}</b><small>${checkedCount} من ${group.items.length} مفعّلة</small></div><label class="permission-check permission-select-group"><input type="checkbox" data-permission-group="${group.id}" data-user="${member.id}" ${checkedCount === group.items.length ? 'checked' : ''} ${canEditPermissionDraft ? '' : 'disabled'}><span>تحديد القسم كله</span></label></header><div class="permission-grid">${group.items.map(([key,label]) => `<label class="permission-check"><input type="checkbox" data-permission="${key}" data-user="${member.id}" ${permissions.includes(key) ? 'checked' : ''} ${canEditPermissionDraft ? '' : 'disabled'}><span>${label}</span></label>`).join('')}</div></section>`; }).join('');
    const profilePicker = canManage ? `<label class="field permission-profile-picker">تطبيق مجموعة صلاحيات محفوظة<select data-permission-profile="${member.id}"><option value="">اختاري مجموعة محفوظة…</option>${permissionProfiles.map(item => `<option value="${escapeHtml(item.id)}" ${member.permission_profile_id === item.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(permissionTemplateName(item.template_role))}</option>`).join('')}</select></label>` : '';
    const permissionNote = canEditPermissionDraft && !permissionMatrixAvailable ? '<p class="permission-draft-note" role="status"><i class="fa-solid fa-circle-info"></i> يمكنك تجربة تحديد الصلاحيات الآن؛ لن تُحفظ قبل تفعيل مصفوفة الصلاحيات في قاعدة البيانات.</p>' : '';
    return `<article class="team-member permission-member ${member.disabled || member.role === 'pending' ? 'is-disabled' : ''} ${protectedAccount ? 'is-owner' : ''}"><div class="team-person"><span class="team-avatar"><i class="fa-solid ${protectedAccount ? 'fa-crown' : member.role === 'doctor' ? 'fa-user-doctor' : member.role === 'secretary' ? 'fa-user-nurse' : 'fa-user-clock'}"></i></span><div><b>${escapeHtml(member.full_name || member.email)}</b><small dir="ltr">${escapeHtml(member.email)}</small><small>${member.is_self ? 'حسابك الحالي · صلاحيات المالك كاملة' : member.last_sign_in_at ? `آخر دخول ${new Date(member.last_sign_in_at).toLocaleDateString('ar-EG')}` : member.invited_at ? 'بانتظار قبول الدعوة' : 'لم يسجل الدخول بعد'}</small></div></div><div class="team-controls"><span class="team-role ${protectedAccount ? 'owner-role' : member.disabled || member.role === 'pending' ? 'inactive' : ''}">${roleName(member.disabled ? 'pending' : member.role)}</span>${canManage ? `<label class="sr-only" for="team-role-${member.id}">الدور الأساسي لـ ${escapeHtml(member.full_name || member.email)}</label><select id="team-role-${member.id}" data-team-role="${member.id}" ${member.disabled || member.role === 'pending' ? 'data-current-role="pending"' : `data-current-role="${member.role}"`}><option value="secretary" ${member.role === 'secretary' ? 'selected' : ''}>سكرتارية</option><option value="doctor" ${member.role === 'doctor' ? 'selected' : ''}>طبيبة</option></select><button class="ghost-btn" data-action="team-save-role" data-user="${member.id}">${member.disabled || member.role === 'pending' ? 'إعادة التفعيل بالدور المختار' : 'حفظ الدور الأساسي'}</button>${member.disabled || member.role === 'pending' ? '' : `<button class="team-disable-btn" data-action="team-disable" data-user="${member.id}">إيقاف الحساب</button>`}` : ''}</div><details class="permission-editor"><summary><span>صلاحيات الحساب التفصيلية</span><small>${member.has_custom_permissions ? `مجموعة: ${escapeHtml(member.permission_set_name || 'مخصصة')} · ${escapeHtml(permissionTemplateName(member.permission_template_role))}` : 'إعداد الدور الافتراضي'}</small></summary><div class="permission-editor-body"><div class="permission-editor-tools"><p>${canManage ? 'اختاري أقسام الوصول لهذا الحساب. عند اختيار إجراء، ستُحدد صلاحيات العرض اللازمة له تلقائيًا.' : protectedAccount ? 'المالك يملك كل الصلاحيات تلقائيًا.' : 'عرض فقط؛ تغيير الصلاحيات للمالك.'}</p><label class="permission-check"><input type="checkbox" data-permission-all="${member.id}" data-user="${member.id}" ${permissions.length === ALL_PERMISSION_KEYS.length ? 'checked' : ''} ${canEditPermissionDraft ? '' : 'disabled'}><span>تحديد كل الصلاحيات</span></label></div>${permissionNote}${profilePicker}${editor}<div class="permission-editor-actions">${canManage ? `<label class="field">اسم مجموعة الصلاحيات<input data-permission-set-name="${member.id}" maxlength="80" value="${escapeHtml(member.permission_set_name || '')}" placeholder="مثال: استقبال + تحصيل فقط" required></label><label class="field">نوع المجموعة<select data-permission-template="${member.id}" required><option value="secretary" ${(member.permission_template_role || member.role) === 'secretary' ? 'selected' : ''}>سكرتارية</option><option value="doctor" ${(member.permission_template_role || member.role) === 'doctor' ? 'selected' : ''}>طبيبة</option><option value="assistant" ${(member.permission_template_role || member.role) === 'assistant' ? 'selected' : ''}>مساعدة</option></select></label>` : ''}<button class="primary-btn" data-action="team-save-permissions" data-user="${member.id}" ${canManage ? '' : 'disabled'}>حفظ صلاحيات الحساب</button><button class="ghost-btn" data-action="team-reset-permissions" data-user="${member.id}" ${canManage ? '' : 'disabled'}>إرجاع لصلاحيات الدور</button>${canManage ? `<button class="ghost-btn" data-action="permission-profile-save" data-user="${member.id}">حفظ كمجموعة قابلة لإعادة الاستخدام</button>` : ''}</div></div></details></article>`;
  }).join('');
  const eventLabels = { invited:'تم إرسال دعوة', role_changed:'تغيير صلاحية', access_suspended:'إيقاف دخول', access_restored:'إعادة تفعيل الدخول' };
  const auditRows = teamEvents.map(event => `<article class="team-audit-row"><span class="team-audit-icon"><i class="fa-solid ${event.action === 'access_suspended' ? 'fa-user-slash' : event.action === 'invited' ? 'fa-envelope-circle-check' : 'fa-user-shield'}"></i></span><div><b>${eventLabels[event.action] || 'تحديث حساب'}</b><small dir="ltr">${escapeHtml(event.target_email)}</small><small>${escapeHtml(event.actor_name)} · ${new Date(event.created_at).toLocaleString('ar-EG')}</small></div><span class="team-audit-role">${roleName(event.new_role)}</span></article>`).join('');
  const matrixNotice = owner && !permissionMatrixAvailable ? `<aside class="permission-matrix-warning" role="status"><i class="fa-solid fa-circle-info"></i><span><b>مصفوفة الاختيارات لم تُفعّل على قاعدة البيانات بعد.</b> الحسابات ظاهرة، لكن حفظ مربعات الصلاحيات يحتاج تطبيق ملف التهيئة المحلي أولًا.</span></aside>` : '';
  return `<section class="team-page ${owner ? 'owner-control-room' : ''}"><section class="panel team-intro"><div><span class="team-kicker"><i class="fa-solid ${owner ? 'fa-crown' : 'fa-shield-halved'}"></i> ${owner ? 'غرفة تحكم المالك' : 'إدارة فريق العيادة'}</span><h2>${owner ? 'مركز الصلاحيات' : 'حسابات فريق العيادة'}</h2><p>${owner ? 'اختاري حسابًا ثم حددي الصفحات والإجراءات التي تظهر له. بعض الإجراءات تضيف تلقائيًا صلاحية عرض البيانات اللازمة لها، وستظهر مربعاتها محددة قبل الحفظ.' : 'عرض للفريق؛ تعديل الصلاحيات التفصيلية متاح لمالك النظام فقط.'}</p></div><div class="team-cap"><b>${activeCount}<small> / 5</small></b><span>حسابات نشطة</span></div></section>${matrixNotice}${owner ? `<section class="panel"><div class="panel-title"><div><h2>مجموعات صلاحيات جاهزة</h2><p>أنشئي اسمًا فريدًا للمجموعة واختاري تصنيفها: طبيبة أو مساعدة أو سكرتارية، ثم طبّقيها على الحسابات.</p></div></div><div class="permission-profile-library">${permissionProfiles.map(item => `<article><b>${escapeHtml(item.name)}</b><span>${escapeHtml(permissionTemplateName(item.template_role))} · ${item.permissions.length} صلاحية</span><button class="ghost-btn" data-action="permission-profile-delete" data-profile="${escapeHtml(item.id)}">حذف المجموعة</button></article>`).join('') || '<p class="muted">لا توجد مجموعات محفوظة بعد.</p>'}</div></section>` : ''}${hasPermission('team.invite') ? `<section class="panel"><div class="panel-title"><div><h2>إضافة عضو للفريق</h2><p>تصل دعوة إنشاء كلمة المرور إلى البريد المدخل.</p></div></div><form id="teamInviteForm" class="team-invite-form" method="post"><label class="field">الاسم<input name="full_name" minlength="2" maxlength="100" autocomplete="name" required></label><label class="field">البريد الإلكتروني<input name="email" type="email" maxlength="254" autocomplete="email" required></label><label class="field">الدور الأساسي<select name="role"><option value="secretary">سكرتارية</option><option value="doctor">طبيبة</option></select></label><button class="primary-btn" type="submit" ${activeCount >= 5 ? 'disabled' : ''}><i class="fa-solid fa-paper-plane"></i> إرسال دعوة</button></form><p class="team-limit-note"><i class="fa-solid fa-circle-info"></i> خمسة حسابات نشطة كحد أقصى. المالك وحده يحدد الصلاحيات التفصيلية.</p></section>` : ''}<section class="panel"><div class="panel-title"><div><h2>اختيار الحساب وضبط الصلاحيات</h2><p>${owner ? 'افتحي حسابًا لمراجعة كل صلاحياته، ثم احفظي التغييرات أو أعيدي إعدادات دوره.' : 'الصلاحيات هنا للعرض فقط.'}</p></div><button class="ghost-btn" data-action="team-refresh"><i class="fa-solid fa-rotate"></i> تحديث الحسابات</button></div><div class="team-list">${teamLoading ? emptyState('fa-spinner fa-spin','جارٍ تحميل حسابات الفريق…') : teamMembers.length ? rows : emptyState('fa-user-group','لم تصل قائمة الحسابات. اضغطي تحديث الحسابات أو راجعي اتصال إدارة الفريق.')}</div></section><section class="panel team-audit-panel"><div class="panel-title"><div><h2>سجل تغييرات الفريق</h2><p>سجل الدعوات وتعديلات الصلاحيات والإيقاف.</p></div><span class="status confirmed">${owner ? 'إشراف المالك' : 'عرض للطبيبة'}</span></div><div class="team-audit-list">${teamLoading ? emptyState('fa-spinner fa-spin','جارٍ تحميل السجل…') : auditRows || emptyState('fa-clipboard-check','لا توجد تغييرات مسجلة حتى الآن.')}</div></section></section>`;
}
async function callTeamAdmin(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('clinic-team-admin', { body: { action, ...payload } });
  if (error) throw new Error(data?.error || error.message || 'تعذر الاتصال بخدمة إدارة الفريق.');
  if (data?.error) throw new Error(data.error);
  return data;
}
async function refreshTeam(showFailure = true) {
  if (!hasPermission('team.view')) return;
  teamLoading = true;
  permissionMatrixAvailable = false;
  if (activeView === 'team') renderView();
  try {
    const result = await callTeamAdmin('team.list');
    teamMembers = Array.isArray(result.members) ? result.members : [];
    teamEvents = Array.isArray(result.audit) ? result.audit : [];
    teamMembers = teamMembers.map(member => ({ ...member, permissions:defaultPermissionsFor(member.role), has_custom_permissions:false }));
    if (isOwner()) {
      const { data, error } = await supabase.rpc('owner_list_clinic_permissions');
      if (error) throw new Error(`تعذر تحميل مصفوفة الصلاحيات: ${error.message}`);
      const customById = new Map((Array.isArray(data) ? data : []).map(item => [item.user_id, item]));
      teamMembers = teamMembers.map(member => { const custom = customById.get(member.id); return { ...member, permissions:custom ? custom.permissions : defaultPermissionsFor(member.role), permission_set_name:custom?.permission_set_name || '', permission_template_role:custom?.permission_template_role || (member.role === 'doctor' ? 'doctor' : 'secretary'), permission_profile_id:custom?.permission_profile_id || null, has_custom_permissions:Boolean(custom) }; });
      const { data: profiles, error: profileError } = await supabase.rpc('owner_list_clinic_permission_profiles');
      if (profileError) throw new Error(`تعذر تحميل مجموعات الصلاحيات: ${profileError.message}`);
      permissionProfiles = Array.isArray(profiles) ? profiles : [];
      permissionMatrixAvailable = true;
    } else teamMembers = teamMembers.map(member => ({ ...member, permissions:defaultPermissionsFor(member.role), has_custom_permissions:false }));
  } catch (error) {
    permissionMatrixAvailable = false;
    if (showFailure) showToast(error.message);
  } finally {
    teamLoading = false;
    if (activeView === 'team') renderView();
  }
}
async function saveTeamPermissions(userId, reset = false) {
  if (!isOwner() || !hasPermission('team.manage')) return showToast('تعديل الصلاحيات التفصيلية لمالك النظام فقط.');
  if (!permissionMatrixAvailable) return showToast('مصفوفة الصلاحيات غير متاحة على قاعدة البيانات حتى الآن؛ لن يتم حفظ التغيير.');
  const member = teamMembers.find(item => item.id === userId);
  if (!member || member.is_self || member.role === 'owner') return showToast('حساب المالك محمي ولا يمكن تعديل صلاحياته.');
  const selected = reset ? null : [...new Set([...document.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]:checked`)].map(input => input.dataset.permission))];
  try {
    const setName = reset ? null : (document.querySelector(`[data-permission-set-name="${CSS.escape(userId)}"]`)?.value.trim() || null);
    const templateRole = reset ? null : (document.querySelector(`[data-permission-template="${CSS.escape(userId)}"]`)?.value || null);
    if (!reset && (!setName || setName.length < 2)) return showToast('اكتبي اسمًا جديدًا لمجموعة الصلاحيات (حرفان على الأقل).');
    const selectedProfile = reset ? '' : document.querySelector(`[data-permission-profile="${CSS.escape(userId)}"]`)?.value || '';
    const { error } = selectedProfile
      ? await supabase.rpc('owner_apply_clinic_permission_profile', { p_user_id:userId, p_profile_id:selectedProfile })
      : await supabase.rpc('owner_set_clinic_permissions', { p_user_id:userId, p_permissions:reset ? null : withPermissionDependencies(selected), p_permission_set_name:setName, p_permission_template_role:templateRole });
    if (error) throw error;
    showToast(reset ? 'تمت إعادة صلاحيات الحساب إلى إعداد الدور.' : 'تم حفظ صلاحيات الحساب.');
    await refreshTeam(false);
  } catch (error) { showToast(`تعذر حفظ الصلاحيات: ${error.message || 'خطأ غير معروف'}`); }
}
function applyPermissionProfile(userId, profileId) {
  if (!isOwner() || !hasPermission('team.manage') || !profileId) return;
  const preset = permissionProfiles.find(item => item.id === profileId);
  if (!preset) return;
  const normalized = new Set(withPermissionDependencies(preset.permissions));
  app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]`).forEach(input => { input.checked = normalized.has(input.dataset.permission); });
  const name = app.querySelector(`[data-permission-set-name="${CSS.escape(userId)}"]`);
  if (name) name.value = preset.name;
  const template = app.querySelector(`[data-permission-template="${CSS.escape(userId)}"]`);
  if (template) template.value = preset.template_role;
  updatePermissionSelectAll(userId);
  showToast(`تم تحميل مجموعة «${preset.name}». احفظي الحساب لتطبيقها.`);
}
async function savePermissionProfile(userId) {
  if (!isOwner() || !hasPermission('team.manage')) return;
  const member = teamMembers.find(item => item.id === userId);
  const name = app.querySelector(`[data-permission-set-name="${CSS.escape(userId)}"]`)?.value.trim();
  if (!member || !name || name.length < 2) return showToast('اكتبي اسمًا واضحًا لمجموعة الصلاحيات (حرفان على الأقل).');
  const permissions = withPermissionDependencies([...new Set([...app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]:checked`)].map(item => item.dataset.permission))]);
  const template = app.querySelector(`[data-permission-template="${CSS.escape(userId)}"]`)?.value || (member.role === 'doctor' ? 'doctor' : 'secretary');
  const { error } = await supabase.rpc('owner_save_clinic_permission_profile', { p_name:name, p_template_role:template, p_permissions:permissions });
  if (error) return showToast(`تعذر حفظ مجموعة الصلاحيات: ${error.message}`);
  await refreshTeam(false);
  showToast(`تم حفظ مجموعة «${name}» ويمكن تطبيقها على حساب آخر.`);
}
async function deletePermissionProfile(profileId) {
  if (!isOwner() || !hasPermission('team.manage') || !profileId) return;
  const preset = permissionProfiles.find(item => item.id === profileId);
  if (!preset || !confirm(`حذف مجموعة الصلاحيات «${preset.name}»؟ لن تتغير صلاحيات الحسابات التي طُبقت عليها.`)) return;
  const { error } = await supabase.rpc('owner_delete_clinic_permission_profile', { p_profile_id:profileId });
  if (error) return showToast(`تعذر حذف المجموعة: ${error.message}`);
  await refreshTeam(false);
  showToast('تم حذف مجموعة الصلاحيات.');
}
async function submitTeamInvite(event) {
  event.preventDefault();
  if (!hasPermission('team.invite')) return showToast('إضافة أعضاء الفريق غير متاحة لهذا الحساب.');
  const form = event.target?.id === 'teamInviteForm' ? event.target : null; if (!form) return; const fields = new FormData(form);
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const result = await callTeamAdmin('team.invite', { full_name:String(fields.get('full_name') || '').trim(), email:String(fields.get('email') || '').trim(), role:String(fields.get('role') || 'secretary') });
    form.reset(); showToast(result.message || 'تم إرسال الدعوة.'); await refreshTeam(false);
  } catch (error) { showToast(error.message); }
  finally { button.disabled = teamMembers.filter(m => ['owner','doctor','secretary'].includes(m.role) && !m.disabled).length >= 5; }
}
async function changeTeamRole(userId) {
  if (!isOwner() || !hasPermission('team.manage')) return showToast('تغيير الصلاحيات متاح لمالك النظام فقط.');
  const select = document.querySelector(`[data-team-role="${CSS.escape(userId)}"]`);
  const previous = select?.dataset.currentRole || 'pending'; const next = select?.value;
  if (!select || !['doctor','secretary'].includes(next)) return;
  if (previous === next && teamMembers.find(m => m.id === userId)?.disabled !== true) return showToast('الصلاحية لم تتغير.');
  try { const result = await callTeamAdmin('team.role', { user_id:userId, role:next }); showToast(result.message || 'تم تحديث الصلاحية.'); await refreshTeam(false); }
  catch (error) { showToast(error.message); }
}
async function disableTeamMember(userId) {
  if (!isOwner() || !hasPermission('team.manage')) return showToast('إدارة حالة الحساب متاحة لمالك النظام فقط.');
  const member = teamMembers.find(item => item.id === userId);
  if (!member || member.is_self || !confirm(`إيقاف دخول ${member.full_name || member.email} إلى لوحة العيادة؟`)) return;
  try { const result = await callTeamAdmin('team.disable', { user_id:userId }); showToast(result.message || 'تم إيقاف الحساب.'); await refreshTeam(false); }
  catch (error) { showToast(error.message); }
}
function paymentFields(a) {
  const secretary = profile?.role === 'secretary';
  if (secretary) return '';
  const due = secretary ? '' : Number((a.amount_due ?? priceForType(a.request_type)) || 0);
  const paid = secretary ? '' : (a.amount_paid ?? '');
  const paymentMethod = secretary ? '' : (a.payment_method || '');
  const birthControl = hasPermission('births.record') && a.request_type === 'birth' ? `<label class="birth-check"><input id="clinicBirthRecorded" type="checkbox" ${a.clinic_birth_recorded ? 'checked' : ''}><span><b>تمت الولادة مع د. دعاء</b><small>يُضاف ذلك تلقائيًا إلى بطاقة المريضة.</small></span></label>` : '';
  const noteField = secretary ? '' : `<label class="field payment-note">ملاحظات أخرى على الدفع (اختياري)<textarea id="paymentNote" placeholder="مثال: باقي المبلغ في الزيارة القادمة">${escapeHtml(a.payment_note || '')}</textarea></label>`;
  const financeForm = financeWorkflowEnabled() ? `<div class="payment-grid"><label class="field">المبلغ المطلوب<input id="amountDue" type="number" min="0" step="0.01" value="${due}" ${secretary ? 'required' : ''}></label><label class="field">المبلغ المدفوع<input id="amountPaid" type="number" min="0" step="0.01" value="${paid}" placeholder="مثال: 300" required></label><label class="field">وسيلة الدفع<select id="paymentMethod" required><option value="">اختاري الوسيلة</option><option value="cash" ${paymentMethod === 'cash' ? 'selected' : ''}>نقدًا</option><option value="visa" ${paymentMethod === 'visa' ? 'selected' : ''}>فيزا</option><option value="instapay" ${paymentMethod === 'instapay' ? 'selected' : ''}>إنستا باي</option><option value="vodafone_cash" ${paymentMethod === 'vodafone_cash' ? 'selected' : ''}>فودافون كاش</option><option value="other" ${paymentMethod === 'other' ? 'selected' : ''}>أخرى</option></select></label></div>${secretary ? `<small class="muted">سجلي المبلغ والوسيلة عند إتمام الزيارة؛ بيانات الحسابات والتقارير غير متاحة لحساب السكرتارية.</small>` : `<div class="qr-payment-actions"><button type="button" data-action="show-qr" data-qr="instapay"><i class="fa-solid fa-qrcode"></i> QR إنستا باي</button><button type="button" data-action="show-qr" data-qr="vodafone"><i class="fa-solid fa-qrcode"></i> QR فودافون كاش</button></div>${noteField}`}` : `<p class="muted">نظام الحسابات مغلق من إعدادات الدكتورة؛ يمكن حفظ الزيارة الآن دون تسجيل مبلغ.</p>`;
  return `<section id="paymentBox" class="workflow-panel payment-box ${a.status === 'completed' ? '' : 'is-hidden'}"><div class="workflow-heading"><i class="fa-solid fa-wallet"></i><div><h3>الزيارة والدفع</h3><p>بعد اختيار «تمت الزيارة» فقط، سجلي المبلغ والوسيلة.</p></div></div>${financeForm}${birthControl}</section>${hasDoctorAccess() ? paymentAuditSection(a) : ''}`;
}
function contactFields(a) { return `<section id="contactBox" class="workflow-panel contact-box ${a.status === 'contacted' ? '' : 'is-hidden'}"><div class="workflow-heading"><i class="fa-solid fa-phone-volume"></i><div><h3>تم التواصل</h3><p>ضعي الوقت المتفق عليه فقط، واكتبي أي ملاحظة مهمة للمكالمة.</p></div></div><div class="schedule-grid"><label class="field">الساعة المتفق عليها<input id="requestedTime" type="time" value="${escapeHtml(a.requested_time || '')}" required></label><label class="field">ملاحظة الاتصال (اختيارية)<textarea id="contactNote" placeholder="مثال: أكدت الحضور ووصلت رسالة واتساب">${escapeHtml(a.contact_note || '')}</textarea></label></div><label class="waitlist-check"><input id="waitlist" type="checkbox" ${a.is_waitlist ? 'checked' : ''}><span><b>قائمة انتظار</b><small>تُستخدم فقط إذا لم يتأكد وجود مكان الآن.</small></span></label></section>`; }
function outcomeFields(a) { const visible = ['cancelled','no_show'].includes(a.status); return `<section id="outcomeBox" class="workflow-panel outcome-box ${visible ? '' : 'is-hidden'}"><div class="workflow-heading"><i class="fa-solid fa-clipboard-question"></i><div><h3>${a.status === 'no_show' ? 'سبب عدم الحضور' : 'سبب الإلغاء'}</h3><p>اختاري السبب حتى تتضح الصورة في ملخصات العيادة.</p></div></div><div class="schedule-grid"><label class="field">السبب<select id="outcomeReason"><option value="">اختاري السبب</option><option value="changed_mind" ${a.outcome_reason === 'changed_mind' ? 'selected' : ''}>اعتذرت / غيّرت رأيها</option><option value="no_response" ${a.outcome_reason === 'no_response' ? 'selected' : ''}>لم ترد</option><option value="emergency" ${a.outcome_reason === 'emergency' ? 'selected' : ''}>ظرف طارئ</option><option value="rescheduled_elsewhere" ${a.outcome_reason === 'rescheduled_elsewhere' ? 'selected' : ''}>حددت موعدًا آخر</option><option value="price" ${a.outcome_reason === 'price' ? 'selected' : ''}>لم يناسبها السعر</option><option value="other" ${a.outcome_reason === 'other' ? 'selected' : ''}>سبب آخر</option></select></label><label class="field">تفصيل إضافي (اختياري)<textarea id="outcomeNote" placeholder="مثال: ستتواصل لتحديد موعد آخر">${escapeHtml(a.outcome_note || '')}</textarea></label></div></section>`; }
function workflowFields(a) { return `${contactFields(a)}${paymentFields(a)}${outcomeFields(a)}<section id="generalBox" class="workflow-panel general-box ${['contacted','completed','cancelled','no_show'].includes(a.status) ? 'is-hidden' : ''}"><div class="workflow-heading"><i class="fa-solid fa-clipboard"></i><div><h3>متابعة الطلب</h3><p>اكتبي ملاحظة داخلية مختصرة عند الحاجة.</p></div></div><label class="field">ملاحظة داخلية للعيادة<textarea id="staffNote" placeholder="مثال: تُفضل الحجز بعد الساعة 6 مساءً">${escapeHtml(a.staff_note || '')}</textarea></label></section>`; }
function paymentAuditSection(a) { const rows = auditForAppointment(a.id); if (!rows.length) return ''; return `<section class="payment-audit"><h3><i class="fa-solid fa-shield-heart"></i> سجل تعديلات الدفع</h3>${rows.map(row => `<article><div><b>${escapeHtml(row.changed_by_name || 'موظف العيادة')}</b><small>${new Date(row.changed_at).toLocaleString('ar-EG')}</small></div><span>المطلوب: ${money(row.old_amount_due)} ← ${money(row.new_amount_due)} · المدفوع: ${money(row.old_amount_paid)} ← ${money(row.new_amount_paid)} · ${paymentMethodText(row.old_payment_method)} ← ${paymentMethodText(row.new_payment_method)}${row.new_payment_note ? ` · ${escapeHtml(row.new_payment_note)}` : ''}</span></article>`).join('')}</section>`; }
function whatsappTemplates(a) { const when = `${a.requested_date ? ` يوم ${formatDate(a.requested_date, true)}` : ''}${a.requested_time ? ` الساعة ${formatTime(a.requested_time)}` : ''}`; const name = a.patients?.full_name || 'حضرتك'; return [{ key:'confirm', title:'تأكيد الموعد', text:`أهلًا ${name}، نؤكد موعدك في عيادة د. دعاء شعبان${when}. من فضلكِ أكدي حضورك بالرد على الرسالة.` }, { key:'reminder', title:'تذكير بالموعد', text:`تذكير لطيف يا ${name} بموعدك في عيادة د. دعاء شعبان${when}. ننتظركِ بكل ترحاب.` }, { key:'reschedule', title:'تعديل الموعد', text:`أهلًا ${name}، بخصوص موعدك في عيادة د. دعاء شعبان${when}، من فضلكِ تواصلي معنا لتأكيد أو تعديل الموعد المناسب.` }, { key:'followup', title:'متابعة بعد الغياب', text:`أهلًا ${name}، افتقدناكِ في موعدك بعيادة د. دعاء شعبان. إذا رغبتِ في تحديد موعد جديد، يسعدنا مساعدتك.` }, { key:'general', title:'رسالة عامة', text:`أهلًا ${name}، معكِ عيادة د. دعاء شعبان. يسعدنا الرد على استفسارك ومساعدتك.` }]; }
function whatsappTemplateModal(a) { if (!a) return ''; const choices = whatsappTemplates(a); return `<div class="modal whatsapp-modal" id="modal"><section class="modal-card"><div class="modal-head"><div><h2>اختاري رسالة واتساب</h2><p>لن تُرسل الرسالة تلقائيًا؛ سيفتح واتساب بالرسالة المختارة لتراجعيها قبل الإرسال.</p></div><button class="ghost-btn" data-action="close-modal">إغلاق</button></div><div class="whatsapp-templates">${choices.map(item => `<button data-action="send-whatsapp" data-id="${Number(a.id)}" data-template="${item.key}"><b><i class="fa-brands fa-whatsapp"></i> ${item.title}</b><span>${escapeHtml(item.text)}</span></button>`).join('')}</div></section></div>`; }
function sendWhatsAppTemplate(id, key) { const appointment = appointmentById(id); if (!appointment) return showToast('تعذر العثور على بيانات المريضة.'); const template = whatsappTemplates(appointment).find(item => item.key === key); if (!template) return; const phone = safePhone(appointment.patients?.phone).replace(/^0/, '20'); document.getElementById('modal')?.remove(); window.open(`https://wa.me/${phone}?text=${encodeURIComponent(template.text)}`, '_blank', 'noopener'); }

function detailsModal(a) {
  if (!a) return ''; const events = (a.appointment_events || []).sort((x,y) => new Date(y.created_at) - new Date(x.created_at)); const attachment = attachmentData(a); const isImage = safeAttachmentType(a.attachment_type).startsWith('image/');
  const attachmentHtml = !hasPermission('attachments.view') && a.attachment_name ? `<div class="no-attachment"><i class="fa-solid fa-lock"></i> عرض المرفقات غير متاح لهذا الحساب.</div>` : attachment ? `<section class="attachment-view"><div class="attachment-title"><b><i class="fa-solid fa-paperclip"></i> مرفق المريضة</b><small>${escapeHtml(a.attachment_name || 'ملف مرفق')}</small><a href="${attachment}" target="_blank" rel="noopener" class="ghost-btn">فتح بحجم كامل</a></div>${isImage ? `<img src="${attachment}" alt="مرفق المريضة">` : `<iframe src="${attachment}" title="مرفق المريضة"></iframe>`}</section>` : a.attachment_name ? `<div class="no-attachment" data-attachment-for="${Number(a.id)}"><i class="fa-solid fa-paperclip"></i> جاري تحميل المرفق بأمان…</div>` : `<div class="no-attachment"><i class="fa-solid fa-paperclip"></i> لم تُرفق المريضة روشتة أو تحليلًا.</div>`;
  const vipBadge = a.patient_id ? patientBadges(a.patient_id) : '';
  return `<div class="modal" id="modal"><section class="modal-card"><div class="modal-head"><div><h2>بيانات طلب الحجز</h2><p>${escapeHtml(a.booking_code || 'طلب من الموقع')} · سُجل ${new Date(a.created_at).toLocaleString('ar-EG')}</p></div><button class="ghost-btn" data-action="close-modal">إغلاق</button></div><div class="patient-data"><div class="data-box"><span>اسم المريضة</span><b>${escapeHtml(a.patients?.full_name || '-')}${vipBadge}</b></div><div class="data-box"><span>رقم الهاتف</span><b dir="ltr">${escapeHtml(safePhone(a.patients?.phone))}</b></div><div class="data-box"><span>نوع الطلب</span><b>${escapeHtml(typeText(a.request_type))}</b></div><div class="data-box"><span>الموعد المطلوب</span><b>${escapeHtml(requestDate(a))}</b></div>${a.last_visit_date ? `<div class="data-box"><span>آخر زيارة</span><b>${formatDate(a.last_visit_date)}</b></div>` : ''}</div><div class="contact-actions"><a href="tel:${safePhone(a.patients?.phone)}" class="primary-btn"><i class="fa-solid fa-phone"></i> اتصال بالمريضة</a><button class="whatsapp-btn" data-action="whatsapp" data-id="${Number(a.id)}"><i class="fa-brands fa-whatsapp"></i> اختيار رسالة واتساب</button></div>${a.message ? `<section class="message-box"><b><i class="fa-solid fa-message"></i> رسالة المريضة</b><p>${escapeHtml(a.message)}</p></section>` : ''}${attachmentHtml}<section class="update-box"><h3>تحديث حالة الطلب</h3><div class="status-steps">${appointmentStatusEntries(a).map(([key,label]) => `<button class="status-choice ${a.status === key ? 'selected' : ''}" data-action="quick-status" data-id="${Number(a.id)}" data-status="${key}"><i class="fa-solid ${statusIcons[key]}"></i>${label}</button>`).join('')}</div>${paymentFields(a)}<label class="field">ملاحظة داخلية للعيادة<textarea id="staffNote" placeholder="مثال: تم التواصل وحددنا الساعة 6 مساءً">${escapeHtml(a.staff_note || '')}</textarea></label><button class="primary-btn" data-action="save-appointment" data-id="${Number(a.id)}">حفظ التحديث</button></section><section class="history"><h3>سجل الطلب</h3>${events.length ? events.map(event => `<div class="event"><b>${event.event_type === 'created' ? 'تم استلام الطلب' : 'تم التحديث'}</b><span>${escapeHtml(eventSummary(event))}</span><small>${new Date(event.created_at).toLocaleString('ar-EG')}</small></div>`).join('') : '<p class="muted">لا يوجد سجل بعد.</p>'}</section></section></div>`;
}

async function openAppointmentDetails(appointment) {
  if (!appointment) return;
  if (profile?.role === 'secretary' && appointment.status === 'completed') {
    const { data, error } = await supabase.rpc('staff_payment_available', { p_appointment_id:appointment.id });
    appointment.staffPaymentAvailable = !error && data === true;
    appointment.staffPaymentCheckFailed = Boolean(error);
  }
  app.insertAdjacentHTML('beforeend', detailsModal(appointment));
  mountWorkflow(document.getElementById('modal'), appointment.status, appointment);
  decorateDetailsHeader(document.getElementById('modal'), appointment);
  if (!hasPermission('attachments.view') || !appointment.attachment_name || appointment.attachment_base64) return;
  let attachment = null;
  let attachmentError = null;
  const result = await supabase.rpc('doctor_appointment_attachment', { p_appointment_id: appointment.id });
  attachment = Array.isArray(result.data) ? result.data[0] : result.data;
  attachmentError = result.error;
  const placeholder = document.querySelector(`[data-attachment-for="${Number(appointment.id)}"]`);
  if (!placeholder) return;
  if (attachmentError || !attachment?.attachment_base64) {
    placeholder.textContent = 'تعذر تحميل المرفق من قاعدة البيانات. حاولي فتح الطلب مرة أخرى.';
    return;
  }
  appointment.attachment_base64 = attachment.attachment_base64;
  appointment.attachment_type = attachment.attachment_type;
  const currentModal = document.getElementById('modal');
  if (!currentModal) return;
  currentModal.outerHTML = detailsModal(appointment);
  mountWorkflow(document.getElementById('modal'), appointment.status, appointment);
  decorateDetailsHeader(document.getElementById('modal'), appointment);
}
function patientModal(id) { const patient = patientList().find(p => p.id === id); if (!patient) return ''; const visits = appointments.filter(a => a.patient_id === id); const completed = visits.filter(a => a.status === 'completed'); const isVip = completed.length >= 5; const vipBadge = isVip ? ` <em class="vip-badge"><i class="fa-solid fa-crown"></i> عضوة مميزة</em>` : ''; const lastVisit = lastCompletedVisit(id); const next = futureVisits(id)[0]; const days = overdueDays(id); const note = privateNoteOf(patient); return `<div class="modal" id="modal"><section class="modal-card patient-modal"><div class="modal-head"><div><h2>ملف المريضة</h2><p>بيانات ومتابعة وحجز جديد من مكان واحد</p></div><button class="ghost-btn" data-action="close-modal">إغلاق</button></div><div class="patient-profile ${isVip ? 'patient-vip-card' : ''}"><span class="patient-avatar">${escapeHtml(patient.full_name?.trim().charAt(0) || 'م')}</span><div><b>${escapeHtml(patient.full_name)}${vipBadge}</b><small dir="ltr">${escapeHtml(safePhone(patient.phone))}</small><small>${completed.length} زيارة مكتملة · ${lastVisit ? `آخر زيارة ${formatDate(lastVisit.requested_date)}` : 'لا توجد زيارة مكتملة'}</small></div><a href="tel:${safePhone(patient.phone)}" class="icon-action call"><i class="fa-solid fa-phone"></i> اتصال</a><button class="icon-action whatsapp" data-action="whatsapp" data-id="${next?.id || visits[0]?.id || ''}"><i class="fa-brands fa-whatsapp"></i> واتساب</button></div><div class="patient-summary"><div><span>آخر زيارة</span><b>${lastVisit ? formatDate(lastVisit.requested_date, true) : '—'}</b></div><div><span>الموعد القادم</span><b>${next ? formatDate(next.requested_date, true) : 'لا يوجد'}</b></div><div><span>حالة المتابعة</span><b>${days >= 30 && !next ? `متأخرة ${days} يومًا` : 'منتظمة'}</b></div></div>${hasPermission('patients.private_notes') ? `<section class="private-note"><label class="field">ملاحظة سرية للعيادة فقط<textarea id="privateNote" placeholder="هذه الملاحظة لا تظهر للمريضة نهائيًا">${escapeHtml(note)}</textarea></label><button class="ghost-btn" data-action="save-private-note" data-patient="${id}">حفظ الملاحظة</button></section>` : ''}<section class="new-booking"><h3><i class="fa-solid fa-calendar-plus"></i> حجز جديد لنفس المريضة</h3><p>الاسم ورقم الهاتف محفوظان تلقائيًا.</p><div class="booking-fields"><label class="field">نوع الحجز<select id="manualType"><option value="follow">كشف متابعة</option><option value="first">كشف أول مرة</option><option value="consult">استشارة متابعة</option><option value="aesthetic">تجميل نسائي</option><option value="birth">حجز ولادة</option><option value="labs">تحاليل أو أشعة</option></select></label><label class="field">التاريخ المطلوب<input id="manualDate" type="date" min="${selectedDate}" value="${nextDate()}"></label><label class="field">وقت الموعد<input id="manualTime" type="time"></label><label class="waitlist-check"><input id="manualWaitlist" type="checkbox"><span><b>قائمة انتظار</b><small>لا يوجد وقت ثابت حتى الآن.</small></span></label></div><label class="field">ملاحظة الحجز<textarea id="manualMessage" placeholder="اختياري: وقت مناسب أو ملاحظة للعيادة"></textarea></label><button class="primary-btn" data-action="manual-booking" data-patient="${id}"><i class="fa-solid fa-plus"></i> تسجيل الحجز</button></section><section class="history patient-history"><h3>كل الزيارات والحجوزات</h3><div class="appointment-grid compact">${visits.length ? visits.map(requestCard).join('') : emptyState('fa-calendar-xmark','لا توجد حجوزات بعد.')}</div></section></section></div>`; }

function bindEvents() {
  app.onclick = async event => { const target = event.target.closest('[data-action],[data-view]'); if (!target) return;
    if (target.dataset.action === 'toggle-mobile-menu') { const shell = app.querySelector('.app-shell'); const opened = shell?.classList.toggle('mobile-menu-open'); app.querySelector('.mobile-menu-toggle')?.setAttribute('aria-expanded', String(Boolean(opened))); return; }
    if (target.dataset.action === 'close-mobile-menu') { app.querySelector('.app-shell')?.classList.remove('mobile-menu-open'); app.querySelector('.mobile-menu-toggle')?.setAttribute('aria-expanded','false'); return; }
    if (target.dataset.view) { app.querySelector('.app-shell')?.classList.remove('mobile-menu-open'); activeView = target.dataset.view; renderApp(); if (activeView === 'team') void refreshTeam(); return; }
    if (target.dataset.action === 'logout') { clearInterval(reminderTimer); await supabase.auth.signOut(); session = null; return renderLogin(); }
    if (target.dataset.action === 'backup') return downloadBackup();
    if (target.dataset.action === 'details') return openAppointmentDetails(appointmentById(target.dataset.id));
    if (target.dataset.action === 'whatsapp') { app.insertAdjacentHTML('beforeend', whatsappTemplateModal(appointmentById(target.dataset.id))); return; }
    if (target.dataset.action === 'send-whatsapp') return sendWhatsAppTemplate(Number(target.dataset.id), target.dataset.template);
    if (target.dataset.action === 'patient') { app.insertAdjacentHTML('beforeend', patientModal(target.dataset.patient)); return; }
    if (target.dataset.action === 'close-modal') { document.getElementById('modal')?.remove(); return; }
    if (target.dataset.action === 'close-qr') { document.getElementById('qrModal')?.remove(); return; }
    if (target.dataset.action === 'toast-dismiss') { document.getElementById('toast')?.classList.remove('show'); return; }
    if (target.dataset.action === 'team-refresh') return refreshTeam();
    if (target.dataset.action === 'team-save-role') return changeTeamRole(target.dataset.user);
    if (target.dataset.action === 'team-disable') return disableTeamMember(target.dataset.user);
    if (target.dataset.action === 'team-save-permissions') return saveTeamPermissions(target.dataset.user);
    if (target.dataset.action === 'team-reset-permissions') return saveTeamPermissions(target.dataset.user, true);
    if (target.dataset.action === 'permission-profile-save') return savePermissionProfile(target.dataset.user);
    if (target.dataset.action === 'permission-profile-delete') return deletePermissionProfile(target.dataset.profile);
    if (target.dataset.action === 'go-pending') { activeView = 'appointments'; appointmentPreset = 'new'; renderApp(); applyPreset(); return; }
    if (target.dataset.action === 'preset') { activeView = 'appointments'; appointmentPreset = target.dataset.preset; renderApp(); applyPreset(); return; }
    if (target.dataset.action === 'show-overdue') { activeView = 'alerts'; renderApp(); return; }
    if (target.dataset.action === 'go-alerts') { activeView = 'alerts'; renderApp(); return; }
    if (target.dataset.action === 'calendar-day') { selectedDate = target.dataset.date; return renderView(); }
    if (target.dataset.action === 'resolve-alert') return resolveAlert(Number(target.dataset.id));
    if (target.dataset.action === 'resolve-all-alerts') return resolveAllAlerts();
    if (target.dataset.action === 'save-private-note') return savePrivateNote(target.dataset.patient);
    if (target.dataset.action === 'manual-booking') return createManualBooking(target.dataset.patient);
    if (target.dataset.action === 'reminder-open') { document.getElementById('smartReminder')?.remove(); return openAppointmentDetails(appointmentById(target.dataset.id)); }
    if (target.dataset.action === 'reminder-snooze') { reminderSnoozes[target.dataset.id] = Date.now() + 60000; document.getElementById('smartReminder')?.remove(); return; }
    if (target.dataset.action === 'clear-filters') { appointmentPreset = ''; document.getElementById('searchAppointments').value = ''; document.getElementById('statusFilter').value = ''; document.getElementById('paymentFilter') && (document.getElementById('paymentFilter').value = ''); document.getElementById('filterDate').value = ''; filterAppointments(); return; }
    if (target.dataset.action === 'filter-daily-payment') { dailyPaymentFilter = target.dataset.method || ''; return renderView(); }
    if (target.dataset.action === 'show-qr') { app.insertAdjacentHTML('beforeend', qrModal(target.dataset.qr)); return; }
    if (target.dataset.action === 'select-payment') { const modal = document.getElementById('modal'); const appointment = appointmentById(target.dataset.id); return mountWorkflow(modal, 'completed', appointment, target.dataset.method); }
    if (target.dataset.action === 'quick-status') { const modal = document.getElementById('modal'); const appointment = appointmentById(target.dataset.id); modal.querySelectorAll('.status-choice').forEach(button => button.classList.toggle('selected', button === target)); modal.dataset.pendingStatus = target.dataset.status; mountWorkflow(modal, target.dataset.status, appointment); return; }
    if (target.dataset.action === 'save-appointment') await saveAppointmentForWorkflow(Number(target.dataset.id));
    if (target.dataset.action === 'save-secretary-payment') await saveSecretaryPayment(Number(target.dataset.id));
    if (target.dataset.action === 'doctor-close-without-payment') await doctorCloseVisitWithoutPayment(Number(target.dataset.id));
  };
  app.oninput = event => { if (event.target.id === 'searchAppointments') { filterAppointments(); decorateViewCards(); } if (event.target.id === 'searchPatients') { filterPatients(event.target.value); decorateViewCards(); } };
  app.onchange = event => {
    const input = event.target;
    if (input.matches('[data-permission-all]')) {
      const userId = input.dataset.user;
      const profileSelect = app.querySelector(`[data-permission-profile="${CSS.escape(userId)}"]`);
      if (profileSelect) profileSelect.value = '';
      app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]`).forEach(item => { item.checked = input.checked; });
      updatePermissionSelectAll(userId);
      return;
    }
    if (input.matches('[data-permission-group]')) {
      const userId = input.dataset.user;
      const profileSelect = app.querySelector(`[data-permission-profile="${CSS.escape(userId)}"]`);
      if (profileSelect) profileSelect.value = '';
      const keys = new Set(PERMISSION_GROUPS.find(group => group.id === input.dataset.permissionGroup)?.items.map(([key]) => key) || []);
      const selected = new Set([...app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]:checked`)].map(item => item.dataset.permission));
      keys.forEach(key => input.checked ? selected.add(key) : selected.delete(key));
      const normalized = input.checked ? new Set(withPermissionDependencies([...selected])) : removeInvalidPermissionDependents(selected);
      app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]`).forEach(item => { item.checked = normalized.has(item.dataset.permission); });
      updatePermissionSelectAll(userId);
      return;
    }
    if (input.matches('[data-permission]')) {
      const userId = input.dataset.user;
      const profileSelect = app.querySelector(`[data-permission-profile="${CSS.escape(userId)}"]`);
      if (profileSelect) profileSelect.value = '';
      const selected = new Set([...app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]:checked`)].map(item => item.dataset.permission));
      const normalized = input.checked ? new Set(withPermissionDependencies([...selected])) : removeInvalidPermissionDependents(selected);
      app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]`).forEach(item => { item.checked = normalized.has(item.dataset.permission); });
      updatePermissionSelectAll(userId);
      return;
    }
    if (input.matches('[data-permission-profile]')) { applyPermissionProfile(input.dataset.user, input.value); return; }
    if (input.id === 'dayPicker' || input.id === 'closingDate') { selectedDate = input.value; dailyPaymentFilter = ''; if (hasPermission('closing.view')) loadClosingSnapshot(selectedDate).then(renderView).catch(error => showToast(`تعذر تحميل تقفيل اليوم: ${error.message}`)); else renderView(); }
    if (input.id === 'calendarMonth') { calendarMonth = input.value; renderView(); }
    if (input.id === 'reportMonth') { reportMonth = input.value; renderView(); }
    if (input.id === 'financeMonth') { financeMonth = input.value; renderView(); }
    if (input.id === 'patientSort') { patientSort = input.value; filterPatients(document.getElementById('searchPatients')?.value); decorateViewCards(); }
    if (input.id === 'statusFilter' || input.id === 'paymentFilter' || input.id === 'filterDate') { filterAppointments(); decorateViewCards(); }
  };
  document.getElementById('settingsForm')?.addEventListener('submit', saveSettings);
  document.getElementById('expenseForm')?.addEventListener('submit', saveExpense);
  app.onsubmit = event => { if (event.target?.id === 'teamInviteForm') submitTeamInvite(event); };
}
function updatePermissionSelectAll(userId) { const boxes = [...app.querySelectorAll(`[data-permission][data-user="${CSS.escape(userId)}"]`)]; const all = app.querySelector(`[data-permission-all][data-user="${CSS.escape(userId)}"]`); if (all) all.checked = boxes.length > 0 && boxes.every(box => box.checked); for (const group of PERMISSION_GROUPS) { const groupKeys = new Set(group.items.map(([key]) => key)); const groupBoxes = boxes.filter(box => groupKeys.has(box.dataset.permission)); const select = app.querySelector(`[data-permission-group="${group.id}"][data-user="${CSS.escape(userId)}"]`); if (select) select.checked = groupBoxes.length > 0 && groupBoxes.every(box => box.checked); } }
function removeInvalidPermissionDependents(selectedPermissions) {
  const selected = new Set(selectedPermissions);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [permission, requirements] of Object.entries(PERMISSION_DEPENDENCIES)) {
      if (selected.has(permission) && requirements.some(required => !selected.has(required))) {
        selected.delete(permission);
        changed = true;
      }
    }
  }
  return selected;
}
function applyPreset() { const status = document.getElementById('statusFilter'), date = document.getElementById('filterDate'); if (!status || !date) return; if (appointmentPreset === 'today') date.value = selectedDate; else if (appointmentPreset === 'tomorrow') date.value = nextDate(); else if (appointmentPreset === 'follow') status.value = 'follow_up'; else if (appointmentPreset && appointmentPreset !== 'unpaid') status.value = appointmentPreset; filterAppointments(); }
function filterAppointments() { const query = normalize(document.getElementById('searchAppointments')?.value); const status = document.getElementById('statusFilter')?.value || ''; const payment = document.getElementById('paymentFilter')?.value || ''; const date = document.getElementById('filterDate')?.value || ''; const matches = appointments.filter(a => { const name = normalize(a.patients?.full_name); const phone = safePhone(a.patients?.phone); const matchQuery = !query || name.includes(query) || phone.includes(query) || lastFour(phone) === query || String(a.booking_code || '').toLowerCase().includes(query); const matchStatus = !status || a.status === status || (appointmentPreset === 'follow' && followUpNeeded(a)); return matchQuery && matchStatus && (appointmentPreset !== 'unpaid' || paymentIncomplete(a)) && (!payment || a.payment_method === payment) && (!date || a.requested_date === date); }); document.getElementById('appointmentsList').innerHTML = matches.length ? matches.map(requestCard).join('') : emptyState('fa-magnifying-glass', 'لا توجد طلبات مطابقة للبحث.'); }
function sortPatients(people) { return [...people].sort((a,b) => { const aLast = lastCompletedVisit(a.id)?.requested_date || ''; const bLast = lastCompletedVisit(b.id)?.requested_date || ''; if (patientSort === 'newest') return String(b.created_at || '').localeCompare(String(a.created_at || '')); if (patientSort === 'oldest') return String(a.created_at || '').localeCompare(String(b.created_at || '')); if (patientSort === 'last_visit') return bLast.localeCompare(aLast); if (patientSort === 'overdue') return overdueDays(b.id) - overdueDays(a.id); if (patientSort === 'vip') return completedVisits(b.id) - completedVisits(a.id); if (patientSort === 'births') return birthCount(b.id) - birthCount(a.id); return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar'); }); }
function filterPatients(query) { const q = normalize(query); const people = sortPatients(patientList().filter(p => !q || normalize(p.full_name).includes(q) || safePhone(p.phone).includes(q) || lastFour(p.phone) === q)); document.getElementById('patientsList').innerHTML = people.length ? people.map(patientCard).join('') : emptyState('fa-magnifying-glass', 'لا توجد مريضة مطابقة للبحث.'); }
function appointmentStatusEntries(a) { return Object.entries(statusLabels).filter(([key]) => { if (key === 'completed') return hasPermission('visits.close') || (a.status === 'completed' && a.staffPaymentAvailable && hasPermission('payments.record')); if (['cancelled','no_show'].includes(key)) return hasPermission('visits.close'); return hasPermission('appointments.manage'); }); }
function togglePaymentForCompleted(modal, status) { const box = modal?.querySelector('#paymentBox'); if (box) box.classList.toggle('is-hidden', status !== 'completed'); }
function toggleOutcomeForStatus(modal, status) { const box = modal?.querySelector('#outcomeBox'); if (box) box.classList.toggle('is-hidden', !['cancelled','no_show'].includes(status)); }
function syncWorkflowPanels(modal, status, appointment) { if (!modal || !appointment) return; const box = modal.querySelector('.update-box'); const payment = modal.querySelector('#paymentBox'); if (!modal.querySelector('#contactBox')) payment?.insertAdjacentHTML('beforebegin', contactFields(appointment)); if (!modal.querySelector('#outcomeBox')) payment?.insertAdjacentHTML('afterend', outcomeFields({ ...appointment, status })); const contact = modal.querySelector('#contactBox'); const outcome = modal.querySelector('#outcomeBox'); contact?.classList.toggle('is-hidden', status !== 'contacted'); payment?.classList.toggle('is-hidden', status !== 'completed'); outcome?.classList.toggle('is-hidden', !['cancelled','no_show'].includes(status)); const generic = modal.querySelector('#staffNote')?.closest('label'); if (generic) generic.classList.toggle('is-hidden', ['contacted','completed','cancelled','no_show'].includes(status)); box?.classList.toggle('visit-mode', status === 'completed'); }
function decorateDetailsHeader(modal, appointment) { if (!modal || !appointment?.patient_id || modal.querySelector('.patient-rank-ribbon')) return; modal.querySelectorAll('.patient-data .vip-badge,.patient-data .visit-badge,.patient-data .birth-badge').forEach(node => node.remove()); const visits = completedVisits(appointment.patient_id); const vip = isVipPatient(appointment.patient_id); const births = birthCount(appointment.patient_id); const ribbon = `<aside class="patient-rank-ribbon ${vip ? 'is-vip' : ''}"><div class="rank-medallion"><i class="fa-solid ${vip ? 'fa-crown' : 'fa-heart-pulse'}"></i></div><div><b>${vip ? 'عضوة مميزة في عائلة العيادة' : 'عضوة من عائلة العيادة'}</b><span>${visits} زيارة مكتملة${births ? ` · ولدت معنا ×${births}` : ''}</span></div></aside>`; modal.querySelector('.patient-data')?.insertAdjacentHTML('beforebegin', ribbon); }
function workflowForStatus(a, status, method = '') { const time = escapeHtml(a.requested_time || ''); const date = escapeHtml(a.requested_date || selectedDate); const note = escapeHtml(a.contact_note || a.staff_note || ''); const title = statusLabels[status] || 'تحديث الطلب'; if (status === 'contacted') return `<section class="workflow-panel contact-box"><div class="workflow-heading"><i class="fa-solid fa-phone-volume"></i><div><h3>تم التواصل</h3><p>سجلي الساعة المتفق عليها وأي ملاحظة للمكالمة، ثم احفظي فقط.</p></div></div><div class="schedule-grid"><label class="field">الساعة المتفق عليها<input id="requestedTime" type="time" value="${time}" required></label><label class="field">ملاحظة الاتصال (اختيارية)<textarea id="contactNote">${note}</textarea></label></div></section>`;
  if (status === 'confirmed') return `<section class="workflow-panel confirm-box"><div class="workflow-heading"><i class="fa-solid fa-circle-check"></i><div><h3>تأكيد الموعد</h3><p>راجعي الساعة النهائية التي أكدت بها المريضة ثم احفظي التأكيد.</p></div></div><div class="schedule-grid"><label class="field">وقت الموعد المؤكد<input id="requestedTime" type="time" value="${time}" required></label><label class="field">ملاحظة التأكيد (اختيارية)<textarea id="contactNote">${note}</textarea></label></div></section>`;
  if (['follow_up','rescheduled'].includes(status)) return `<section class="workflow-panel reschedule-box"><div class="workflow-heading"><i class="fa-solid ${status === 'rescheduled' ? 'fa-clock-rotate-left' : 'fa-rotate'}"></i><div><h3>${status === 'rescheduled' ? 'تأجيل الموعد' : 'متابعة لاحقة'}</h3><p>اختاري التاريخ والساعة الجديدة، ثم اكتبي سببًا مختصرًا إن لزم.</p></div></div><div class="schedule-grid"><label class="field">التاريخ الجديد<input id="workflowDate" type="date" value="${date}" required></label><label class="field">الساعة الجديدة<input id="requestedTime" type="time" value="${time}" required></label></div><label class="field">ملاحظة (اختيارية)<textarea id="staffNote">${escapeHtml(a.staff_note || '')}</textarea></label></section>`;
  if (status === 'completed' && a.status === 'completed' && a.staffPaymentAvailable && hasPermission('payments.record')) {
    const statusMessage = 'الزيارة مغلقة؛ سجلي بيانات الدفع فقط.';
    if (!a.staffPaymentAvailable) return `<section class="workflow-panel payment-box"><div class="workflow-heading"><i class="fa-solid ${a.staffPaymentCheckFailed ? 'fa-lock' : 'fa-wallet'}"></i><div><h3>${a.staffPaymentCheckFailed ? 'تعذر التحقق من الدفع' : 'تسجيل الدفع'}</h3><p>${statusMessage}</p></div></div></section>`;
    const methods = [['cash','نقدًا'],['visa','فيزا'],['instapay','إنستا باي'],['vodafone_cash','فودافون كاش'],['other','أخرى']];
    return `<section class="workflow-panel payment-box"><div class="workflow-heading"><i class="fa-solid fa-wallet"></i><div><h3>تسجيل الدفع فقط</h3><p>${statusMessage}</p></div></div><div class="payment-grid"><label class="field">المبلغ المطلوب<input id="amountDue" type="number" min="0" step="0.01" required></label><label class="field">المبلغ المدفوع<input id="amountPaid" type="number" min="0" step="0.01" required></label><label class="field">وسيلة الدفع<select id="paymentMethod" required><option value="">اختاري الوسيلة</option>${methods.map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div></section>`;
  }
  if (status === 'completed') {
    if (profile?.role === 'secretary' && staffFinanceEnabled === null) return `<section class="workflow-panel payment-box"><div class="workflow-heading"><i class="fa-solid fa-lock"></i><div><h3>تعذر التحقق من الحسابات</h3><p>أعيدي تحميل الصفحة قبل إنهاء الزيارة.</p></div></div></section>`;
    const selected = method || a.payment_method || '';
    const methods = [['cash','نقدًا','fa-money-bill-wave'],['visa','فيزا','fa-credit-card'],['instapay','إنستا باي','fa-mobile-screen-button'],['vodafone_cash','فودافون كاش','fa-wallet']];
    const secretary = profile?.role === 'secretary';
    const due = secretary ? '' : Number((a.amount_due ?? priceForType(a.request_type)) || 0);
    const paymentForm = selected ? `<input id="paymentMethod" type="hidden" value="${selected}"><div class="payment-grid"><label class="field">المبلغ المطلوب<input id="amountDue" type="number" min="0" step="0.01" value="${due}" ${secretary ? 'required' : ''}></label><label class="field">المبلغ المدفوع<input id="amountPaid" type="number" min="0" step="0.01" value="${secretary ? '' : (a.amount_paid ?? '')}" placeholder="مثال: 300" required></label></div>${['instapay','vodafone_cash'].includes(selected) ? `<div class="qr-payment-actions"><button type="button" data-action="show-qr" data-qr="${selected === 'instapay' ? 'instapay' : 'vodafone'}"><i class="fa-solid fa-qrcode"></i> عرض QR ${paymentMethodText(selected)}</button><span>بعد التحويل اضغطي «تأكيد الدفع وحفظ الزيارة».</span></div>` : `<p class="payment-confirm-hint">راجعي المبلغ ثم اضغطي «تأكيد الدفع وحفظ الزيارة» لتسجيل ${paymentMethodText(selected)}.</p>`}${secretary ? '' : `<label class="field payment-note">ملاحظات أخرى (اختيارية)<textarea id="paymentNote">${escapeHtml(a.payment_note || '')}</textarea></label>`}` : `<p class="payment-choice-help">اختاري وسيلة الدفع أولًا لتظهر خطواتها.</p>`;
    return `<section class="workflow-panel payment-box"><div class="workflow-heading"><i class="fa-solid fa-wallet"></i><div><h3>الزيارة والدفع</h3><p>اختاري وسيلة الدفع التي تمت بها الزيارة.</p></div></div>${financeWorkflowEnabled() && hasPermission('payments.record') ? `<div class="payment-method-buttons">${methods.map(([key,label,icon]) => `<button type="button" data-action="select-payment" data-id="${Number(a.id)}" data-method="${key}" class="${selected === key ? 'active' : ''}"><i class="fa-solid ${icon}"></i>${label}</button>`).join('')}</div>${paymentForm}` : financeWorkflowEnabled() ? `<p class="muted">يمكن لهذا الحساب إغلاق الزيارة دون الاطلاع على تفاصيل الدفع.</p>` : `<p class="muted">الحسابات مغلقة من إعدادات العيادة، لذلك لا يلزم تسجيل مبلغ.</p>`}${hasPermission('births.record') && a.request_type === 'birth' ? `<label class="birth-check"><input id="clinicBirthRecorded" type="checkbox" ${a.clinic_birth_recorded ? 'checked' : ''}><span><b>تمت الولادة مع د. دعاء</b><small>ستظهر تلقائيًا على بطاقة المريضة.</small></span></label>` : ''}${!secretary ? paymentAuditSection(a) : ''}${hasPermission('visits.close') && financeWorkflowEnabled() && !hasPermission('payments.record') ? `<button type="button" class="ghost-btn" data-action="doctor-close-without-payment" data-id="${Number(a.id)}">إغلاق الزيارة وتأجيل تسجيل الدفع</button>` : ''}</section>`;
  }
  if (['cancelled','no_show'].includes(status)) return outcomeFields({ ...a, status });
  return `<section class="workflow-panel workflow-empty"><div class="workflow-heading"><i class="fa-solid fa-hand-pointer"></i><div><h3>${title}</h3><p>اختاري الإجراء المناسب من الأزرار بالأعلى؛ ستظهر خاناته هنا وحدها.</p></div></div></section>`; }
function mountWorkflow(modal, status, appointment, method = '') { if (!modal || !appointment) return; const box = modal.querySelector('.update-box'); if (!box) return; box.querySelectorAll('#contactBox,#paymentBox,#outcomeBox,.payment-audit,.workflow-host').forEach(node => node.remove()); modal.querySelector('#staffNote')?.closest('label')?.remove(); const save = box.querySelector('[data-action="save-appointment"]'); const secretaryPayment = profile?.role === 'secretary' && status === 'completed' && appointment.status === 'completed' && appointment.staffPaymentAvailable; save?.insertAdjacentHTML('beforebegin', `<div class="workflow-host">${workflowForStatus(appointment, status, method)}</div>`); if (save) { save.dataset.action = secretaryPayment ? 'save-secretary-payment' : 'save-appointment'; save.textContent = secretaryPayment ? 'حفظ الدفع فقط' : status === 'completed' ? 'تأكيد الزيارة والدفع' : status === 'new' ? 'حفظ الحالة' : `حفظ: ${statusLabels[status]}`; save.classList.toggle('is-hidden', profile?.role === 'secretary' && status === 'completed' && appointment.status === 'completed' && !secretaryPayment); } }
function qrModal(kind) { const isInsta = kind === 'instapay'; const title = isInsta ? 'إنستا باي' : 'فودافون كاش'; const src = isInsta ? '../assets/payment-qr/instapay-qr.svg' : '../assets/payment-qr/vodafone-cash-qr.svg'; return `<div class="modal qr-modal" id="qrModal"><section class="modal-card qr-card"><div class="modal-head"><div><h2>الدفع عبر ${title}</h2><p>اعملي مسحًا للكود من هاتف المريضة لإتمام الدفع.</p></div><button class="ghost-btn" data-action="close-qr">إغلاق</button></div><img src="${src}" alt="QR ${title}"><p class="qr-help">يمكن استبدال هذه الصورة في مجلد <b>assets/payment-qr</b> بالكود الحقيقي للعيادة في أي وقت.</p><button class="primary-btn" data-action="close-qr">تم، متابعة التسجيل</button></section></div>`; }
async function archiveClosedCaseToSheet(id) { try { const result = await window.ClinicBridge.call('admin.archive.closed', { appointmentId:Number(id) }, session?.access_token || '', 'clinic-sheet-bridge'); return result?.status === 'success' && result?.syncStatus === 'synced'; } catch (_) { return false; } }
async function saveAppointmentForWorkflow(id) { const appointment = appointmentById(id); const modal = document.getElementById('modal'); if (!appointment || !modal) return; const status = modal.dataset.pendingStatus || appointment.status; const update = { status }; const staffNote = modal.querySelector('#staffNote')?.value.trim(); let eventNote = `تم تغيير الحالة إلى ${statusLabels[status]}.`;
  if (status === 'completed' || ['cancelled','no_show'].includes(status)) {
    if (!canCloseVisit()) return showToast('إغلاق الزيارة أو الحالة غير متاح لهذا الحساب.');
  } else if (!hasPermission('appointments.manage')) return showToast('تحديث الطلبات غير متاح لهذا الحساب.');
  if (['completed','cancelled','no_show'].includes(appointment.status) && status !== appointment.status) return showToast('لا يمكن إعادة فتح حالة مغلقة من هذا المسار.');
  if (status === 'contacted') { const time = modal.querySelector('#requestedTime')?.value || ''; if (!time) return showToast('اكتبي الساعة المتفق عليها مع المريضة أولًا.'); Object.assign(update, { requested_time:time, is_waitlist:Boolean(modal.querySelector('#waitlist')?.checked), contact_note:modal.querySelector('#contactNote')?.value.trim() || '' }); eventNote = `تم التواصل وحدد الموعد الساعة ${formatTime(time)}.${update.contact_note ? ` ملاحظة: ${update.contact_note}` : ''}`; }
  if (['cancelled','no_show'].includes(status)) { const reason = modal.querySelector('#outcomeReason')?.value || ''; if (!reason) return showToast('اختاري سبب الإلغاء أو عدم الحضور أولًا.'); Object.assign(update, { outcome_reason:reason, outcome_note:modal.querySelector('#outcomeNote')?.value.trim() || '' }); eventNote = `${status === 'no_show' ? 'لم تحضر المريضة' : 'أُلغي الحجز'}. السبب: ${outcomeReasonText(reason)}.${update.outcome_note ? ` ملاحظة: ${update.outcome_note}` : ''}`; }
  if (status === 'confirmed') { const time = modal.querySelector('#requestedTime')?.value || ''; if (!time) return showToast('حددي وقت الموعد المؤكد أولًا.'); Object.assign(update, { requested_time:time, contact_note:modal.querySelector('#contactNote')?.value.trim() || '' }); eventNote = `تم تأكيد الموعد الساعة ${formatTime(time)}.${update.contact_note ? ` ملاحظة: ${update.contact_note}` : ''}`; }
  if (['follow_up','rescheduled'].includes(status)) { const date = modal.querySelector('#workflowDate')?.value || ''; const time = modal.querySelector('#requestedTime')?.value || ''; if (!date || !time) return showToast('حددي التاريخ والساعة الجديدة أولًا.'); Object.assign(update, { requested_date:date, requested_time:time, staff_note:modal.querySelector('#staffNote')?.value.trim() || '' }); eventNote = `${status === 'rescheduled' ? 'تم تأجيل الموعد' : 'تمت جدولة متابعة لاحقة'} إلى ${formatDate(date, true)} الساعة ${formatTime(time)}.${update.staff_note ? ` ملاحظة: ${update.staff_note}` : ''}`; }
  if (status === 'completed') {
    if (profile?.role === 'secretary' && staffFinanceEnabled === null) return showToast('تعذر التأكد من إعدادات الحسابات. أعيدي تحميل الصفحة قبل إنهاء الزيارة.');
    const paidInput = modal.querySelector('#amountPaid');
    const dueInput = modal.querySelector('#amountDue');
    const amountPaid = paidInput?.value.trim();
    const method = modal.querySelector('#paymentMethod')?.value || '';
    if (financeWorkflowEnabled() && !canRecordPayment()) return showToast('يمكنك إغلاق الزيارة دون تسجيل الدفع؛ استخدمي زر تأجيل الدفع الظاهر في تفاصيل الزيارة.');
    if (financeWorkflowEnabled()) {
      if (!method || amountPaid === undefined || amountPaid === '' || (profile?.role === 'secretary' && (dueInput?.value.trim() === '' || dueInput?.value === undefined))) return showToast('اختاري وسيلة الدفع واكتبي المبلغ المطلوب والمدفوع ثم أكدي الزيارة.');
      const paid = Number(amountPaid);
      const due = Number(dueInput?.value || 0);
      if (!Number.isFinite(paid) || paid < 0 || !Number.isFinite(due) || due < 0) return showToast('راجعي المبالغ المدخلة.');
      const { error } = await supabase.rpc('record_appointment_completion', {
        p_appointment_id:id,
        p_amount_due:due,
        p_amount_paid:paid,
        p_payment_method:method,
        p_payment_note:hasDoctorAccess() ? (modal.querySelector('#paymentNote')?.value.trim() || '') : '',
        p_birth_recorded:hasPermission('births.record') && appointment.request_type === 'birth' && Boolean(modal.querySelector('#clinicBirthRecorded')?.checked)
      });
      if (error) return showToast(`تعذر حفظ الزيارة والدفع: ${error.message}`);
      const archived = await archiveClosedCaseToSheet(id);
      await loadData(); modal.remove(); renderApp(); showToast(archived ? 'تم حفظ الزيارة والدفع وأرشفة الحالة في الشيت.' : 'تم حفظ الزيارة والدفع في قاعدة الإدارة؛ أرشفة الشيت معلّقة وستُعاد تلقائيًا.');
      return;
    }
    if (hasPermission('births.record') && appointment.request_type === 'birth') update.clinic_birth_recorded = Boolean(modal.querySelector('#clinicBirthRecorded')?.checked);
    eventNote = 'تم تسجيل إتمام الزيارة.';
  }
  if (!['contacted','confirmed','completed','cancelled','no_show','follow_up','rescheduled'].includes(status)) { update.staff_note = staffNote || ''; if (staffNote) eventNote += ` ملاحظة: ${staffNote}`; }
  const workflowChanges = { ...update }; delete workflowChanges.status;
  const { error } = await supabase.rpc('record_appointment_workflow', {
    p_appointment_id:id,
    p_expected_status:appointment.status,
    p_new_status:status,
    p_changes:workflowChanges,
    p_event_note:eventNote
  });
  if (error) return showToast(`تعذر حفظ التحديث وسجل الحركة: ${error.message}`);
  const closesCase = ['completed','cancelled','no_show'].includes(status);
  const closedCaseArchived = closesCase ? await archiveClosedCaseToSheet(id) : null;
  const waitlisted = status === 'cancelled' ? appointments.filter(item => item.is_waitlist && item.requested_date === appointment.requested_date && activeBooking(item)).length : 0;
  await loadData(); modal.remove(); renderApp();
  const closedLabel = status === 'completed' ? 'الزيارة' : 'الحالة';
  showToast(closedCaseArchived === true ? (waitlisted ? `تم حفظ ${closedLabel} وأرشفتها في الشيت. يوجد ${waitlisted} في قائمة انتظار هذا اليوم.` : `تم حفظ ${closedLabel} وأرشفتها في الشيت.`) : closedCaseArchived === false ? 'تم حفظ الحالة في قاعدة الإدارة؛ أرشفة الشيت معلّقة وستُعاد تلقائيًا.' : (waitlisted ? `تم الحفظ. يوجد ${waitlisted} في قائمة انتظار هذا اليوم.` : 'تم حفظ التحديث بنجاح.'));
}
async function saveSecretaryPayment(id) {
  const appointment = appointmentById(id);
  const modal = document.getElementById('modal');
  if (!canRecordPayment() || profile?.role !== 'secretary' || !appointment || appointment.status !== 'completed' || !modal) return showToast('يمكن للسكرتارية تسجيل الدفع فقط بعد إغلاق الزيارة بواسطة الطبيبة.');
  const amountDue = modal.querySelector('#amountDue')?.value.trim();
  const amountPaid = modal.querySelector('#amountPaid')?.value.trim();
  const method = modal.querySelector('#paymentMethod')?.value || '';
  if (amountDue === undefined || amountDue === '' || amountPaid === undefined || amountPaid === '' || !method) return showToast('اكتبي المبلغين واختاري وسيلة الدفع.');
  const due = Number(amountDue), paid = Number(amountPaid);
  if (!Number.isFinite(due) || due < 0 || !Number.isFinite(paid) || paid < 0) return showToast('راجعي المبالغ المدخلة.');
  const { error } = await supabase.rpc('record_appointment_payment', { p_appointment_id:id, p_amount_due:due, p_amount_paid:paid, p_payment_method:method });
  if (error) return showToast(`تعذر تسجيل الدفع فقط: ${error.message}`);
  const archived = await archiveClosedCaseToSheet(id);
  await loadData(); modal.remove(); renderApp();
  showToast(archived ? 'تم تسجيل الدفع وأرشفة الحالة في الشيت.' : 'تم تسجيل الدفع؛ أرشفة الشيت معلّقة وستُعاد تلقائيًا.');
}
async function doctorCloseVisitWithoutPayment(id) {
  const appointment = appointmentById(id);
  const modal = document.getElementById('modal');
  if (!canCloseVisit() || !appointment || !modal || !['new','contacted','confirmed','rescheduled','follow_up'].includes(appointment.status)) return showToast('إغلاق الزيارة غير متاح لهذا الحساب أو لهذه الحالة.');
  if (!window.confirm('إغلاق الزيارة الآن مع ترك الدفع دون تسجيل، لتسجله السكرتارية لاحقًا؟')) return;
  const { error } = await supabase.rpc('doctor_close_visit_without_payment', { p_appointment_id:id });
  if (error) return showToast(`تعذر إغلاق الزيارة: ${error.message}`);
  const archived = await archiveClosedCaseToSheet(id);
  await loadData(); modal.remove(); renderApp();
  showToast(archived ? 'أُغلقت الزيارة وأُرسلت للأرشيف؛ يمكن للسكرتارية تسجيل الدفع لاحقًا.' : 'أُغلقت الزيارة في قاعدة الإدارة؛ أرشفة الشيت معلّقة وستُعاد تلقائيًا.');
}
async function saveSettings(event) { event.preventDefault(); if (!hasPermission('settings.edit')) return showToast('تعديل إعدادات العيادة غير متاح لهذا الحساب.'); const form = new FormData(event.currentTarget); const closed_weekdays = Array.from(event.currentTarget.closed_weekdays.selectedOptions).map(option => Number(option.value)); const closed_dates = String(form.get('closed_dates')).split(/\s+/).filter(Boolean); const service_prices = {}; ['first','follow','consult','aesthetic','birth','labs'].forEach(type => service_prices[type] = Math.max(0, Number(form.get(`price_${type}`) || 0))); const finance_enabled = form.get('finance_enabled') === 'on'; const { error } = await supabase.rpc('save_clinic_settings', { p_clinic_name:form.get('clinic_name'), p_max_daily_slots:Number(form.get('max_daily_slots')), p_work_start:form.get('work_start'), p_work_end:form.get('work_end'), p_closed_weekdays:closed_weekdays, p_closed_dates:closed_dates, p_service_prices:service_prices, p_finance_enabled:finance_enabled }); if (error) return showToast(`تعذر حفظ الإعدادات: ${error.message}`); await loadData(); if (!financeEnabled() && activeView === 'finance') activeView = 'settings'; renderApp(); showToast(finance_enabled ? 'تم حفظ إعدادات العيادة في قاعدة البيانات.' : 'تم حفظ الإعدادات وإيقاف الحسابات.'); }
async function saveExpense(event) { event.preventDefault(); if (!hasPermission('expenses.add')) return showToast('إضافة المصروفات غير متاحة لهذا الحساب.'); const form = new FormData(event.currentTarget); const amount = Number(form.get('amount')); if (!Number.isFinite(amount) || amount < 0) return showToast('راجعي مبلغ المصروف.'); const { data, error } = await supabase.rpc('record_clinic_expense', { p_expense_date:form.get('expense_date'), p_category:form.get('category'), p_amount:amount, p_note:String(form.get('note') || '').trim() }); if (error || !data) return showToast(`تعذر حفظ المصروف${error?.message ? `: ${error.message}` : ''}`); await loadData(); renderApp(); showToast(`تمت إضافة مصروف ${money(data.amount)} بتاريخ ${formatDate(data.expense_date, true)}.`); }
async function savePrivateNote(patientId) { if (!hasPermission('patients.private_notes')) return showToast('الملاحظات السرية غير متاحة لهذا الحساب.'); const note = document.getElementById('privateNote')?.value.trim() || ''; const { error } = await supabase.rpc('save_patient_private_note', { p_patient_id:patientId, p_private_note:note }); if (error) return showToast(`تعذر حفظ الملاحظة السرية: ${error.message}`); await loadData(); showToast('تم حفظ الملاحظة السرية داخل ملف المريضة.'); }
async function createManualBooking(patientId) {
  if (!hasPermission('appointments.create')) return showToast('إضافة حجز يدوي غير متاحة لهذا الحساب.');
  const patient = patientList().find(item => item.id === patientId);
  const modal = document.getElementById('modal');
  const requestedDate = document.getElementById('manualDate')?.value;
  const requestType = document.getElementById('manualType')?.value || 'follow';
  const requestedTime = document.getElementById('manualTime')?.value || null;
  const isWaitlist = Boolean(document.getElementById('manualWaitlist')?.checked);
  const message = document.getElementById('manualMessage')?.value.trim() || null;
  if (!patient || !requestedDate) return showToast('اختاري المريضة وتاريخ الموعد أولًا.');
  const existing = appointments.find(item => item.patient_id === patientId && item.requested_date === requestedDate && activeBooking(item));
  if (existing) return showToast('لدى المريضة موعد نشط بالفعل في هذا التاريخ.');
  if (!modal) return showToast('أغلقي النافذة وافتحي نموذج الحجز مرة أخرى.');
  modal.dataset.manualRequestId ||= window.crypto.randomUUID();
  const { data, error } = await supabase.rpc('create_manual_appointment', {
    p_patient_id:patientId,
    p_request_type:requestType,
    p_requested_date:requestedDate,
    p_requested_time:requestedTime,
    p_is_waitlist:isWaitlist,
    p_message:message,
    p_request_key:modal.dataset.manualRequestId
  });
  if (error || !data?.appointment_id) return showToast(`تعذر تسجيل الحجز وسجل الحركة: ${error?.message || ''}`);
  await loadData(); modal.remove(); renderApp();
  const confirmation = data.already_created ? 'تم التحقق من الحجز السابق بعد إعادة الاتصال.' : isWaitlist ? `أُضيفت ${patient.full_name} إلى قائمة الانتظار.` : `تم حجز موعد جديد لـ ${patient.full_name}.`;
  showToast(confirmation);
}
async function resolveAlert(id) { if (!hasPermission('alerts.resolve')) return showToast('مراجعة التنبيهات غير متاحة لهذا الحساب.'); const { data, error } = await supabase.rpc('resolve_clinic_alerts', { p_alert_ids:[id] }); if (error) return showToast(`تعذر تحديث التنبيه: ${error.message}`); await loadData(); renderApp(); showToast(Number(data) ? 'تم اعتبار التنبيه مُراجعًا.' : 'التنبيه سبق مراجعته.'); }
async function resolveAllAlerts() { if (!hasPermission('alerts.resolve')) return showToast('مراجعة التنبيهات غير متاحة لهذا الحساب.'); const pending = alerts.filter(alert => !alert.resolved_at); if (!pending.length) return showToast('لا توجد تنبيهات جديدة للمراجعة.'); const ids = pending.map(alert => alert.id); const { data, error } = await supabase.rpc('resolve_clinic_alerts', { p_alert_ids:ids }); if (error) return showToast(`تعذر تحديث التنبيهات: ${error.message}`); await loadData(); renderApp(); showToast(`تمت مراجعة ${Number(data) || 0} تنبيهًا.`); }
function csvCell(value) { const text = String(value ?? '').replace(/"/g,'""'); return `"${text}"`; }
function downloadBackup() { if (!hasPermission('backup.export')) return showToast('تنزيل النسخة غير متاح لهذا الحساب.'); const privateAccess = hasPermission('patients.private_notes'), financeAccess = hasPermission('finance.view'); const header = ['كود الحجز','الاسم','الهاتف','التاريخ','نوع الحجز','الحالة','المصدر','رسالة المريضة','ملاحظة العيادة',...(privateAccess ? ['ملاحظة سرية'] : []),...(financeAccess ? ['المبلغ المطلوب','المدفوع','وسيلة الدفع','ملاحظة الدفع','تاريخ تسجيل الدفع'] : [])]; const rows = appointments.map(a => [a.booking_code,a.patients?.full_name,a.patients?.phone,a.requested_date,typeText(a.request_type),statusLabels[a.status],a.source,a.message,a.staff_note,...(privateAccess ? [privateNoteOf(a.patients)] : []),...(financeAccess ? [a.amount_due,a.amount_paid,paymentMethodText(a.payment_method),a.payment_note,a.payment_recorded_at] : [])]); const csv = '\ufeff' + [header,...rows].map(row => row.map(csvCell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' })); const link = document.createElement('a'); link.href = url; link.download = `clinic-backup-${selectedDate}.csv`; link.click(); URL.revokeObjectURL(url); showToast('تم تنزيل نسخة احتياطية يمكن فتحها مباشرةً ببرنامج Excel.'); }
function localToday() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function startSmartReminders() { clearInterval(reminderTimer); checkSmartReminders(); reminderTimer = setInterval(checkSmartReminders, 60000); }
function checkSmartReminders() { const now = new Date(); const today = localToday(); const active = ['new','contacted','confirmed','rescheduled','follow_up']; const candidates = appointments.filter(a => a.requested_date === today && a.requested_time && active.includes(a.status) && (!reminderSnoozes[a.id] || reminderSnoozes[a.id] <= Date.now())).map(a => { const appointmentAt = new Date(`${a.requested_date}T${a.requested_time}`); return { appointment:a, minutes:Math.round((appointmentAt - now) / 60000) }; }).filter(item => (item.minutes >= 0 && item.minutes <= 30) || (item.minutes <= -15 && item.minutes >= -180)).sort((x,y) => x.minutes - y.minutes); const existing = document.getElementById('smartReminder'); if (!candidates.length) return existing?.remove(); const item = candidates[0]; const a = item.appointment; const late = item.minutes < 0; const message = late ? `مرّ ${Math.abs(item.minutes)} دقيقة على الموعد ولم يُسجل إجراء حتى الآن.` : `الموعد بعد ${item.minutes} دقيقة.`; const title = late ? 'تنبيه: موعد يحتاج إجراء' : 'تذكير بموعد قريب'; const html = `<section class="smart-reminder ${late ? 'late' : ''}" id="smartReminder" role="alert"><div class="smart-reminder-icon"><i class="fa-solid ${late ? 'fa-triangle-exclamation' : 'fa-bell'}"></i></div><div><b>${title}</b><h3>${escapeHtml(a.patients?.full_name || 'مريضة')} · ${formatTime(a.requested_time)}</h3><p>${message}</p></div><div class="smart-reminder-actions"><button class="primary-btn" data-action="reminder-open" data-id="${Number(a.id)}">فتح البطاقة</button><button class="ghost-btn" data-action="reminder-snooze" data-id="${Number(a.id)}">ذكريني بعد دقيقة</button></div></section>`; if (existing) existing.outerHTML = html; else app.insertAdjacentHTML('beforeend', html); }
function showToast(message) { const toast = document.getElementById('toast'); if (!toast) return; toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" data-action="toast-dismiss">حسنًا</button>`; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 5200); }
