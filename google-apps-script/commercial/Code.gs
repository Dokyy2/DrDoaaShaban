/**
 * Commercial clinic bridge (separate Apps Script deployment).
 * The Sheet is written first. Supabase is updated only as a retryable projection.
 * Keep all credentials in Script Properties; never copy them into this file.
 */
const CLINIC_TZ = 'Africa/Cairo';
const CLINIC_SHEETS = {
  appointment: 'Sheet1',
  birth: 'Sheet3',
  contact: 'Sheet2',
  audit: 'Clinic Audit',
  outbox: 'Clinic Sync Outbox',
  settings: 'Clinic Settings',
  notes: 'Clinic Private Notes',
  expenses: 'Clinic Expenses',
  alerts: 'Clinic Alerts'
};
const ACTIVE_STATUSES = new Set(['new', 'contacted', 'confirmed', 'rescheduled', 'follow_up']);
const DEFAULT_SETTINGS = { clinic_name: 'عيادة د. دعاء شعبان', max_daily_slots: 20, work_start: '16:00', work_end: '22:00', closed_weekdays: [1,4,5], closed_dates: [], service_prices: {}, finance_enabled: false, finance_start_date: '' };
const STATUS_LABELS = {
  new: 'جديد', contacted: 'تم التواصل', confirmed: 'موعد مؤكد',
  follow_up: 'متابعة لاحقة', completed: 'تمت الزيارة', no_show: 'لم تحضر',
  cancelled: 'ملغي', rescheduled: 'تم التأجيل'
};
const FIELD_ALIASES = {
  booking_code: ['ID', 'كود الحجز', 'رقم الحجز', 'معرف الحجز', 'Booking Code'],
  full_name: ['Name', 'الاسم', 'اسم المريضة', 'اسم العميلة'],
  phone: ['Phone', 'الهاتف', 'رقم الهاتف', 'رقم التليفون', 'الموبايل'],
  request_type: ['Type', 'نوع الحجز', 'نوع الطلب', 'نوع الكشف', 'الخدمة'],
  requested_date: ['Booking Date', 'تاريخ الحجز', 'تاريخ الموعد', 'الموعد المطلوب', 'التاريخ', 'Expected Delivery Date'],
  last_visit_date: ['Last Visit', 'آخر زيارة', 'تاريخ آخر زيارة'],
  created_at: ['Registration Time', 'وقت التسجيل', 'تاريخ التسجيل'],
  status: ['Status', 'الحالة', 'حالة الطلب'],
  source: ['Source', 'المصدر'],
  staff_note: ['Staff Note', 'ملاحظات', 'ملاحظة العيادة', 'ملاحظة داخلية'],
  message: ['Message', 'رسالة المريضة', 'رسالة المريض', 'الرسالة'],
  attachment_name: ['Attachment', 'المرفق', 'اسم المرفق'],
  attachment_type: ['Attachment Type', 'نوع المرفق'],
  attachment_file_id: ['Attachment File ID', 'معرف ملف المرفق'],
  requested_time: ['الساعة', 'وقت الموعد', 'Requested Time'],
  is_waitlist: ['قائمة انتظار', 'Waitlist'],
  contact_note: ['ملاحظة التواصل', 'Contact Note'],
  outcome_reason: ['سبب الإلغاء أو الغياب', 'Outcome Reason'],
  outcome_note: ['تفاصيل الإلغاء أو الغياب', 'Outcome Note'],
  amount_due: ['المبلغ المطلوب', 'Amount Due'],
  amount_paid: ['المبلغ المدفوع', 'Amount Paid'],
  payment_method: ['وسيلة الدفع', 'Payment Method'],
  payment_note: ['ملاحظة الدفع', 'Payment Note'],
  clinic_birth_recorded: ['تمت الولادة بالعيادة', 'Clinic Birth Recorded']
};

function doGet(e) {
  const mode = String(e && e.parameter && e.parameter.mode || 'health');
  if (mode === 'rpc') {
    return HtmlService.createHtmlOutputFromFile('Bridge')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (mode === 'presence') {
    const presence = updateActiveVisitors_(e.parameter.visitor);
    return e.parameter.callback ? jsonp_(presence, e.parameter.callback) : json_(presence);
  }
  if (mode !== 'health') return json_({ status: 'error', code: 'unsupported_mode' });
  const props = PropertiesService.getScriptProperties();
  const requiredProperties = ['WORKBOOK_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ATTACHMENTS_FOLDER_ID', 'NOTIFICATION_EMAIL'];
  const configured = requiredProperties.every(function (key) { return Boolean(props.getProperty(key)); });
  const retryTriggerInstalled = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'retryPendingSyncs';
  });
  return json_({
    status: configured && retryTriggerInstalled ? 'ready' : 'needs_setup',
    edition: 'sheet-first-commercial',
    configured: configured,
    retryTriggerInstalled: retryTriggerInstalled,
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  const raw = String(e && e.postData && e.postData.contents || '{}');
  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    return json_({ status: 'error', code: 'invalid_request', message: 'صيغة الطلب غير صحيحة.' });
  }
  return json_(processBridgeRequest_(request));
}

// Called by the same-origin HtmlService iframe to avoid cross-origin fetch
// restrictions in GitHub Pages and local browser previews.
function bridgeRpc(request) {
  try {
    return processBridgeRequest_(request);
  } catch (err) {
    return { status: 'error', code: 'bridge_error', message: safeError_(err) };
  }
}

function processBridgeRequest_(request) {
  let rawSize = 0;
  try { rawSize = JSON.stringify(request || {}).length; } catch (_) { return fail_('invalid_request', 'صيغة الطلب غير صحيحة.'); }
  if (rawSize > 8000000) return fail_('request_too_large', 'حجم الطلب أكبر من الحد المسموح.');
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') {
    return fail_('invalid_request', 'صيغة الطلب غير صحيحة.');
  }
  // Reconciliation preview is read-only. Authenticate and authorize it without
  // waiting for the global write lock, which may be held by the retry worker.
  if (request.action === 'admin.reconcile.preview') {
    try {
      const staff = authorizeStaff_(request.accessToken);
      if (!staff.ok) return fail_('unauthorized', 'انتهت الجلسة أو لا توجد صلاحية.');
      return handleStaffAction_(request, staff);
    } catch (err) {
      return fail_('bridge_error', safeError_(err));
    }
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (request.action === 'booking.create') {
      if (!allowPublicBooking_()) return fail_('rate_limited', 'طلبات كثيرة خلال وقت قصير. حاولي بعد قليل.');
      return createPublicBooking_(request.payload || {});
    }

    const staff = authorizeStaff_(request.accessToken);
    if (!staff.ok) return fail_('unauthorized', 'انتهت الجلسة أو لا توجد صلاحية.');
    const result = handleStaffAction_(request, staff);
    return result;
  } catch (err) {
    return fail_('bridge_error', safeError_(err));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function allowPublicBooking_() {
  const cache = CacheService.getScriptCache();
  const bucket = 'BOOKING_BURST_' + Math.floor(Date.now() / 60000);
  const current = Number(cache.get(bucket) || 0);
  if (current >= 30) return false;
  cache.put(bucket, String(current + 1), 120);
  return true;
}

function createPublicBooking_(data) {
  const type = String(data.type || '');
  const name = cleanText_(data.name, 120);
  const phone = digits_(data.phone);
  const isContact = type === 'contacts';
  const isBirth = type === 'birth';
  if (!['first', 'follow', 'consult', 'aesthetic', 'birth', 'labs', 'contacts'].includes(type)) return fail_('invalid_type', 'نوع الطلب غير صحيح.');
  if (name.trim().split(/\s+/).filter(Boolean).length < 3) return fail_('invalid_name', 'من فضلك اكتبي الاسم الثلاثي.');
  if (!/^01\d{9}$/.test(phone)) return fail_('invalid_phone', 'رقم الهاتف غير صحيح.');
  const date = String(data.bookingDate || data.expectedDeliveryDate || '');
  if (!isContact && !validIsoDate_(date)) return fail_('invalid_date', 'اختاري تاريخًا صحيحًا.');
  if (!isContact && !isBirth) {
    const parsed = new Date(date + 'T12:00:00');
    const day = Number(Utilities.formatDate(parsed, CLINIC_TZ, 'u')) % 7;
    const settings = readCanonicalSettings_();
    const closedDays = parseList_(settings.closed_weekdays, [1,4,5]).map(Number);
    const closedDates = parseList_(settings.closed_dates, []).map(String);
    if (closedDays.includes(day) || closedDates.includes(date)) return fail_('closed_day', 'هذا اليوم إجازة للعيادة. اختاري يومًا آخر.');
    if (date < Utilities.formatDate(new Date(), CLINIC_TZ, 'yyyy-MM-dd')) return fail_('past_date', 'لا يمكن اختيار تاريخ سابق.');
    if (dailyAppointmentCount_(sheetForType_(workbook_(), type), date) >= Math.max(1, Number(settings.max_daily_slots || 20))) return fail_('daily_capacity', 'اكتمل عدد الحجوزات المتاح لهذا اليوم.');
  }
  const ss = workbook_();
  const sheet = sheetForType_(ss, type);
  const duplicate = isContact ? null : findActiveDuplicateAcrossSheets_(phone);
  if (duplicate) {
    const eventId = Utilities.getUuid();
    const alert = { source_event_id: eventId, full_name: name, phone: phone, request_type: type, requested_date: date, reason: duplicate.needsReview ? 'يوجد سجل سابق لم تتم مطابقة حالته بعد.' : 'رقم الهاتف لديه حجز نشط بالفعل.', message: cleanText_(data.message, 1200), matched_booking_code: duplicate.bookingCode, status: 'new', created_at: new Date().toISOString() };
    const auditId = recordAudit_({ eventId: eventId, action: 'booking.duplicate', bookingCode: duplicate.bookingCode, role: 'public', summary: 'duplicate request alert added' });
    const id = enqueue_(auditId, 'booking.duplicate', eventId, alert);
    const sync = processOutbox_(id);
    if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ الطلب. حاولي مرة أخرى بعد قليل.');
    // Never disclose the matched patient's name, phone, or date to an unauthenticated caller.
    return { status: 'duplicated', code: duplicate.needsReview ? 'historical_match_review' : 'active_booking_exists', syncStatus: sync.ok ? 'synced' : 'pending', message: duplicate.needsReview ? 'وجدنا سجلًا سابقًا بهذا الرقم، والعيادة ستراجعه قبل إنشاء طلب مكرر.' : 'يوجد طلب نشط بهذا الرقم. تواصلي مع العيادة لتعديل الموعد.' };
  }

  const bookingCode = isContact ? 'C-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase() : makeBookingCode_(date);
  const attachment = saveAttachment_(data, bookingCode);
  const values = {
    booking_code: bookingCode, full_name: name, phone: phone,
    request_type: type, requested_date: date, last_visit_date: String(data.lastVisit || ''),
    created_at: Utilities.formatDate(new Date(), CLINIC_TZ, 'yyyy-MM-dd HH:mm:ss'),
    status: STATUS_LABELS.new, source: cleanText_(data.source || 'website', 40),
    message: cleanText_(data.message, 1200), attachment_name: attachment.name,
    attachment_type: attachment.mimeType, attachment_file_id: attachment.id
  };
  const auditId = recordAudit_({ action: 'booking.create', bookingCode: bookingCode, role: 'public', summary: 'booking row created' });
  const outboxId = enqueue_(auditId, 'booking.create', bookingCode, values);
  const sync = processOutbox_(outboxId);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ الطلب. حاولي مرة أخرى بعد قليل.');
  return {
    status: 'success', id: bookingCode, code: bookingCode, bookingCode: bookingCode,
    name: name, phone: phone, type: type, date: date,
    syncStatus: sync.ok ? 'synced' : 'pending',
    message: sync.ok ? 'تم استلام طلبك بنجاح.' : 'تم حفظ طلبك لدى العيادة، وجارٍ تحديث النظام.'
  };
}

function handleStaffAction_(request, staff) {
  const action = request.action;
  const body = request.payload || {};
  if (action === 'admin.appointment.update') return updateAppointment_(body, staff);
  if (action === 'admin.appointment.create') return createManualAppointment_(body, staff);
  if (action === 'admin.settings.update') return updateSettings_(body, staff);
  if (action === 'admin.patient-note.update') return updatePrivateNote_(body, staff);
  if (action === 'admin.expense.create') return createExpense_(body, staff);
  if (action === 'admin.alert.resolve') return resolveAlert_(body, staff);
  if (action === 'attachment.get') return readAttachment_(body, staff);
  if (action === 'admin.reconcile.preview') { requireRole_(staff, 'doctor'); return runHistoricalReconciliationDryRun_(); }
  if (action === 'admin.reconcile.link') { requireRole_(staff, 'doctor'); return linkHistoricalMatch_(body, staff); }
  return fail_('unsupported_action', 'الإجراء غير مدعوم.');
}

function updateAppointment_(payload, staff) {
  const bookingCode = cleanText_(payload.bookingCode, 80);
  if (!bookingCode) return fail_('missing_booking_code', 'كود الحجز غير موجود.');
  const update = sanitizeAppointmentUpdate_(payload.update || {}, staff.role);
  if (!Object.keys(update).length) return fail_('empty_update', 'لا توجد تغييرات صالحة للحفظ.');
  stampPaymentActor_(update, staff);
  const ss = workbook_();
  const found = findBookingRow_(ss, bookingCode);
  if (!found) return fail_('sheet_link_required', 'هذا الحجز يحتاج مطابقة مع الشيت قبل تعديله. لم يتم تغيير أي بيانات.');
  const oldStatus = statusCode_(found.values.status || '');
  const effectiveWaitlist = Object.prototype.hasOwnProperty.call(update, 'is_waitlist') ? update.is_waitlist : sheetBoolean_(found.values.is_waitlist);
  const effectiveDate = update.requested_date || found.values.requested_date;
  if (effectiveDate && (update.requested_date !== found.values.requested_date || (Object.prototype.hasOwnProperty.call(update, 'is_waitlist') && !effectiveWaitlist))) {
    const dateError = validateAppointmentDate_(found.sheet, effectiveDate, bookingCode, effectiveWaitlist, normalizeRequestType_(found.values.request_type));
    if (dateError) return dateError;
  }
  update.booking_code = bookingCode;
  const event = {
    eventId: Utilities.getUuid(), bookingCode: bookingCode,
    actorId: staff.id, actorName: staff.name, role: staff.role,
    action: 'admin.appointment.update', oldStatus: oldStatus,
    newStatus: update.status || oldStatus,
    note: cleanText_(payload.eventNote || '', 1000), createdAt: new Date().toISOString()
  };
  const auditId = recordAudit_(event);
  const outboxId = enqueue_(auditId, event.action, bookingCode, { update: update, event: event });
  const sync = processOutbox_(outboxId);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ التعديل في الشيت. لم يتم اعتماد التغيير.');
  return { status: 'success', bookingCode: bookingCode, sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending', message: sync.ok ? 'تم حفظ التعديل في الشيت وتحديث لوحة المتابعة.' : 'تم حفظ التعديل في الشيت، لكن تحديث لوحة المتابعة معلّق وسيُعاد تلقائيًا.' };
}

function createManualAppointment_(payload, staff) {
  const phone = digits_(payload.phone);
  const name = cleanText_(payload.full_name || payload.name, 120);
  const type = String(payload.request_type || 'follow');
  const date = String(payload.requested_date || '');
  const isWaitlist = payload.is_waitlist === true;
  if (!/^01\d{9}$/.test(phone) || !name || !validIsoDate_(date) || !['first','follow','consult','aesthetic','birth','labs'].includes(type)) return fail_('invalid_booking', 'راجعي الاسم ورقم الهاتف ونوع الحجز والتاريخ.');
  const dateError = isWaitlist ? null : validateAppointmentDate_(sheetForType_(workbook_(), type), date, '', false, type);
  if (dateError) return dateError;
  const activeMatch = findActiveDuplicateAcrossSheets_(phone);
  if (activeMatch && (activeMatch.needsReview || activeMatch.requestedDate === date)) return fail_('active_booking_exists', 'لدى المريضة طلب نشط بهذا التاريخ بالفعل. راجعي الحجز الحالي قبل إضافة موعد آخر.');
  const bookingCode = makeBookingCode_(date);
  const values = { booking_code: bookingCode, full_name: name, phone: phone, request_type: type, requested_date: date, requested_time: String(payload.requested_time || ''), is_waitlist: isWaitlist, created_at: new Date().toISOString(), status: isWaitlist ? STATUS_LABELS.new : STATUS_LABELS.confirmed, source: 'dashboard', message: cleanText_(payload.message, 1000) };
  const event = { eventId: Utilities.getUuid(), bookingCode: bookingCode, actorId: staff.id, actorName: staff.name, role: staff.role, action: 'admin.appointment.create', newStatus: isWaitlist ? 'new' : 'confirmed', note: isWaitlist ? 'أُضيفت المريضة إلى قائمة الانتظار.' : 'حجز يدوي من ملفها.', createdAt: new Date().toISOString() };
  const auditId = recordAudit_(event);
  const id = enqueue_(auditId, event.action, bookingCode, { appointment: values, event: event });
  const sync = processOutbox_(id);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ الحجز اليدوي في الشيت.');
  return { status: 'success', bookingCode: bookingCode, sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending' };
}

function updateSettings_(payload, staff) {
  requireRole_(staff, 'doctor');
  const allowed = ['clinic_name', 'max_daily_slots', 'work_start', 'work_end', 'closed_weekdays', 'closed_dates', 'service_prices', 'finance_enabled', 'finance_start_date'];
  const settings = {};
  allowed.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) settings[key] = payload[key]; });
  if (!Object.keys(settings).length) return fail_('empty_settings', 'لا توجد إعدادات للحفظ.');
  if (settings.max_daily_slots !== undefined && (!Number.isInteger(Number(settings.max_daily_slots)) || Number(settings.max_daily_slots) < 1 || Number(settings.max_daily_slots) > 500)) return fail_('invalid_settings', 'الحد اليومي يجب أن يكون رقمًا بين 1 و500.');
  if (settings.work_start !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.work_start))) return fail_('invalid_settings', 'وقت بداية العمل غير صحيح.');
  if (settings.work_end !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.work_end))) return fail_('invalid_settings', 'وقت نهاية العمل غير صحيح.');
  if (settings.closed_weekdays !== undefined && (!Array.isArray(settings.closed_weekdays) || settings.closed_weekdays.some(function (day) { return !Number.isInteger(Number(day)) || Number(day) < 0 || Number(day) > 6; }))) return fail_('invalid_settings', 'أيام الإجازة غير صحيحة.');
  if (settings.closed_dates !== undefined && (!Array.isArray(settings.closed_dates) || settings.closed_dates.some(function (day) { return !validIsoDate_(day); }))) return fail_('invalid_settings', 'يوجد تاريخ إجازة غير صحيح.');
  if (settings.service_prices !== undefined && (!settings.service_prices || typeof settings.service_prices !== 'object' || Array.isArray(settings.service_prices) || Object.keys(settings.service_prices).some(function (key) { return !['first','follow','consult','aesthetic','birth','labs'].includes(key) || !Number.isFinite(Number(settings.service_prices[key])) || Number(settings.service_prices[key]) < 0; }))) return fail_('invalid_settings', 'قائمة أسعار الخدمات غير صحيحة.');
  if (settings.finance_enabled !== undefined && typeof settings.finance_enabled !== 'boolean') return fail_('invalid_settings', 'حالة الحسابات غير صحيحة.');
  const merged = Object.assign({}, readCanonicalSettings_(), settings);
  const auditId = recordAudit_({ action: 'admin.settings.update', actorId: staff.id, actorName: staff.name, role: staff.role, summary: 'clinic settings updated' });
  const id = enqueue_(auditId, 'admin.settings.update', 'clinic', settings);
  const sync = processOutbox_(id);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ الإعدادات في الشيت.');
  return { status: 'success', sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending' };
}

function updatePrivateNote_(payload, staff) {
  requireRole_(staff, 'doctor');
  const patientId = cleanText_(payload.patientId, 80);
  const phone = digits_(payload.phone);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientId) || !/^01\d{9}$/.test(phone)) return fail_('invalid_patient', 'بيانات المريضة غير مكتملة.');
  const note = cleanText_(payload.private_note || '', 4000);
  const auditId = recordAudit_({ action: 'admin.patient-note.update', actorId: staff.id, actorName: staff.name, role: staff.role, summary: 'doctor note updated' });
  const id = enqueue_(auditId, 'admin.patient-note.update', phone, { patientId: patientId, phone: phone, private_note: note, actorId: staff.id });
  const sync = processOutbox_(id);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ الملاحظة في الشيت.');
  return { status: 'success', sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending' };
}

function createExpense_(payload, staff) {
  requireRole_(staff, 'doctor');
  const amount = Number(payload.amount);
  const date = String(payload.expense_date || '');
  if (!Number.isFinite(amount) || amount < 0 || !validIsoDate_(date)) return fail_('invalid_expense', 'راجعي مبلغ المصروف وتاريخه.');
  const eventId = Utilities.getUuid();
  const values = { source_event_id: eventId, expense_date: date, category: cleanText_(payload.category, 80), amount: amount, note: cleanText_(payload.note, 1000), created_by: staff.id, created_at: new Date().toISOString() };
  const auditId = recordAudit_({ eventId: eventId, action: 'admin.expense.create', actorId: staff.id, actorName: staff.name, role: staff.role, summary: 'expense added' });
  const id = enqueue_(auditId, 'admin.expense.create', eventId, values);
  const sync = processOutbox_(id);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ المصروف في الشيت.');
  return { status: 'success', expense: values, sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending' };
}

function resolveAlert_(payload, staff) {
  const sourceEventId = String(payload.sourceEventId || '');
  if (!/^[0-9a-f-]{36}$/i.test(sourceEventId)) return fail_('unlinked_alert', 'التنبيه قديم أو غير مربوط بحدث الشيت ويحتاج مطابقة أولًا.');
  const auditId = recordAudit_({ action: 'admin.alert.resolve', actorId: staff.id, actorName: staff.name, role: staff.role, summary: 'booking alert resolved' });
  const id = enqueue_(auditId, 'admin.alert.resolve', sourceEventId, { source_event_id:sourceEventId, resolved_by: staff.id });
  const sync = processOutbox_(id);
  if (!sync.sheetSaved) return fail_('sheet_write_failed', 'تعذر حفظ مراجعة التنبيه في الشيت.');
  return { status: 'success', sheetSaved: true, syncStatus: sync.ok ? 'synced' : 'pending' };
}

function readAttachment_(payload, staff) {
  requireRole_(staff, 'doctor');
  const bookingCode = cleanText_(payload.bookingCode, 80);
  const found = findBookingRow_(workbook_(), bookingCode);
  if (!found) return fail_('sheet_link_required', 'الحجز لم تتم مطابقته بالشيت بعد.');
  const id = String(found.values.attachment_file_id || '');
  if (!id) return fail_('attachment_missing', 'لا يوجد ملف مرتبط بهذا الحجز.');
  const file = DriveApp.getFileById(id);
  const blob = file.getBlob();
  return { status: 'success', name: file.getName(), mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function authorizeStaff_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return { ok: false };
  const user = supabaseFetch_('/auth/v1/user', 'get', null, token, false);
  if (!user || !user.id) return { ok: false };
  const profile = supabaseFetch_('/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,full_name,role', 'get', null, '', true);
  if (!Array.isArray(profile) || profile.length !== 1 || !['doctor', 'secretary'].includes(profile[0].role)) return { ok: false };
  return { ok: true, id: user.id, name: String(profile[0].full_name || user.email || ''), role: profile[0].role };
}

function sanitizeAppointmentUpdate_(input, role) {
  const allowed = new Set(['status', 'requested_date', 'requested_time', 'is_waitlist', 'staff_note', 'contact_note', 'outcome_reason', 'outcome_note', 'amount_due', 'amount_paid', 'payment_method', 'payment_note', 'clinic_birth_recorded']);
  const result = {};
  Object.keys(input).forEach(function (key) {
    if (!allowed.has(key)) return;
    if (role === 'secretary' && ['staff_note'].includes(key)) result[key] = cleanText_(input[key], 1200);
    else if (role === 'secretary' && ['status','requested_date','requested_time','is_waitlist','contact_note','outcome_reason','outcome_note','amount_due','amount_paid','payment_method','payment_note','payment_recorded_by','payment_recorded_at','clinic_birth_recorded'].includes(key)) result[key] = input[key];
    else if (role === 'doctor') result[key] = typeof input[key] === 'string' ? cleanText_(input[key], 1200) : input[key];
  });
  if (result.status && !Object.prototype.hasOwnProperty.call(STATUS_LABELS, result.status)) throw new Error('حالة الحجز غير معتمدة.');
  ['amount_due','amount_paid'].forEach(function (key) { if (key in result && (!Number.isFinite(Number(result[key])) || Number(result[key]) < 0)) throw new Error('قيمة الدفع غير صحيحة.'); });
  if (result.payment_method && !['cash','visa','instapay','vodafone_cash','other'].includes(result.payment_method)) throw new Error('وسيلة الدفع غير معتمدة.');
  if (result.requested_date && !validIsoDate_(result.requested_date)) throw new Error('تاريخ الموعد غير صحيح.');
  if (result.requested_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(result.requested_time))) throw new Error('وقت الموعد غير صحيح.');
  ['is_waitlist','clinic_birth_recorded'].forEach(function (key) { if (key in result && typeof result[key] !== 'boolean') throw new Error('قيمة الحقل غير صحيحة.'); });
  if (result.status) result.status_label = STATUS_LABELS[result.status];
  return result;
}

function stampPaymentActor_(update, staff) {
  const paymentChanged = ['amount_due', 'amount_paid', 'payment_method', 'payment_note']
    .some(function (key) { return Object.prototype.hasOwnProperty.call(update, key); });
  if (!paymentChanged) return update;
  if (!staff || !staff.id || !['doctor', 'secretary'].includes(staff.role)) throw new Error('تعذر التحقق من الموظف الذي سجل الدفع.');
  update.payment_recorded_by = staff.id;
  update.payment_recorded_at = new Date().toISOString();
  return update;
}

function applyUpdateToMirror_(bookingCode, update, event) {
  const rowUpdate = Object.assign({}, update);
  delete rowUpdate.status_label;
  const response = supabaseFetch_('/rest/v1/appointments?booking_code=eq.' + encodeURIComponent(bookingCode) + '&select=id,patient_id,status', 'patch', mapAppointment_(rowUpdate), '', true);
  if (!Array.isArray(response) || !response.length) throw new Error('booking not found in Supabase mirror; historical match required');
  const actorEvent = Object.assign({ appointment_id: response[0].id, actor_id: event.actorId, event_type: 'updated', old_status: event.oldStatus, new_status: update.status || event.oldStatus, note: event.note || '', source_event_id: event.eventId }, {});
  insertOnce_('appointment_events', 'source_event_id', event.eventId, actorEvent);
}

function syncOutboxPayload_(action, key, payload) {
  if (action === 'booking.create') return projectBooking_(payload, null);
  if (action === 'booking.duplicate') {
    const match = supabaseFetch_('/rest/v1/appointments?booking_code=eq.' + encodeURIComponent(payload.matched_booking_code) + '&select=id', 'get', null, '', true);
    const row = Object.assign({}, payload, { matched_appointment_id: Array.isArray(match) && match.length ? match[0].id : null });
    delete row.matched_booking_code;
    return insertOnce_('booking_alerts', 'source_event_id', key, row);
  }
  if (action === 'admin.appointment.update') return applyUpdateToMirror_(key, payload.update || {}, payload.event || {});
  if (action === 'admin.appointment.create') return projectBooking_(payload.appointment || {}, payload.event || {});
  if (action === 'admin.settings.update') return supabaseFetch_('/rest/v1/clinic_settings?id=eq.true', 'patch', mapSettings_(payload), '', true);
  if (action === 'admin.patient-note.update') {
    const row = {
      patient_id: payload.patientId,
      private_note: cleanText_(payload.private_note, 4000),
      updated_by: payload.actorId || null
    };
    return supabaseFetch_('/rest/v1/patient_private_notes?on_conflict=patient_id', 'post', row, '', true, 'resolution=merge-duplicates,return=representation');
  }
  if (action === 'admin.expense.create') return insertOnce_('clinic_expenses', 'source_event_id', key, payload);
  if (action === 'admin.alert.resolve') {
    const result = supabaseFetch_('/rest/v1/booking_alerts?source_event_id=eq.' + encodeURIComponent(key) + '&select=id', 'patch', { status:'handled', resolved_at:new Date().toISOString(), resolved_by:payload.resolved_by }, '', true, 'return=representation');
    if (!Array.isArray(result) || !result.length) throw new Error('alert event not found in Supabase mirror');
    return result;
  }
  if (action === 'admin.reconcile.link') return applyHistoricalProjectionLink_(payload);
  throw new Error('Unsupported outbox action: ' + action);
}

function projectBooking_(values, event) {
  const patient = supabaseFetch_('/rest/v1/patients?on_conflict=phone', 'post', { full_name: values.full_name, phone: values.phone }, '', true, 'resolution=merge-duplicates,return=representation');
  if (!Array.isArray(patient) || patient.length !== 1 || !patient[0].id) throw new Error('patient projection did not return one row');
  if (values.request_type === 'contacts') return { status:'success', patient_id:patient[0].id };
  const appointment = {
    booking_code: values.booking_code, patient_id: patient[0].id,
    request_type: values.request_type, requested_date: values.requested_date || null,
    last_visit_date: values.last_visit_date || null, message: values.message || null,
    attachment_name: values.attachment_name || null, attachment_type: values.attachment_type || null,
    status: statusCode_(values.status || 'new'), source: values.source || 'website',
    requested_time: values.requested_time || null, is_waitlist: Boolean(values.is_waitlist)
  };
  const result = supabaseFetch_('/rest/v1/appointments?on_conflict=booking_code', 'post', appointment, '', true, 'resolution=merge-duplicates,return=representation');
  if (!Array.isArray(result) || result.length !== 1) throw new Error('appointment projection did not return one row');
  const createdEvent = event && event.eventId ? event : { eventId:'web-' + values.booking_code, actorId:null, action:'booking.create', newStatus:'new', note:'تم استلام طلب من الموقع.' };
  insertOnce_('appointment_events', 'source_event_id', createdEvent.eventId, {
    appointment_id: result[0].id, actor_id: createdEvent.actorId || null,
    event_type: 'created', old_status: null, new_status: appointment.status,
    note: cleanText_(createdEvent.note || 'تم تسجيل الطلب.', 1000),
    source_event_id: createdEvent.eventId
  });
  return result;
}

function processOutbox_(outboxId) {
  const sh = workbook_().getSheetByName(CLINIC_SHEETS.outbox);
  const row = rowByValue_(sh, 1, outboxId);
  if (!row) return { ok: false, sheetSaved: false };
  const cells = sh.getRange(row, 1, 1, 7).getValues()[0];
  const action = String(cells[2]);
  const key = String(cells[3]);
  const payload = JSON.parse(String(cells[4] || '{}'));
  let sheetSaved = cells[5] === 'pending' || cells[5] === 'synced';
  try {
    if (!sheetSaved) {
      applySheetAction_(action, key, payload);
      sh.getRange(row, 6).setValue('pending');
      sheetSaved = true;
    }
    syncOutboxPayload_(action, key, payload);
    sh.getRange(row, 6, 1, 2).setValues([['synced', Number(cells[6] || 0) + 1]]);
    sh.getRange(row, 8).setValue('');
    if (action === 'booking.create') {
      const booking = findBookingRow_(workbook_(), payload.booking_code);
      if (booking) sendClinicNotice_(booking.sheet, payload);
    }
    return { ok: true, sheetSaved: true };
  } catch (err) {
    sh.getRange(row, 6, 1, 2).setValues([[sheetSaved ? 'pending' : 'staged', Number(cells[6] || 0) + 1]]);
    sh.getRange(row, 8).setValue(safeError_(err));
    return { ok: false, sheetSaved: sheetSaved };
  }
}

function applySheetAction_(action, key, payload) {
  const ss = workbook_();
  if (action === 'booking.create') {
    const sh = sheetForType_(ss, payload.request_type);
    if (payload.request_type === 'contacts') {
      const phoneCol = findHeader_(sh, FIELD_ALIASES.phone);
      let existingRow = 0;
      if (phoneCol && sh.getLastRow() >= 2) {
        for (let row = headerRow_(sh) + 1; row <= sh.getLastRow(); row++) if (digits_(sh.getRange(row, phoneCol).getDisplayValue()) === digits_(payload.phone)) { existingRow = row; break; }
      }
      if (existingRow) writeMapped_(sh, existingRow, { full_name:payload.full_name, phone:payload.phone, message:payload.message, source:payload.source, created_at:payload.created_at });
      else appendMapped_(sh, payload);
      return;
    }
    const existing = findBookingRow_(ss, key);
    if (!existing) appendMapped_(sh, payload);
    return;
  }
  if (action === 'booking.duplicate') {
    const sh = getOrCreate_(CLINIC_SHEETS.alerts, ['source_event_id','full_name','phone','request_type','requested_date','reason','message','matched_booking_code','status','created_at']);
    if (!rowByValue_(sh, findHeader_(sh, ['source_event_id']), key)) appendObject_(CLINIC_SHEETS.alerts, payload);
    return;
  }
  if (action === 'admin.appointment.update') {
    const found = findBookingRow_(ss, key);
    if (!found) throw new Error('booking code missing in canonical workbook');
    writeMapped_(found.sheet, found.row, payload.update || {});
    appendAuditEventOnce_(payload.event || {});
    return;
  }
  if (action === 'admin.appointment.create') {
    const values = payload.appointment || {};
    if (!findBookingRow_(ss, key)) appendMapped_(sheetForType_(ss, values.request_type), values);
    appendAuditEventOnce_(payload.event || {});
    return;
  }
  if (action === 'admin.settings.update') {
    const settings = Object.assign({}, readCanonicalSettings_(), payload);
    writeCanonicalSettings_(settings);
    return;
  }
  if (action === 'admin.patient-note.update') {
    upsertKeyValue_(CLINIC_SHEETS.notes, { patient_id:payload.patientId, phone:payload.phone, private_note:payload.private_note, updated_by:payload.actorId, updated_at:new Date().toISOString() }, 'phone');
    return;
  }
  if (action === 'admin.expense.create') {
    const sh = getOrCreate_(CLINIC_SHEETS.expenses, Object.keys(payload));
    const col = ensureColumn_(sh, 'source_event_id', 'source_event_id');
    if (!rowByValue_(sh, col, key)) appendObject_(CLINIC_SHEETS.expenses, payload);
    return;
  }
  if (action === 'admin.alert.resolve') {
    const sh = workbook_().getSheetByName(CLINIC_SHEETS.alerts);
    const col = sh && findHeader_(sh, ['source_event_id']);
    const row = col ? rowByValue_(sh, col, key) : 0;
    if (!row) throw new Error('alert event missing in canonical workbook');
    writeObject_(sh, row, { status:'handled', resolved_at:new Date().toISOString(), resolved_by:payload.resolved_by });
    return;
  }
  if (action === 'admin.reconcile.link') { appendAuditEventOnce_(payload.event || {}); return; }
  throw new Error('Unsupported Sheet action');
}

function appendAuditEventOnce_(event) {
  if (!event || !event.eventId) return;
  const sh = getOrCreate_(CLINIC_SHEETS.audit, ['event_id','created_at','action','bookingCode','actorId','actorName','role','oldStatus','newStatus','note']);
  const col = ensureColumn_(sh, 'event_id', 'event_id');
  if (!rowByValue_(sh, col, event.eventId)) appendObject_(CLINIC_SHEETS.audit, event);
}

function retryPendingSyncs() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = workbook_().getSheetByName(CLINIC_SHEETS.outbox);
    if (!sh || sh.getLastRow() < 2) return;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    rows.forEach(function (row) { if (row[5] === 'pending' || row[5] === 'staged') processOutbox_(String(row[0])); });
  } finally { lock.releaseLock(); }
}

function runHistoricalReconciliationDryRun_() {
  const ss = workbook_();
  const dbRows = loadReconciliationRows_();
  const byCode = new Map();
  const byComposite = new Map();
  dbRows.forEach(function (row) {
    if (row.booking_code) byCode.set(String(row.booking_code), row);
    const phone = digits_(row.patients && row.patients.phone);
    const key = compositeKey_(phone, row.requested_date, row.request_type);
    if (!byComposite.has(key)) byComposite.set(key, []);
    byComposite.get(key).push(row);
  });
  const counts = { sheetRows:0, exactCodeMatches:0, uniqueCompositeCandidates:0, ambiguousCandidates:0, unmatched:0, duplicateSheetRows:0, duplicateSheetCodes:0 };
  const details = { unique:[], ambiguous:[], unmatched:[] };
  const seenComposite = new Set();
  const seenCodes = new Set();
  [CLINIC_SHEETS.appointment, CLINIC_SHEETS.birth].forEach(function (sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    // Read each source sheet in two batch calls. Per-cell Spreadsheet service
    // calls made the read-only preview take minutes on a full clinic history.
    const lastRow = sh.getLastRow();
    const lastColumn = sh.getLastColumn();
    if (!lastColumn) return;
    const displayRows = sh.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
    const rawRows = sh.getRange(1, 1, lastRow, lastColumn).getValues();
    const headerIndex = headerRowFromDisplayValues_(displayRows);
    const headers = displayRows[headerIndex - 1] || [];
    const columns = {};
    Object.keys(FIELD_ALIASES).forEach(function (field) {
      const wanted = new Set(FIELD_ALIASES[field].map(normalizeHeader_));
      columns[field] = headers.findIndex(function (value) { return wanted.has(normalizeHeader_(value)); });
    });
    const codeCol = columns.booking_code;
    if (codeCol < 0) return;
    const firstDataRow = headerIndex + 1;
    for (let rowNum = firstDataRow; rowNum <= lastRow; rowNum++) {
      const displayRow = displayRows[rowNum - 1] || [];
      const code = String(displayRow[codeCol] || '').trim();
      if (!code) continue;
      const rawRow = rawRows[rowNum - 1] || [];
      const row = {};
      Object.keys(columns).forEach(function (field) {
        const col = columns[field];
        if (col >= 0) {
          const value = rawRow[col];
          row[field] = field === 'requested_date' ? sheetDateIso_(value) : value;
        }
      });
      counts.sheetRows++;
      const base = { sheetName:sheetName, rowNumber:rowNum, bookingCode:code, fullName:cleanText_(row.full_name, 120), phone:digits_(row.phone), requestedDate:String(row.requested_date || ''), requestType:normalizeRequestType_(row.request_type) };
      if (seenCodes.has(code)) { counts.duplicateSheetCodes++; continue; }
      seenCodes.add(code);
      if (byCode.has(code)) { counts.exactCodeMatches++; continue; }
      const key = compositeKey_(digits_(row.phone), row.requested_date, normalizeRequestType_(row.request_type));
      if (seenComposite.has(key)) { counts.duplicateSheetRows++; continue; }
      seenComposite.add(key);
      const candidates = byComposite.get(key) || [];
      if (candidates.length === 1) {
        counts.uniqueCompositeCandidates++;
        const candidate = candidates[0];
        details.unique.push(Object.assign({}, base, { candidateAppointmentId:String(candidate.id), candidateBookingCode:String(candidate.booking_code || ''), candidateName:cleanText_(candidate.patients && candidate.patients.full_name, 120), candidatePhone:digits_(candidate.patients && candidate.patients.phone), candidateStatus:String(candidate.status || ''), candidateRequestedTime:String(candidate.requested_time || ''), candidateMessage:cleanText_(candidate.message, 500) }));
      } else if (candidates.length > 1) {
        counts.ambiguousCandidates++;
        details.ambiguous.push(Object.assign({}, base, { candidates:candidates.slice(0, 10).map(function (candidate) { return { appointmentId:String(candidate.id), bookingCode:String(candidate.booking_code || ''), name:cleanText_(candidate.patients && candidate.patients.full_name, 120), phone:digits_(candidate.patients && candidate.patients.phone), status:String(candidate.status || ''), requestedTime:String(candidate.requested_time || ''), message:cleanText_(candidate.message, 500) }; }), candidateCount:candidates.length }));
      } else {
        counts.unmatched++;
        details.unmatched.push(base);
      }
    }
  });
  return { status:'success', mode:'dry_run_only', counts:counts, details:details, note:'No Sheet or Supabase rows were changed. Unique candidates require explicit doctor approval; ambiguous and unmatched rows are never linked automatically.' };
}

function headerRowFromDisplayValues_(values) {
  const keyFields = [FIELD_ALIASES.booking_code, FIELD_ALIASES.full_name, FIELD_ALIASES.phone];
  let bestRow = 1;
  let bestScore = 0;
  values.slice(0, 5).forEach(function (row, index) {
    const present = new Set(row.map(normalizeHeader_));
    const score = keyFields.filter(function (aliases) {
      return aliases.some(function (alias) { return present.has(normalizeHeader_(alias)); });
    }).length;
    if (score > bestScore) { bestScore = score; bestRow = index + 1; }
  });
  return bestScore >= 2 ? bestRow : 1;
}

function loadReconciliationRows_() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = supabaseFetch_('/rest/v1/appointments?select=id,booking_code,request_type,requested_date,status,requested_time,message,patients(full_name,phone)&order=id.asc&limit=1000&offset=' + offset, 'get', null, '', true);
    if (!Array.isArray(page)) throw new Error('Could not read appointment mirror for reconciliation.');
    rows.push.apply(rows, page);
    if (page.length < 1000) break;
  }
  return rows;
}

function readReconciliationSheetRow_(sheetName, rowNumber, bookingCode) {
  if (![CLINIC_SHEETS.appointment, CLINIC_SHEETS.birth].includes(sheetName) || !Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Invalid historical row reference.');
  const sh = workbook_().getSheetByName(sheetName);
  if (!sh || rowNumber > sh.getLastRow()) throw new Error('Historical Sheet row no longer exists.');
  const codeColumn = findHeader_(sh, FIELD_ALIASES.booking_code);
  const currentCode = codeColumn ? String(sh.getRange(rowNumber, codeColumn).getDisplayValue() || '').trim() : '';
  if (!currentCode || currentCode !== bookingCode) throw new Error('The Sheet row changed after preview. Run the preview again.');
  const duplicate = findBookingRow_(workbook_(), currentCode);
  if (!duplicate || duplicate.sheet.getName() !== sheetName || duplicate.row !== rowNumber) throw new Error('Duplicate or moved Sheet booking code; manual review is required.');
  return readMapped_(sh, rowNumber);
}

function validateHistoricalCandidate_(payload) {
  const values = readReconciliationSheetRow_(String(payload.sheetName || ''), Number(payload.rowNumber), cleanText_(payload.bookingCode, 80));
  const candidateId = String(payload.candidateAppointmentId || '');
  if (!/^\d{1,18}$/.test(candidateId)) throw new Error('Invalid Supabase appointment reference.');
  const expectedCode = cleanText_(payload.candidateBookingCode, 80);
  if (!expectedCode) throw new Error('The candidate booking code is missing.');
  if (!/^01\d{9}$/.test(digits_(values.phone)) || !validIsoDate_(values.requested_date) || !['first','follow','consult','aesthetic','birth','labs'].includes(normalizeRequestType_(values.request_type))) throw new Error('The Sheet row lacks an exact phone, date, or request type for safe matching.');
  const key = compositeKey_(digits_(values.phone), values.requested_date, normalizeRequestType_(values.request_type));
  const rows = loadReconciliationRows_();
  const matches = rows.filter(function (row) { return compositeKey_(digits_(row.patients && row.patients.phone), row.requested_date, row.request_type) === key; });
  const candidate = matches.find(function (row) { return String(row.id) === candidateId; });
  if (!candidate) throw new Error('The selected candidate is no longer an exact match. Run the preview again.');
  if (matches.length > 1 && payload.allowAmbiguous !== true) throw new Error('This match is ambiguous and requires explicit doctor review.');
  if (String(candidate.booking_code || '') !== String(values.booking_code) && String(candidate.booking_code || '') !== expectedCode) throw new Error('The Supabase candidate changed after preview.');
  const codeMatches = rows.filter(function (row) { return String(row.booking_code || '') === String(values.booking_code); });
  if (codeMatches.length && String(codeMatches[0].id) !== candidateId) throw new Error('This Sheet booking code is already assigned to another Supabase record.');
  return { values:values, candidate:candidate, candidateCount:matches.length, manuallyReviewed:matches.length > 1, bookingCode:String(values.booking_code), key:key };
}

function linkHistoricalMatch_(payload, staff) {
  requireRole_(staff, 'doctor');
  const verified = validateHistoricalCandidate_(payload);
  const event = { eventId:Utilities.getUuid(), bookingCode:verified.bookingCode, actorId:staff.id, actorName:staff.name, role:staff.role, action:'admin.reconcile.link', oldStatus:String(verified.candidate.status || ''), newStatus:statusCode_(verified.values.status || verified.candidate.status || 'new'), note:(verified.manuallyReviewed ? 'Doctor manually selected an ambiguous historical match: ' : 'Doctor approved unique historical Sheet match: ') + String(verified.candidate.booking_code || '—') + ' → ' + verified.bookingCode, createdAt:new Date().toISOString() };
  const auditId = recordAudit_(event);
  const approval = { event:event, sheetName:String(payload.sheetName), rowNumber:Number(payload.rowNumber), bookingCode:verified.bookingCode, candidateAppointmentId:String(verified.candidate.id), candidateBookingCode:String(verified.candidate.booking_code || ''), allowAmbiguous:verified.manuallyReviewed, approvedBy:staff.id };
  const id = enqueue_(auditId, 'admin.reconcile.link', verified.bookingCode, approval);
  const sync = processOutbox_(id);
  return { status:sync.ok ? 'success' : 'pending', bookingCode:verified.bookingCode, sheetSaved:sync.sheetSaved, syncStatus:sync.ok ? 'synced' : 'pending', message:sync.ok ? 'تم اعتماد الربط وتحديث الإسقاط.' : 'تم تسجيل موافقة الربط، والمزامنة معلّقة وستُعاد تلقائيًا.' };
}

function applyHistoricalProjectionLink_(payload) {
  const verified = validateHistoricalCandidate_(payload);
  const values = verified.values;
  const candidateId = String(verified.candidate.id);
  const codeAlreadyLinked = String(verified.candidate.booking_code || '') === verified.bookingCode;
  const projection = { booking_code:verified.bookingCode };
  const textFields = ['last_visit_date','message','attachment_name','attachment_type','source','staff_note','requested_time','outcome_reason','outcome_note','contact_note','payment_method','payment_note'];
  textFields.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(values, field)) projection[field] = values[field] === '' ? null : values[field]; });
  if (Object.prototype.hasOwnProperty.call(values, 'request_type')) projection.request_type = normalizeRequestType_(values.request_type);
  if (Object.prototype.hasOwnProperty.call(values, 'requested_date')) projection.requested_date = values.requested_date || null;
  if (Object.prototype.hasOwnProperty.call(values, 'status') && String(values.status || '').trim()) projection.status = statusCode_(values.status);
  if (Object.prototype.hasOwnProperty.call(values, 'is_waitlist')) projection.is_waitlist = sheetBoolean_(values.is_waitlist);
  if (Object.prototype.hasOwnProperty.call(values, 'clinic_birth_recorded')) projection.clinic_birth_recorded = sheetBoolean_(values.clinic_birth_recorded);
  ['amount_due','amount_paid'].forEach(function (field) { if (Object.prototype.hasOwnProperty.call(values, field)) projection[field] = values[field] === '' || values[field] == null ? 0 : Number(values[field]); });
  if (Object.prototype.hasOwnProperty.call(values, 'created_at') && values.created_at) projection.created_at = values.created_at;
  ['amount_due','amount_paid'].forEach(function (field) { if (Object.prototype.hasOwnProperty.call(projection, field) && (!Number.isFinite(projection[field]) || projection[field] < 0)) throw new Error('Invalid payment values on the canonical Sheet row.'); });
  if (!codeAlreadyLinked) {
    const changed = supabaseFetch_('/rest/v1/appointments?id=eq.' + encodeURIComponent(candidateId) + '&select=id', 'patch', projection, '', true, 'return=representation');
    if (!Array.isArray(changed) || changed.length !== 1) throw new Error('Could not update the approved projection row.');
  }
  const patient = supabaseFetch_('/rest/v1/patients?on_conflict=phone', 'post', { full_name:cleanText_(values.full_name, 120), phone:digits_(values.phone) }, '', true, 'resolution=merge-duplicates,return=representation');
  if (!Array.isArray(patient) || patient.length !== 1) throw new Error('Could not synchronize the patient projection.');
  const event = payload.event || {};
  insertOnce_('appointment_events', 'source_event_id', event.eventId, { appointment_id:Number(candidateId), actor_id:payload.approvedBy || null, event_type:'historical_linked', old_status:verified.candidate.status || null, new_status:projection.status, note:cleanText_(event.note || 'Doctor approved historical Sheet match.', 1000), source_event_id:event.eventId });
  return { status:'success', bookingCode:verified.bookingCode };
}

function compositeKey_(phone, date, type) { return [digits_(phone), String(date || '').slice(0, 10), normalizeRequestType_(type)].join('|'); }
function normalizeRequestType_(value) {
  const text = normalizeHeader_(value);
  const aliases = {
    'كشف اول مرة':'first', 'كشف أول مرة':'first', 'كشف اول مره':'first', 'كشف أول مره':'first', 'first':'first',
    'كشف متابعة':'follow', 'متابعة':'follow', 'follow':'follow',
    'استشارة متابعة':'consult', 'consult':'consult',
    'تجميل نسائي':'aesthetic', 'aesthetic':'aesthetic',
    'حجز ولادة':'birth', 'حجز ولاده':'birth', 'birth':'birth',
    'تحاليل او اشعة':'labs', 'تحاليل أو أشعة':'labs', 'labs':'labs',
    'جهات اتصال':'contacts', 'contacts':'contacts'
  };
  return aliases[text] || String(value || '').toLowerCase();
}

function installRetryTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'retryPendingSyncs'; });
  if (!exists) ScriptApp.newTrigger('retryPendingSyncs').timeBased().everyMinutes(10).create();
}

function enqueue_(auditId, action, key, payload) {
  const sh = getOrCreate_(CLINIC_SHEETS.outbox, ['id','created_at','action','entity_key','payload_json','state','attempts','last_error']);
  sh.appendRow([auditId, new Date().toISOString(), action, key, JSON.stringify(payload), 'staged', 0, '']);
  return auditId;
}

function recordAudit_(entry) {
  const eventId = String(entry.eventId || Utilities.getUuid());
  appendObject_(CLINIC_SHEETS.audit, Object.assign({ event_id: eventId, created_at: new Date().toISOString() }, entry));
  return eventId;
}

function upsertPatientNote_(patientId, phone, note, staff) {
  upsertKeyValue_(CLINIC_SHEETS.notes, { patient_id: patientId, phone: phone, private_note: note, updated_by: staff.id, updated_at: new Date().toISOString() }, 'phone');
}

function upsertKeyValue_(sheetName, object, keyName) {
  const sh = getOrCreate_(sheetName, Object.keys(object));
  const key = keyName || Object.keys(object)[0];
  const header = headerMap_(sh);
  const keyColumn = ensureColumn_(sh, key, key);
  const row = rowByValue_(sh, keyColumn, String(object[key]));
  if (row) writeObject_(sh, row, object);
  else appendObject_(sheetName, object);
}

function readCanonicalSettings_() {
  const sh = workbook_().getSheetByName(CLINIC_SHEETS.settings);
  if (!sh || sh.getLastRow() < 2) return Object.assign({}, DEFAULT_SETTINGS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const row = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  headers.forEach(function (key, index) { if (key && row[index] !== '') settings[key] = row[index]; });
  return settings;
}

function writeCanonicalSettings_(settings) {
  const sh = getOrCreate_(CLINIC_SHEETS.settings, Object.keys(DEFAULT_SETTINGS));
  Object.keys(settings).forEach(function (key) { ensureColumn_(sh, key, key); });
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const row = headers.map(function (key) { const value = settings[key]; return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value == null ? '' : value; });
  if (sh.getLastRow() < 2) sh.appendRow(row); else sh.getRange(2, 1, 1, row.length).setValues([row]);
}

function appendObject_(sheetName, object) {
  const sh = getOrCreate_(sheetName, Object.keys(object));
  const row = sh.getLastRow() + 1;
  writeObject_(sh, row, object);
  return row;
}

function writeObject_(sh, row, object) {
  Object.keys(object).forEach(function (key) {
    const col = ensureColumn_(sh, key, key);
    sh.getRange(row, col).setValue(sheetSafeValue_(key, object[key]));
  });
}

function appendMapped_(sh, values) {
  const row = sh.getLastRow() + 1;
  writeMapped_(sh, row, values);
  return row;
}

function writeMapped_(sh, row, values) {
  Object.keys(values).forEach(function (field) {
    if (field === 'status_label') return;
    const aliases = FIELD_ALIASES[field] || [field];
    const header = findHeader_(sh, aliases) || ensureColumn_(sh, aliases[0], aliases[0]);
    let value = values[field];
    if (field === 'status' && values.status_label) value = values.status_label;
    if (typeof value === 'boolean') value = value ? 'نعم' : 'لا';
    sh.getRange(row, header).setValue(sheetSafeValue_(field, value));
  });
}

function sheetSafeValue_(field, value) {
  if (value == null) return '';
  if (field === 'phone') return "'" + digits_(value);
  if (typeof value === 'string' && /^[=+@-]/.test(value)) return "'" + value;
  return value;
}

function findBookingRow_(ss, bookingCode) {
  for (const sheetName of [CLINIC_SHEETS.appointment, CLINIC_SHEETS.birth, CLINIC_SHEETS.contact]) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) continue;
    const codeColumn = findHeader_(sh, FIELD_ALIASES.booking_code);
    if (!codeColumn) continue;
    const row = rowByValue_(sh, codeColumn, bookingCode);
    if (row) return { sheet: sh, row: row, values: readMapped_(sh, row) };
  }
  return null;
}

function readMapped_(sh, row) {
  const result = {};
  Object.keys(FIELD_ALIASES).forEach(function (field) {
    const col = findHeader_(sh, FIELD_ALIASES[field]);
    if (col) {
      const value = sh.getRange(row, col).getValue();
      result[field] = field === 'requested_date' ? sheetDateIso_(value) : value;
    }
  });
  return result;
}

function findActiveDuplicate_(sh, phone) {
  if (sh.getLastRow() < 2) return null;
  const phoneCol = findHeader_(sh, FIELD_ALIASES.phone);
  const idCol = findHeader_(sh, FIELD_ALIASES.booking_code);
  const statusCol = findHeader_(sh, FIELD_ALIASES.status);
  if (!phoneCol || !idCol) return null;
  for (let row = headerRow_(sh) + 1; row <= sh.getLastRow(); row++) {
    if (digits_(sh.getRange(row, phoneCol).getDisplayValue()) !== phone) continue;
    const status = statusCol ? statusCode_(sh.getRange(row, statusCol).getDisplayValue()) : '';
    if (!statusCol || ACTIVE_STATUSES.has(status)) {
      const nameCol = findHeader_(sh, FIELD_ALIASES.full_name);
      const dateCol = findHeader_(sh, FIELD_ALIASES.requested_date);
      const requestedDate = dateCol ? sheetDateIso_(sh.getRange(row, dateCol).getValue()) : '';
      // Historical active labels must not block a new booking. Keep the source row
      // unchanged for audit/history; treat only today and future appointments as active.
      if (requestedDate && requestedDate < Utilities.formatDate(new Date(), CLINIC_TZ, 'yyyy-MM-dd')) continue;
      return { bookingCode: String(sh.getRange(row, idCol).getDisplayValue()), fullName: nameCol ? String(sh.getRange(row, nameCol).getDisplayValue()) : '', phone: phone, requestedDate: requestedDate, needsReview: !statusCol };
    }
  }
  return null;
}

function findActiveDuplicateAcrossSheets_(phone) {
  const ss = workbook_();
  for (const name of [CLINIC_SHEETS.appointment, CLINIC_SHEETS.birth]) {
    const sh = ss.getSheetByName(name);
    const match = sh ? findActiveDuplicate_(sh, phone) : null;
    if (match) return match;
  }
  return null;
}

function validateAppointmentDate_(sh, date, excludeBookingCode, waitlist, requestType) {
  if (!validIsoDate_(date)) return fail_('invalid_date', 'تاريخ الموعد غير صحيح.');
  if (date < Utilities.formatDate(new Date(), CLINIC_TZ, 'yyyy-MM-dd')) return fail_('past_date', 'لا يمكن اختيار تاريخ سابق.');
  if (waitlist || requestType === 'birth') return null;
  const settings = readCanonicalSettings_();
  const weekday = Number(Utilities.formatDate(new Date(date + 'T12:00:00'), CLINIC_TZ, 'u')) % 7;
  if (parseList_(settings.closed_weekdays, [1,4,5]).map(Number).includes(weekday) || parseList_(settings.closed_dates, []).map(String).includes(date)) return fail_('closed_day', 'التاريخ المحدد إجازة للعيادة.');
  if (dailyAppointmentCount_(sh, date, excludeBookingCode) >= Math.max(1, Number(settings.max_daily_slots || 20))) return fail_('daily_capacity', 'اكتمل عدد الحجوزات المتاح لهذا اليوم. اختاري قائمة الانتظار أو تاريخًا آخر.');
  return null;
}

function sheetBoolean_(value) { return value === true || ['نعم','yes','true','1'].includes(String(value || '').trim().toLowerCase()); }

function dailyAppointmentCount_(sh, date, excludeBookingCode) {
  if (!sh) return 0;
  const firstDataRow = headerRow_(sh) + 1;
  if (sh.getLastRow() < firstDataRow) return 0;
  const dateCol = findHeader_(sh, FIELD_ALIASES.requested_date);
  const statusCol = findHeader_(sh, FIELD_ALIASES.status);
  const codeCol = findHeader_(sh, FIELD_ALIASES.booking_code);
  if (!dateCol) return 0;
  let count = 0;
  for (let row = firstDataRow; row <= sh.getLastRow(); row++) {
    if (excludeBookingCode && codeCol && String(sh.getRange(row, codeCol).getDisplayValue()) === String(excludeBookingCode)) continue;
    if (sheetDateIso_(sh.getRange(row, dateCol).getValue()) !== date) continue;
    const status = statusCol ? statusCode_(sh.getRange(row, statusCol).getDisplayValue()) : '';
    if (!statusCol || !['cancelled', 'no_show'].includes(status)) count++;
  }
  return count;
}

function parseList_(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return fallback;
  try { const parsed = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed : fallback; } catch (_) { return String(value).split(/[\s,;]+/).filter(Boolean); }
}

function sheetDateIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, CLINIC_TZ, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  if (validIsoDate_(text)) return text;
  const match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!match) return '';
  const monthFirst = Number(match[1]) > 12 ? false : true;
  const month = monthFirst ? Number(match[1]) : Number(match[2]);
  const day = monthFirst ? Number(match[2]) : Number(match[1]);
  const result = String(match[3]) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  return validIsoDate_(result) ? result : '';
}

function sheetForType_(ss, type) {
  const name = type === 'contacts' ? CLINIC_SHEETS.contact : type === 'birth' ? CLINIC_SHEETS.birth : CLINIC_SHEETS.appointment;
  let sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Required sheet tab not found: ' + name);
  return sh;
}

function getOrCreate_(name, headers) {
  const ss = workbook_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers && headers.length) sh.appendRow(headers);
  return sh;
}

function findHeader_(sh, aliases) {
  if (sh.getLastColumn() < 1) return 0;
  const headerRow = headerRow_(sh);
  const headers = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const wanted = new Set(aliases.map(normalizeHeader_));
  const index = headers.findIndex(function (value) { return wanted.has(normalizeHeader_(value)); });
  return index < 0 ? 0 : index + 1;
}

function ensureColumn_(sh, alias, title) {
  const existing = findHeader_(sh, [alias]);
  if (existing) return existing;
  const col = Math.max(1, sh.getLastColumn() + 1);
  sh.getRange(headerRow_(sh), col).setValue(title);
  return col;
}

function headerRow_(sh) {
  const rows = Math.min(Math.max(sh.getLastRow(), 1), 5);
  const columns = Math.max(1, sh.getLastColumn());
  const values = sh.getRange(1, 1, rows, columns).getDisplayValues();
  const keyFields = [FIELD_ALIASES.booking_code, FIELD_ALIASES.full_name, FIELD_ALIASES.phone];
  let bestRow = 1;
  let bestScore = 0;
  values.forEach(function (row, index) {
    const present = new Set(row.map(normalizeHeader_));
    const score = keyFields.filter(function (aliases) {
      return aliases.some(function (alias) { return present.has(normalizeHeader_(alias)); });
    }).length;
    if (score > bestScore) { bestScore = score; bestRow = index + 1; }
  });
  return bestScore >= 2 ? bestRow : 1;
}

function headerMap_(sh) { return sh.getRange(headerRow_(sh), 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0]; }
function rowByValue_(sh, column, value) {
  if (!sh) return 0;
  const firstDataRow = headerRow_(sh) + 1;
  if (sh.getLastRow() < firstDataRow) return 0;
  const values = sh.getRange(firstDataRow, column, sh.getLastRow() - firstDataRow + 1, 1).getDisplayValues();
  const index = values.findIndex(function (item) { return String(item[0]) === String(value); });
  return index < 0 ? 0 : index + firstDataRow;
}

function saveAttachment_(data, bookingCode) {
  const name = cleanText_(data.fileName || data.attachmentName || '', 160);
  const encoded = String(data.fileData || data.attachmentBase64 || '');
  if (!name || !encoded) return { name: '', id: '', mimeType: '' };
  if (encoded.length > 7000000) throw new Error('حجم الملف أكبر من الحد المسموح.');
  const folderId = PropertiesService.getScriptProperties().getProperty('ATTACHMENTS_FOLDER_ID');
  if (!folderId) throw new Error('مجلد المرفقات الآمن غير مضبوط بعد.');
  const mime = safeMime_(data.fileType || data.attachmentType || 'application/octet-stream');
  const bytes = Utilities.base64Decode(encoded.replace(/^data:[^,]+,/, ''));
  const blob = Utilities.newBlob(bytes, mime, bookingCode + '-' + name);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  return { name: name, id: file.getId(), mimeType: mime };
}

function sendClinicNotice_(sh, values) {
  const props = PropertiesService.getScriptProperties();
  const recipient = String(props.getProperty('NOTIFICATION_EMAIL') || '').trim().toLowerCase();
  if (!recipient || /[,;\s]/.test(recipient)) return;
  const sentCol = ensureColumn_(sh, 'Notification Sent At', 'Notification Sent At');
  let row = rowByValue_(sh, findHeader_(sh, FIELD_ALIASES.booking_code), values.booking_code);
  if (!row && values.phone) {
    const phoneCol = findHeader_(sh, FIELD_ALIASES.phone);
    if (phoneCol && sh.getLastRow() >= 2) {
      for (let index = headerRow_(sh) + 1; index <= sh.getLastRow(); index++) if (digits_(sh.getRange(index, phoneCol).getDisplayValue()) === digits_(values.phone)) { row = index; break; }
    }
  }
  if (!row || sh.getRange(row, sentCol).getValue()) return;
  const subject = 'طلب حجز جديد · ' + values.booking_code;
  const body = [
    'طلب حجز جديد من موقع عيادة د. دعاء شعبان',
    'كود الطلب: ' + values.booking_code,
    'نوع الطلب: ' + values.request_type,
    'التاريخ: ' + (values.requested_date || 'طلب تواصل'),
    'افتحي الشيت أو لوحة الإدارة لمراجعة التفاصيل.'
  ].join('\n');
  try {
    MailApp.sendEmail({ to: recipient, subject: subject, body: body });
    sh.getRange(row, sentCol).setValue(new Date());
  } catch (err) {
    const errorCol = ensureColumn_(sh, 'Notification Error', 'Notification Error');
    sh.getRange(row, errorCol).setValue(safeError_(err));
  }
}

function supabaseFetch_(path, method, body, bearer, useSecretKey, prefer) {
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const secret = props.getProperty('SUPABASE_SECRET_KEY') || '';
  const publishable = props.getProperty('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!url || !secret || !publishable) throw new Error('Supabase Script Properties are not configured.');
  const apiKey = useSecretKey ? secret : publishable;
  const headers = { apikey: apiKey };
  // New sb_secret keys are API keys, not JWTs: send them via apikey only.
  if (!useSecretKey && bearer) headers.Authorization = 'Bearer ' + bearer;
  if (prefer) headers.Prefer = prefer;
  const options = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const response = UrlFetchApp.fetch(url + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('Supabase HTTP ' + code);
  return text ? JSON.parse(text) : null;
}

function insertOnce_(table, keyColumn, key, row) {
  const found = supabaseFetch_('/rest/v1/' + table + '?' + keyColumn + '=eq.' + encodeURIComponent(key) + '&select=id', 'get', null, '', true);
  if (Array.isArray(found) && found.length) return found[0];
  const result = supabaseFetch_('/rest/v1/' + table, 'post', row, '', true, 'return=representation');
  return Array.isArray(result) ? result[0] : result;
}

function mapAppointment_(row) {
  const map = Object.assign({}, row);
  if (map.status_label) { map.status = map.status || Object.keys(STATUS_LABELS).find(function (key) { return STATUS_LABELS[key] === map.status_label; }); delete map.status_label; }
  return map;
}
function mapSettings_(settings) { return settings; }

function workbook_() {
  const id = PropertiesService.getScriptProperties().getProperty('WORKBOOK_ID');
  if (!id) throw new Error('WORKBOOK_ID is not configured in Script Properties.');
  return SpreadsheetApp.openById(id);
}
function requireRole_(staff, role) { if (!staff || staff.role !== role) throw new Error('الصلاحية غير كافية لهذا الإجراء.'); }
function statusCode_(value) { const normalized = normalizeHeader_(value); const legacy = { 'مؤكد': 'confirmed', 'تأكيد': 'confirmed', 'تم الحضور': 'completed', 'حضر': 'completed', 'ملغي': 'cancelled', 'الغاء': 'cancelled', 'مؤجل': 'rescheduled' }; if (legacy[normalized]) return legacy[normalized]; const entry = Object.keys(STATUS_LABELS).find(function (key) { return normalizeHeader_(STATUS_LABELS[key]) === normalized; }); return entry || String(value || '').toLowerCase(); }
function makeBookingCode_(date) { const day = validIsoDate_(date) ? date.replace(/-/g, '') : Utilities.formatDate(new Date(), CLINIC_TZ, 'yyyyMMdd'); return 'BK-' + day + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }
function validIsoDate_(value) { const text = String(value || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; const date = new Date(text + 'T12:00:00'); return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text; }
function digits_(value) { return String(value || '').replace(/\D/g, ''); }
function cleanText_(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 1000); }
function normalizeHeader_(value) { return String(value || '').toLowerCase().normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[\s_\-]+/g, ' ').trim(); }
function safeMime_(value) { const allowed = ['image/jpeg','image/png','image/webp','image/gif','application/pdf']; return allowed.includes(value) ? value : 'application/octet-stream'; }
function safeError_(err) { return cleanText_(err && err.message || err || 'Unknown error', 300); }
function fail_(code, message) { return { status: 'error', code: code, message: message }; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(value, callback) {
  const name = String(callback || '');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(name)) return json_({ status:'error', code:'invalid_callback' });
  return ContentService.createTextOutput(name + '(' + JSON.stringify(value) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function updateActiveVisitors_(visitorId) {
  const id = String(visitorId || '');
  if (!/^[a-f0-9]{32}$/.test(id)) return { status:'invalid', activeUsers:0, moreThanFive:false };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = 'CLINIC_ACTIVE_VISITORS';
    const now = Date.now();
    const ttlMs = 75000;
    let visitors = {};
    try { visitors = JSON.parse(properties.getProperty(key) || '{}'); } catch (_) { visitors = {}; }
    Object.keys(visitors).forEach(function (visitor) { if (!visitors[visitor] || now - Number(visitors[visitor]) > ttlMs) delete visitors[visitor]; });
    visitors[id] = now;
    const recent = Object.entries(visitors).sort(function (a, b) { return Number(b[1]) - Number(a[1]); }).slice(0, 6);
    visitors = {};
    recent.forEach(function (entry) { visitors[entry[0]] = entry[1]; });
    properties.setProperty(key, JSON.stringify(visitors));
    const count = Object.keys(visitors).length;
    return { status:'success', activeUsers:Math.min(count, 5), moreThanFive:count > 5 };
  } finally { lock.releaseLock(); }
}

