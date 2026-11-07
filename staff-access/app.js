import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.CLINIC_SUPABASE || {};
const statusNames = { new: 'طلب جديد', contacted: 'بانتظار استكمال المتابعة', confirmed: 'موعد مؤكد', follow_up: 'متابعة لاحقة', rescheduled: 'موعد مؤجل' };
const readStatuses = ['new', 'contacted', 'follow_up', 'rescheduled'];
const followStatuses = ['contacted', 'follow_up', 'rescheduled'];
const loginDialog = document.getElementById('loginDialog');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const statusBox = document.getElementById('connectionStatus');
const connectionBanner = document.getElementById('connectionBanner');
const accountLabel = document.getElementById('accountLabel');
const logoutButton = document.getElementById('logoutButton');
const todayPanel = document.getElementById('todayPanel');
const otherPanel = document.getElementById('otherPanel');
const pageTitle = document.getElementById('pageTitle');
const otherTitle = document.getElementById('otherTitle');
const navItems = [...document.querySelectorAll('[data-view]')];
let supabase;
let currentUser;

function announce(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('is-error', error);
  statusBox.classList.add('visible');
  window.setTimeout(() => statusBox.classList.remove('visible'), 4500);
}

function showLogin(message = '') {
  loginError.textContent = message;
  if (!loginDialog.open) loginDialog.showModal();
}

function escapeText(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDate(value) {
  if (!value) return 'التاريخ غير محدد';
  return new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
}

function formatTime(value) {
  if (!value) return 'الساعة لم تحدد بعد';
  return new Date(`2000-01-01T${value}`).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
}

function setCount(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = Number(value || 0).toLocaleString('ar-EG');
}

function setTodayLabel() {
  const label = document.querySelector('.topbar .eyebrow');
  if (label) label.textContent = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}

function renderTasks(rows) {
  const host = document.getElementById('taskList');
  if (!rows.length) {
    host.innerHTML = '<div class="empty-preview">لا توجد طلبات مفتوحة تحتاج إجراءً الآن.</div>';
    return;
  }
  host.innerHTML = rows.map((row, index) => {
    const status = row.status || 'new';
    const type = statusNames[status] || 'طلب يحتاج مراجعة';
    const dot = index === 0 ? 'urgent' : index === 1 ? 'amber-dot' : 'teal-dot';
    const tag = index === 0 ? 'urgent-tag' : index === 1 ? 'amber-tag' : 'teal-tag';
    const date = row.requested_date ? ` · ${formatDate(row.requested_date)}` : '';
    const time = row.requested_time ? ` · ${formatTime(row.requested_time)}` : '';
    const title = row.patients?.full_name || 'طلب حجز';
    return `<article class="task-row"><span class="task-dot ${dot}"></span><div class="task-copy"><strong>${escapeText(title)}</strong><small>${escapeText(type + date + time)}</small></div><span class="task-tag ${tag}">${escapeText(statusNames[status] || 'متابعة')}</span></article>`;
  }).join('');
}

function renderSchedule(rows) {
  const host = document.getElementById('scheduleList');
  if (!rows.length) {
    host.innerHTML = '<div class="empty-preview">لا توجد مواعيد مسجلة لليوم.</div>';
    return;
  }
  host.innerHTML = rows.map((row, index) => `<div class="schedule-item"><span class="time">${escapeText(formatTime(row.requested_time))}</span><span class="timeline"></span><div><strong>${escapeText(row.patients?.full_name || 'موعد')}</strong><small>${escapeText(row.request_type || 'حجز')}</small></div><span class="status-dot ${index > 1 ? 'muted' : ''}"></span></div>`).join('');
}

async function loadSummary() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const count = (query) => query.select('id', { count: 'exact', head: true });
  const [newResult, followResult, todayResult, alertsResult, taskResult, scheduleResult] = await Promise.all([
    count(supabase.from('appointments')).eq('status', 'new'),
    count(supabase.from('appointments')).in('status', followStatuses),
    count(supabase.from('appointments')).eq('requested_date', today).not('status', 'in', '(cancelled,no_show)').neq('request_type', 'contacts'),
    count(supabase.from('booking_alerts')).is('resolved_at', null),
    supabase.from('appointments').select('id,status,request_type,requested_date,requested_time,created_at,patients(full_name)').in('status', readStatuses).order('created_at', { ascending: true }).limit(5),
    supabase.from('appointments').select('id,status,request_type,requested_time,patients(full_name)').eq('requested_date', today).not('status', 'in', '(cancelled,no_show)').neq('request_type', 'contacts').order('requested_time', { ascending: true }).limit(8)
  ]);
  const failed = [newResult, followResult, todayResult, alertsResult, taskResult, scheduleResult].find((result) => result.error);
  if (failed) throw failed.error;
  setCount('newCount', newResult.count);
  setCount('followCount', followResult.count);
  setCount('todayCount', todayResult.count);
  setCount('alertCount', alertsResult.count);
  document.getElementById('bookingBadge').textContent = Number(newResult.count || 0).toLocaleString('ar-EG');
  document.getElementById('followBadge').textContent = Number(followResult.count || 0).toLocaleString('ar-EG');
  renderTasks(taskResult.data || []);
  renderSchedule(scheduleResult.data || []);
}

async function acceptSession(session) {
  if (!session) {
    currentUser = null;
    accountLabel.textContent = 'غير مسجل الدخول';
    logoutButton.hidden = true;
    connectionBanner.textContent = 'واجهة داخلية — سجّلي الدخول لعرض ملخص من قاعدة العيادة · قراءة فقط';
    showLogin();
    return;
  }
  announce('جارٍ التحقق من صلاحية الحساب…');
  const { data: profile, error } = await supabase.from('profiles').select('id,full_name,role').eq('id', session.user.id).single();
  if (error || !profile || !['doctor', 'secretary'].includes(profile.role)) {
    await supabase.auth.signOut();
    showLogin('هذا الحساب غير مخوّل لعرض بيانات العيادة.');
    return;
  }
  currentUser = profile;
  connectionBanner.textContent = 'اتصال Supabase نشط · الملخص للقراءة فقط';
  accountLabel.textContent = `${profile.full_name || 'فريق العيادة'} · ${profile.role === 'doctor' ? 'الدكتورة' : 'السكرتارية'}`;
  logoutButton.hidden = false;
  loginError.textContent = '';
  if (loginDialog.open) loginDialog.close();
  try {
    await loadSummary();
    announce('تم الاتصال الآمن وعرض الملخص.');
  } catch (error) {
    console.error('تعذر تحميل الملخص:', error.message);
    connectionBanner.textContent = 'تم تسجيل الدخول · تعذر تحميل الملخص من قاعدة البيانات';
    announce('تعذر تحميل الملخص. راجعي اتصال Supabase وصلاحيات القراءة.', true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return showLogin('إعداد الاتصال غير متاح.');
  const form = new FormData(loginForm);
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'جارٍ التحقق…';
  loginError.textContent = '';
  const { data, error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  submit.disabled = false;
  submit.textContent = 'دخول آمن';
  if (error) return showLogin('تعذر تسجيل الدخول. راجعي البريد وكلمة المرور أو حالة الحساب.');
  await acceptSession(data.session);
});

logoutButton.addEventListener('click', async () => {
  await supabase?.auth.signOut();
  await acceptSession(null);
});

const sectionNames = { today: 'نظرة اليوم', bookings: 'الحجوزات', patients: 'دليل المرضى', calendar: 'التقويم', followup: 'المتابعة', reports: 'التقارير' };
function showView(view) {
  const title = sectionNames[view] || sectionNames.today;
  pageTitle.textContent = title;
  otherTitle.textContent = title;
  todayPanel.hidden = view !== 'today';
  otherPanel.hidden = view === 'today';
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
}
navItems.forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));

if (!config.url || !config.anonKey) {
  announce('ملف إعداد Supabase غير مكتمل.', true);
  showLogin('راجعي إعدادات الاتصال المحلية في js/config.js.');
} else {
  supabase = createClient(config.url, config.anonKey);
  setTodayLabel();
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) announce('تعذر التحقق من الجلسة الحالية.', true);
    acceptSession(data?.session || null);
  });
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') queueMicrotask(() => acceptSession(null));
  });
}
