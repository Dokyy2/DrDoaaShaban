const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const bridgePath = path.join(__dirname, '..', 'google-apps-script', 'commercial', 'Code.gs');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.js'), 'utf8');
const bookingSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
const bridgeHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'commercial', 'Bridge.html'), 'utf8');
const bridgeClientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'bridge-client.js'), 'utf8');
const lockdownSource = fs.readFileSync(path.join(__dirname, '..', 'supabase', '07_sheet_canonical_lockdown.sql'), 'utf8');

function loadBridge(overrides = {}) {
  const sandbox = {
    Utilities: { getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    cleanText_: (value, max = 1000) => String(value ?? '').trim().slice(0, max),
    digits_: value => String(value ?? '').replace(/\D/g, ''),
    fail_: (code, message) => ({ status: 'error', code, message }),
    ...overrides
  };
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox, { filename: bridgePath });
  return sandbox;
}

function sheetWithRows(rows) {
  return {
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map(row => row.length)),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValue: () => rows[row - 1]?.[column - 1] ?? '',
        getDisplayValue: () => String(rows[row - 1]?.[column - 1] ?? ''),
        getDisplayValues: () => rows.slice(row - 1, row - 1 + rowCount)
          .map(line => line.slice(column - 1, column - 1 + columnCount).map(value => String(value ?? '')))
      };
    }
  };
}

test('past active bookings do not block a new booking; today and future still block', () => {
  const bridge = loadBridge({
    Utilities: {
      getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      formatDate: () => '2026-11-08'
    }
  });
  const makeSheet = date => sheetWithRows([
    ['ID', 'Name', 'Phone', 'Booking Date', 'Status'],
    ['BK-TEST', 'Synthetic Patient', '01000000000', date, 'confirmed']
  ]);
  assert.equal(bridge.findActiveDuplicate_(makeSheet('2026-11-07'), '01000000000'), null);
  assert.equal(bridge.findActiveDuplicate_(makeSheet('2026-11-08'), '01000000000').bookingCode, 'BK-TEST');
  assert.equal(bridge.findActiveDuplicate_(makeSheet('2026-11-09'), '01000000000').bookingCode, 'BK-TEST');
});

test('detects booking headers in row 1 and row 2 layouts', () => {
  const bridge = loadBridge();
  assert.equal(bridge.headerRow_(sheetWithRows([
    ['ID', 'Name', 'Phone'], ['BK-1', 'Synthetic', '01000000000']
  ])), 1);
  assert.equal(bridge.headerRow_(sheetWithRows([
    ['عنوان تجريبي'], ['ID', 'Name', 'Phone'], ['BK-1', 'Synthetic', '01000000000']
  ])), 2);
});

test('routes contact leads to Sheet2 and keeps the contacts directory out of write routing', () => {
  const bridge = loadBridge();
  const lookedUp = [];
  const sheet = {};
  const workbook = { getSheetByName(name) { lookedUp.push(name); return sheet; } };
  assert.equal(bridge.sheetForType_(workbook, 'contacts'), sheet);
  assert.deepEqual(lookedUp, ['Sheet2']);
  assert.equal(bridge.sheetForType_(workbook, 'birth'), sheet);
  assert.equal(bridge.sheetForType_(workbook, 'follow'), sheet);
  assert.deepEqual(lookedUp, ['Sheet2', 'Sheet3', 'Sheet1']);
});

test('duplicate booking response does not reveal matched patient details', () => {
  const bridge = loadBridge();
  bridge.workbook_ = () => ({});
  bridge.sheetForType_ = () => ({});
  bridge.findActiveDuplicateAcrossSheets_ = () => ({
    bookingCode: 'BK-TEST-PRIVATE', fullName: 'Synthetic Patient',
    phone: '01000000000', requestedDate: '2026-11-08', needsReview: false
  });
  bridge.recordAudit_ = () => 'event-test';
  bridge.enqueue_ = () => 'event-test';
  bridge.saveOutboxActionToSheet_ = () => true;
  bridge.processOutbox_ = () => ({ ok: true, sheetSaved: true });

  const response = bridge.createPublicBooking_({
    type: 'birth', name: 'Synthetic Request Person',
    phone: '01000000000', expectedDeliveryDate: '2026-11-20'
  });

  assert.equal(response.status, 'duplicated');
  for (const field of ['oldName', 'oldPhone', 'oldDate', 'bookingCode', 'id']) {
    assert.equal(Object.hasOwn(response, field), false, `response must omit ${field}`);
  }
  assert.equal(JSON.stringify(response).includes('Synthetic Patient'), false);
});

test('escapes formula-like values before writing them into a Sheet cell', () => {
  const bridge = loadBridge();
  assert.equal(bridge.sheetSafeValue_('message', '=IMPORTXML("https://example.invalid", "//x")'),
    "'=IMPORTXML(\"https://example.invalid\", \"//x\")");
});

test('secretary update allowlist excludes private notes and unknown fields', () => {
  const bridge = loadBridge();
  const update = JSON.parse(JSON.stringify(bridge.sanitizeAppointmentUpdate_({
    status: 'confirmed', amount_paid: 250, private_note: 'synthetic private note', is_superuser: true
  }, 'secretary')));
  assert.deepEqual(update, { status: 'confirmed', amount_paid: 250, status_label: 'موعد مؤكد' });
});

test('payment attribution ignores browser identity and stamps the verified staff member', () => {
  const bridge = loadBridge();
  const update = JSON.parse(JSON.stringify(bridge.sanitizeAppointmentUpdate_({
    amount_paid: 250,
    payment_recorded_by: 'spoofed-user-id',
    payment_recorded_at: '2000-01-01T00:00:00.000Z'
  }, 'secretary')));
  assert.equal(Object.hasOwn(update, 'payment_recorded_by'), false);
  assert.equal(Object.hasOwn(update, 'payment_recorded_at'), false);

  const staff = { id: 'verified-user-id', role: 'secretary' };
  const stamped = JSON.parse(JSON.stringify(bridge.stampPaymentActor_(update, staff)));
  assert.equal(stamped.payment_recorded_by, 'verified-user-id');
  assert.match(stamped.payment_recorded_at, /^\d{4}-\d\d-\d\dT/);
});

test('private-note projection maps bridge fields to the Supabase table schema', () => {
  const bridge = loadBridge();
  let captured;
  bridge.supabaseFetch_ = (...args) => { captured = args; return [{ patient_id: args[2].patient_id }]; };
  const payload = {
    patientId: '12345678-1234-4234-8234-123456789abc',
    phone: '01000000000',
    private_note: 'Synthetic clinic-only note',
    actorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  };
  const result = bridge.syncOutboxPayload_('admin.patient-note.update', payload.patientId, payload);
  assert.deepEqual(captured.slice(0, 2), [
    '/rest/v1/patient_private_notes?on_conflict=patient_id', 'post'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(captured[2])), {
    patient_id: payload.patientId,
    private_note: payload.private_note,
    updated_by: payload.actorId
  });
  assert.equal(captured[2].patientId, undefined);
  assert.equal(result[0].patient_id, payload.patientId);
});

test('private-note action requires a valid patient UUID and doctor role', () => {
  const bridge = loadBridge();
  const invalid = bridge.updatePrivateNote_({ patientId: 'not-a-uuid', phone: '01000000000' }, { role: 'doctor' });
  assert.equal(invalid.code, 'invalid_patient');
  assert.throws(() => bridge.updatePrivateNote_({ patientId: '12345678-1234-4234-8234-123456789abc', phone: '01000000000' }, { role: 'secretary' }), /الصلاحية غير كافية/);
});

test('bridge health reports readiness without returning configuration values', () => {
  const properties = {};
  let triggerHandlers = [];
  const bridge = loadBridge({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '' }) },
    ScriptApp: { getProjectTriggers: () => triggerHandlers.map(name => ({ getHandlerFunction: () => name })) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: content => ({ content, setMimeType() { return this; } })
    }
  });

  let health = JSON.parse(bridge.doGet({}).content);
  assert.equal(health.status, 'needs_setup');
  assert.equal(health.configured, false);
  for (const name of ['WORKBOOK_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ATTACHMENTS_FOLDER_ID', 'NOTIFICATION_EMAIL']) {
    properties[name] = `synthetic-${name}`;
  }
  triggerHandlers = ['retryPendingSyncs'];
  health = JSON.parse(bridge.doGet({}).content);
  assert.equal(health.status, 'ready');
  assert.equal(health.configured, true);
  assert.equal(health.retryTriggerInstalled, true);
  assert.equal(JSON.stringify(health).includes('synthetic-'), false);
});

test('uses a Supabase secret key as apikey only and a publishable key with staff JWTs', () => {
  const properties = {
    SUPABASE_URL: 'https://clinic-test.supabase.co/',
    SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic'
  };
  const requests = [];
  const bridge = loadBridge({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '' }) },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => '[]' };
    } }
  });

  bridge.supabaseFetch_('/rest/v1/appointments', 'get', null, '', true);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options.headers)), { apikey: 'sb_secret_synthetic' });
  assert.equal(requests[0].url, 'https://clinic-test.supabase.co/rest/v1/appointments');

  bridge.supabaseFetch_('/auth/v1/user', 'get', null, 'synthetic-staff-jwt', false);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].options.headers)), {
    apikey: 'sb_publishable_synthetic',
    Authorization: 'Bearer synthetic-staff-jwt'
  });
});

test('staff authorization accepts only active doctor and secretary profiles', () => {
  const bridge = loadBridge();
  let role = 'doctor';
  bridge.supabaseFetch_ = endpoint => endpoint === '/auth/v1/user'
    ? { id: 'synthetic-user' }
    : [{ id: 'synthetic-user', full_name: 'Synthetic Staff', role }];

  assert.deepEqual(JSON.parse(JSON.stringify(bridge.authorizeStaff_('x'.repeat(48)))), {
    ok: true, id: 'synthetic-user', name: 'Synthetic Staff', role: 'doctor'
  });
  role = 'secretary';
  assert.equal(bridge.authorizeStaff_('x'.repeat(48)).ok, true);
  role = 'pending';
  assert.equal(bridge.authorizeStaff_('x'.repeat(48)).ok, false);
  assert.equal(bridge.authorizeStaff_('short').ok, false);
});

test('retry trigger installation is idempotent and uses a 10-minute interval', () => {
  let handlers = [];
  let interval;
  const bridge = loadBridge({
    ScriptApp: {
      getProjectTriggers: () => handlers.map(name => ({ getHandlerFunction: () => name })),
      newTrigger: name => ({
        timeBased() { return this; },
        everyMinutes(value) { interval = value; return this; },
        create() { handlers.push(name); return this; }
      })
    }
  });

  bridge.installRetryTrigger();
  bridge.installRetryTrigger();
  assert.deepEqual(handlers, ['retryPendingSyncs']);
  assert.equal(interval, 10);
});

test('shared dashboard settings read omits unused finance start date', () => {
  assert.doesNotMatch(dashboardSource, /from\('clinic_settings'\)\.select\([^)]*finance_start_date/);
  const settingsGrants = lockdownSource.match(/grant select[\s\S]*?on public\.clinic_settings to authenticated/gi) || [];
  assert.equal(settingsGrants.some(grant => grant.includes('finance_start_date')), false);
});

test('past active workflow records leave current queues but remain in the all-bookings history', () => {
  assert.match(dashboardSource, /function clinicToday\(\).*timeZone:'Africa\/Cairo'/);
  assert.match(dashboardSource, /function currentWorkflow\(a, statuses\).*a\.requested_date >= clinicToday\(\)/);
  assert.match(dashboardSource, /function activeBooking\(a\) \{ return currentWorkflow\(/);
  assert.match(dashboardSource, /function followUpNeeded\(a\) \{ return currentWorkflow\(/);
  assert.match(dashboardSource, /const matches = appointments\.filter\(a =>/);
});

test('cutover keeps role helpers private and restricts attachment bodies to the doctor RPC', () => {
  assert.match(lockdownSource, /create schema if not exists private/i);
  assert.match(lockdownSource, /grant execute on function private\.is_staff\(\) to authenticated/i);
  assert.match(lockdownSource, /revoke all on function public\.is_staff\(\) from public, anon, authenticated/i);
  const attachmentMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '14_doctor_only_attachments.sql'), 'utf8');
  assert.match(attachmentMigration, /revoke select \(attachment_base64\) on public\.appointments from public, anon, authenticated/i);
  assert.match(attachmentMigration, /if auth\.uid\(\) is null or not private\.is_doctor\(\)/i);
  assert.match(attachmentMigration, /grant execute on function public\.doctor_appointment_attachment\(bigint\) to authenticated/i);
  assert.match(dashboardSource, /rpc\('doctor_appointment_attachment'/);
  assert.doesNotMatch(dashboardSource, /from\('appointments'\)\.select\('attachment_base64/);
});

test('financial columns and finance settings are exposed only through doctor-checked RPCs', () => {
  const financeMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '09_role_financial_separation.sql'), 'utf8');
  assert.match(financeMigration, /revoke select \(amount_due, amount_paid, payment_method, payment_note,[\s\S]*?on public\.appointments from authenticated/i);
  assert.match(financeMigration, /revoke select \(service_prices, finance_enabled, finance_start_date\)[\s\S]*?on public\.clinic_settings from authenticated/i);
  assert.match(financeMigration, /create or replace function public\.doctor_finance_snapshot\(\)[\s\S]*?not private\.is_doctor\(\)/i);
  assert.match(financeMigration, /create or replace function public\.doctor_finance_settings\(\)[\s\S]*?not private\.is_doctor\(\)/i);
  assert.match(financeMigration, /create or replace function public\.record_appointment_completion\([\s\S]*?not private\.is_doctor\(\)/i);
});

test('secretary may record payment only after the doctor closes a visit', () => {
  const secretaryPayment = fs.readFileSync(path.join(__dirname, '..', 'supabase', '20_secretary_payment_only.sql'), 'utf8');
  assert.match(secretaryPayment, /create or replace function public\.staff_finance_enabled\(\)[\s\S]*?not private\.is_staff\(\)/i);
  assert.match(secretaryPayment, /returns boolean[\s\S]*?select s\.finance_enabled/i);
  assert.match(secretaryPayment, /create or replace function public\.staff_payment_available\(p_appointment_id bigint\)[\s\S]*?a\.status = 'completed'[\s\S]*?a\.amount_paid is null/i);
  assert.match(secretaryPayment, /create or replace function public\.record_appointment_completion\([\s\S]*?v_actor_role::text not in \('doctor','owner'\)[\s\S]*?only the doctor may close a visit/i);
  assert.match(secretaryPayment, /create or replace function public\.doctor_close_visit_without_payment\(p_appointment_id bigint\)[\s\S]*?private\.is_doctor\(\)[\s\S]*?set status = 'completed'/i);
  assert.match(secretaryPayment, /create or replace function public\.record_appointment_payment\([\s\S]*?p\.role = 'secretary'[\s\S]*?v_status <> 'completed'[\s\S]*?payment is already recorded/i);
  assert.match(secretaryPayment, /create trigger appointments_closed_case_sheet_archive[\s\S]*?amount_paid[\s\S]*?execute function public\.enqueue_closed_case_sheet_archive/i);
  assert.match(secretaryPayment, /create trigger guard_secretary_visit_closure[\s\S]*?private\.prevent_secretary_visit_closure/i);
  assert.match(secretaryPayment, /payment_recorded_by = v_actor/i);
  assert.match(secretaryPayment, /grant execute on function public\.staff_finance_enabled\(\) to authenticated/i);
  assert.match(dashboardSource, /profile\.role === 'secretary' && \(hasAssignedPermission\('payments\.record'\) \|\| hasAssignedPermission\('expenses\.add'\)\) \? supabase\.rpc\('staff_finance_enabled'\)/);
  assert.match(dashboardSource, /profile\?\.role === 'secretary' && appointment\.status === 'completed'[\s\S]*?staff_payment_available/i);
  assert.match(dashboardSource, /save\.dataset\.action = secretaryPayment \? 'save-secretary-payment' : 'save-appointment'/);
  assert.match(dashboardSource, /record_appointment_payment/);
  assert.match(dashboardSource, /doctor_close_visit_without_payment/);
  assert.match(dashboardSource, /if \(key === 'completed'\) return hasPermission\('visits\.close'\) \|\| \(a\.status === 'completed' && a\.staffPaymentAvailable && hasPermission\('payments\.record'\)\)/);
  assert.match(dashboardSource, /secretary \? '' : `<label class="field payment-note">/);
  assert.match(dashboardSource, /hasPermission\('births\.record'\) && a\.request_type === 'birth'/);
  assert.match(dashboardSource, /!secretary \? paymentAuditSection\(a\) : ''/);
});

test('dashboard limits finance projection by permissions and reserves finance RPCs for doctor and owner roles', () => {
  assert.match(dashboardSource, /function financeEnabled\(\) \{ return settings\?\.finance_enabled === true \|\| staffFinanceEnabled === true; \}/);
  assert.match(dashboardSource, /function priceForType\(type\) \{ return hasDoctorAccess\(\) \?/);
  assert.match(dashboardSource, /const appointmentFields = 'id,booking_code,patient_id,request_type,requested_date,last_visit_date,message,attachment_name,attachment_type,status,source,staff_note,created_at,updated_at,requested_time,is_waitlist,outcome_reason,outcome_note,contact_note,clinic_birth_recorded';/);
  assert.doesNotMatch(dashboardSource.match(/const appointmentFields = '[^']+';/)?.[0] || '', /amount_due|amount_paid|payment_method|payment_note/);
  assert.match(dashboardSource, /hasAssignedPermission\('finance\.view'\) \? supabase\.from\('payment_audit'\)/);
  assert.match(dashboardSource, /hasAssignedPermission\('expenses\.view'\) \? supabase\.from\('clinic_expenses'\)/);
  assert.match(dashboardSource, /hasAssignedPermission\('finance\.view'\) \? supabase\.rpc\('doctor_finance_snapshot'\)/);
  assert.match(dashboardSource, /\(hasAssignedPermission\('finance\.view'\) \|\| hasAssignedPermission\('settings\.view'\) \|\| hasAssignedPermission\('settings\.edit'\)\) \? supabase\.rpc\('doctor_finance_settings'\)/);
  assert.match(dashboardSource, /if \(hasAssignedPermission\('finance\.view'\)\) \{\s*const financeByAppointment = new Map/);
});

test('clinic expenses use a doctor-checked RPC and write a value-free audit trail', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261110211333_clinic_admin_write_rpcs_and_audit.sql'), 'utf8');
  assert.match(dashboardSource, /supabase\.rpc\('record_clinic_expense'/);
  assert.doesNotMatch(dashboardSource, /from\('clinic_expenses'\)\.insert/);
  assert.match(migration, /create or replace function public\.record_clinic_expense\([\s\S]*?not private\.is_doctor\(\)/i);
  assert.match(migration, /revoke all on function public\.record_clinic_expense\(date, text, numeric, text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.record_clinic_expense\(date, text, numeric, text\) to authenticated/i);
  assert.match(migration, /create or replace function public\.audit_clinic_expense_change\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(migration, /changed_fields[\s\S]*?v_fields[\s\S]*?expense_date[\s\S]*?category[\s\S]*?amount[\s\S]*?note/i);
  assert.doesNotMatch(migration, /insert into public\.clinic_admin_audit[\s\S]*?\b(old|new)\.(amount|note)\b/i);
  assert.match(migration, /using \(private\.is_doctor\(\)\)/i);
});

test('remaining clinic settings, private notes, and alert writes use role-checked RPCs', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261110211333_clinic_admin_write_rpcs_and_audit.sql'), 'utf8');
  assert.match(dashboardSource, /rpc\('save_clinic_settings'/);
  assert.doesNotMatch(dashboardSource, /from\('clinic_settings'\)\.update/);
  assert.match(dashboardSource, /rpc\('save_patient_private_note'/);
  assert.doesNotMatch(dashboardSource, /from\('patient_private_notes'\)\.upsert/);
  assert.match(dashboardSource, /rpc\('resolve_clinic_alerts'/);
  assert.doesNotMatch(dashboardSource, /from\('booking_alerts'\)\.update/);

  assert.match(migration, /create or replace function public\.save_clinic_settings\([\s\S]*?not private\.is_doctor\(\)/i);
  assert.match(migration, /create or replace function public\.save_patient_private_note\([\s\S]*?not private\.is_doctor\(\)/i);
  assert.match(migration, /create or replace function public\.resolve_clinic_alerts\([\s\S]*?not private\.is_staff\(\)/i);
  assert.match(migration, /grant execute on function public\.save_clinic_settings\([\s\S]*?to authenticated/i);
  assert.match(migration, /grant execute on function public\.save_patient_private_note\(uuid, text\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.resolve_clinic_alerts\(bigint\[\]\) to authenticated/i);
  assert.match(migration, /create trigger clinic_settings_audit[\s\S]*?execute function public\.audit_clinic_admin_change\(\)/i);
  assert.match(migration, /create trigger patient_private_notes_audit[\s\S]*?execute function public\.audit_clinic_admin_change\(\)/i);
  assert.match(migration, /create trigger booking_alerts_audit[\s\S]*?execute function public\.audit_clinic_admin_change\(\)/i);
  assert.match(migration, /v_fields := array\['private_note'\]/i);
  assert.doesNotMatch(migration, /insert into public\.clinic_admin_audit[\s\S]*?private_note\s*,\s*(?:old\.|new\.)?private_note/i);
});

test('rejects an unrecognized workflow status', () => {
  const bridge = loadBridge();
  assert.throws(() => bridge.sanitizeAppointmentUpdate_({ status: 'admin' }, 'doctor'), /حالة الحجز غير معتمدة/);
});

test('historical reconciliation preview returns reviewable matches without writing', () => {
  const bridge = loadBridge();
  const rows = [
    ['ID','Name','Phone','Type','Booking Date'],
    ['S-1','Unique Patient','01000000001','كشف أول مرة','2026-09-01'],
    ['S-2','Ambiguous Patient','01000000002','كشف متابعة','2026-09-02'],
    ['S-3','Unmatched Patient','01000000003','استشارة متابعة','2026-09-03'],
    ['S-4','Duplicate Composite','01000000001','كشف أول مرة','2026-09-01'],
    ['S-1','Duplicate Code','01000000004','كشف أول مرة','2026-09-04']
  ];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(row, column, rowCount = 1, columnCount = 1) {
      const slice = rows.slice(row - 1, row - 1 + rowCount).map(line => line.slice(column - 1, column - 1 + columnCount));
      return {
        getDisplayValues: () => slice.map(line => line.map(value => String(value ?? ''))),
        getValues: () => slice,
        getDisplayValue: () => String(rows[row - 1]?.[column - 1] ?? ''),
        getValue: () => rows[row - 1]?.[column - 1] ?? ''
      };
    }
  };
  const dbRows = [
    { id: 41, booking_code:'DB-1', request_type:'first', requested_date:'2026-09-01', patients:{ full_name:'Unique Patient', phone:'01000000001' } },
    { id: 42, booking_code:'DB-2A', request_type:'follow', requested_date:'2026-09-02', patients:{ full_name:'Ambiguous Patient', phone:'01000000002' } },
    { id: 43, booking_code:'DB-2B', request_type:'follow', requested_date:'2026-09-02', patients:{ full_name:'Ambiguous Patient', phone:'01000000002' } }
  ];
  bridge.workbook_ = () => ({ getSheetByName: name => name === 'Sheet1' ? sheet : null });
  bridge.loadReconciliationRows_ = () => dbRows;
  const preview = bridge.runHistoricalReconciliationDryRun_();
  assert.equal(preview.mode, 'dry_run_only');
  assert.deepEqual(JSON.parse(JSON.stringify(preview.counts)), {
    sheetRows:5, exactCodeMatches:0, uniqueCompositeCandidates:1, ambiguousCandidates:1,
    unmatched:1, duplicateSheetRows:1, duplicateSheetCodes:1
  });
  assert.equal(preview.details.unique[0].candidateAppointmentId, '41');
  assert.equal(preview.details.unique[0].rowNumber, 2);
  assert.equal(preview.details.ambiguous[0].candidateCount, 2);
  assert.equal(preview.details.unmatched[0].bookingCode, 'S-3');
});

test('doctor reconciliation preview does not wait for the global write lock', () => {
  const bridge = loadBridge();
  let lockRequested = false;
  bridge.LockService = { getScriptLock() { lockRequested = true; return { waitLock() { throw new Error('lock must not be requested'); }, releaseLock() {} }; } };
  bridge.json_ = value => value;
  bridge.authorizeStaff_ = token => token === 'doctor-token'
    ? { ok:true, id:'doctor-test', role:'doctor', name:'Doctor Test' }
    : { ok:false };
  bridge.runHistoricalReconciliationDryRun_ = () => ({ status:'preview', counts:{ sheetRows:0 } });
  const response = bridge.doPost({ postData:{ contents:JSON.stringify({ action:'admin.reconcile.preview', accessToken:'doctor-token' }) } });
  assert.equal(response.status, 'preview');
  assert.equal(response.counts.sheetRows, 0);
  assert.equal(lockRequested, false);
});

test('unauthorized reconciliation preview is denied before any write lock or workbook access', () => {
  const bridge = loadBridge();
  let lockRequested = false;
  bridge.LockService = { getScriptLock() { lockRequested = true; return { waitLock() {}, releaseLock() {} }; } };
  bridge.json_ = value => value;
  bridge.authorizeStaff_ = () => ({ ok:false });
  const response = bridge.doPost({ postData:{ contents:JSON.stringify({ action:'admin.reconcile.preview', accessToken:'invalid-token' }) } });
  assert.equal(response.code, 'unauthorized');
  assert.equal(lockRequested, false);
});

test('public booking uses the configured Supabase booking function and keeps its service key server-side', () => {
  const edgeFunction = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-db-booking', 'index.ts'), 'utf8');
  assert.match(edgeFunction, /https:\/\/dokyy2\.github\.io/);
  assert.match(edgeFunction, /http:\/\/127\.0\.0\.1:5500/);
  assert.match(edgeFunction, /body\.action !== "booking\.create"/);
  assert.match(edgeFunction, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edgeFunction, /validateBookingAttachment\(body\.payload as Record<string, unknown>\)/);
  assert.ok(edgeFunction.indexOf('validateBookingAttachment(') < edgeFunction.indexOf('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), 'attachment validation must run before privileged credentials are read');
  assert.match(edgeFunction, /const rpcPayload = \{ \.\.\.attachmentCheck\.payload, _rateLimitKey: rateLimitKey \}/);
  assert.match(edgeFunction, /body: JSON\.stringify\(\{ payload: rpcPayload \}\)/);
  assert.match(edgeFunction, /Authorization: `Bearer \$\{serviceRoleKey\}`/);
  const functionConfig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  assert.match(functionConfig, /\[functions\.clinic-db-booking\][\s\S]*verify_jwt = false/);
  assert.match(bridgeClientSource, /window\.CLINIC_BOOKING_FUNCTION \|\| 'clinic-db-booking'/);
  assert.match(bridgeClientSource, /if \(accessToken\) headers\.Authorization = `Bearer \$\{accessToken\}`/);
  assert.match(bridgeClientSource, /credentials: 'omit'/);
  assert.match(bridgeClientSource, /fetch\s*\(/);
});

test('server attachment validator accepts empty attachments and matching PDF/image signatures', async () => {
  const { validateBookingAttachment } = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-db-booking', 'attachment-validation.mjs')).href);
  const encode = bytes => Buffer.from(bytes).toString('base64');
  assert.equal(validateBookingAttachment({}).ok, true);
  for (const [name, type, bytes] of [
    ['proof.pdf', 'application/pdf', Buffer.from('%PDF-1.7')],
    ['proof.png', 'image/png', Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],
    ['proof.jpg', 'image/jpeg', Buffer.from([0xff,0xd8,0xff,0xd9])],
    ['proof.webp', 'image/webp', Buffer.from('RIFF0000WEBP')],
  ]) {
    assert.equal(validateBookingAttachment({ attachmentName:name, attachmentType:type, attachmentBase64:encode(bytes) }).ok, true, name);
  }
});

test('server attachment validator rejects incomplete, malformed, oversized, unsafe, and mismatched files', async () => {
  const { validateBookingAttachment } = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-db-booking', 'attachment-validation.mjs')).href);
  const validPdf = { attachmentName:'proof.pdf', attachmentType:'application/pdf', attachmentBase64:Buffer.from('%PDF-1.7').toString('base64') };
  assert.equal(validateBookingAttachment({ attachmentName:'proof.pdf' }).ok, false);
  assert.equal(validateBookingAttachment({ ...validPdf, attachmentBase64:'***' }).ok, false);
  assert.equal(validateBookingAttachment({ ...validPdf, attachmentType:'image/png' }).ok, false);
  assert.equal(validateBookingAttachment({ ...validPdf, attachmentType:'image/svg+xml', attachmentBase64:Buffer.from('<svg/>').toString('base64') }).ok, false);
  assert.equal(validateBookingAttachment({ ...validPdf, attachmentBase64:Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }).ok, false);
  assert.equal(validateBookingAttachment({ ...validPdf, attachmentName:'x'.repeat(181) + '.pdf' }).ok, false);
  const sanitized = validateBookingAttachment({ ...validPdf, attachmentName:'folder\\proof.pdf' });
  assert.equal(sanitized.ok, true);
  assert.equal(sanitized.payload.attachmentName, 'folder_proof.pdf');
});

test('booking attachment reader rejects oversized and unreadable files instead of submitting an empty attachment', async () => {
  const match = bookingSource.match(/function fileToBase64\(file\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'attachment reader should exist');
  const makeReader = mode => class {
    readAsDataURL() {
      if (mode === 'error') this.onerror();
      else {
        this.result = mode === 'empty' ? null : 'data:application/pdf;base64,QUJD';
        this.onload();
      }
    }
  };
  const createReader = mode => vm.runInNewContext(`(${match[0]})`, {
    MAX_BOOKING_ATTACHMENT_BYTES:5 * 1024 * 1024,
    currentLang:'ar',
    FileReader:makeReader(mode)
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await createReader('ok')({ name:'sample.pdf', type:'application/pdf', size:4 }))), {
    attachmentName:'sample.pdf', attachmentType:'application/pdf', attachmentBase64:'QUJD'
  });
  await assert.rejects(createReader('ok')({ name:'large.pdf', type:'application/pdf', size:5 * 1024 * 1024 + 1 }), /أكبر من 5 ميجابايت/);
  await assert.rejects(createReader('error')({ name:'broken.pdf', type:'application/pdf', size:4 }), /تعذر قراءة الملف/);
  await assert.rejects(createReader('empty')({ name:'empty.pdf', type:'application/pdf', size:4 }), /تعذر قراءة الملف كاملًا/);
});

test('iframe bridge dispatches the read-only doctor preview without taking the write lock', () => {
  const bridge = loadBridge();
  let lockRequested = false;
  bridge.LockService = { getScriptLock() { lockRequested = true; throw new Error('preview must not lock'); } };
  bridge.authorizeStaff_ = token => token === 'doctor-token'
    ? { ok:true, id:'doctor-test', role:'doctor', name:'Doctor Test' }
    : { ok:false };
  bridge.runHistoricalReconciliationDryRun_ = () => ({ status:'preview', counts:{ sheetRows:2 } });
  const response = bridge.bridgeRpc({ action:'admin.reconcile.preview', accessToken:'doctor-token', payload:{} });
  assert.equal(response.status, 'preview');
  assert.equal(response.counts.sheetRows, 2);
  assert.equal(lockRequested, false);
});

test('historical linking revalidates a unique exact candidate and rejects ambiguity', () => {
  const bridge = loadBridge();
  const sheetValues = { booking_code:'S-1', full_name:'Patient', phone:'01000000001', request_type:'first', requested_date:'2026-09-01' };
  const candidate = { id:41, booking_code:'DB-1', request_type:'first', requested_date:'2026-09-01', patients:{ full_name:'Patient', phone:'01000000001' } };
  bridge.readReconciliationSheetRow_ = () => sheetValues;
  bridge.loadReconciliationRows_ = () => [candidate];
  const payload = { sheetName:'Sheet1', rowNumber:2, bookingCode:'S-1', candidateAppointmentId:'41', candidateBookingCode:'DB-1' };
  assert.equal(bridge.validateHistoricalCandidate_(payload).candidate.id, 41);
  const ambiguous = { ...candidate, id:42, booking_code:'DB-2' };
  bridge.loadReconciliationRows_ = () => [candidate, ambiguous];
  assert.throws(() => bridge.validateHistoricalCandidate_(payload), /ambiguous and requires explicit doctor review/);
  assert.equal(bridge.validateHistoricalCandidate_({ ...payload, allowAmbiguous:true }).candidate.id, 41);
  bridge.loadReconciliationRows_ = () => [candidate];
  bridge.readReconciliationSheetRow_ = () => ({ ...sheetValues, phone:'01099999999' });
  assert.throws(() => bridge.validateHistoricalCandidate_(payload), /selected candidate is no longer an exact match/);
});

test('only the doctor can approve a historical link and approval is queued for retry', () => {
  const bridge = loadBridge();
  let audit, queued;
  bridge.validateHistoricalCandidate_ = () => ({ bookingCode:'S-1', values:{ status:'completed' }, candidate:{ id:41, booking_code:'DB-1', status:'new' } });
  bridge.recordAudit_ = event => { audit = event; return event.eventId; };
  bridge.enqueue_ = (id, action, key, payload) => { queued = { id, action, key, payload }; return id; };
  bridge.processOutbox_ = () => ({ ok:true, sheetSaved:true });
  const payload = { sheetName:'Sheet1', rowNumber:2, bookingCode:'S-1', candidateAppointmentId:'41', candidateBookingCode:'DB-1' };
  assert.throws(() => bridge.linkHistoricalMatch_(payload, { role:'secretary' }), /الصلاحية غير كافية/);
  const result = bridge.linkHistoricalMatch_(payload, { id:'doctor-id', name:'Doctor', role:'doctor' });
  assert.equal(result.syncStatus, 'synced');
  assert.equal(audit.action, 'admin.reconcile.link');
  assert.equal(queued.action, 'admin.reconcile.link');
  assert.equal(queued.payload.candidateAppointmentId, '41');
});

test('historical projection link preserves fields absent from the canonical Sheet', () => {
  const bridge = loadBridge();
  const calls = [];
  bridge.validateHistoricalCandidate_ = () => ({
    bookingCode:'S-1',
    values:{ booking_code:'S-1', phone:'01000000001', full_name:'Patient', request_type:'first', requested_date:'2026-09-01' },
    candidate:{ id:41, booking_code:'DB-1', status:'completed' }
  });
  bridge.supabaseFetch_ = (url, method, body, token, secret, prefer) => {
    calls.push({ url, method, body, prefer });
    if (method === 'patch') return [{ id:41 }];
    return [{ id:'patient-id' }];
  };
  bridge.insertOnce_ = () => ({ id:1 });
  const result = bridge.applyHistoricalProjectionLink_({ approvedBy:'doctor-id', event:{ eventId:'event-id', note:'approved' } });
  assert.equal(result.status, 'success');
  const update = calls.find(call => call.method === 'patch');
  assert.equal(update.body.booking_code, 'S-1');
  assert.equal(update.body.status, undefined);
  assert.equal(update.body.amount_paid, undefined);
  assert.equal(calls.some(call => call.url.includes('/patients?on_conflict=phone')), true);
});

test('historical projection maps an empty staff note to an empty string, not SQL NULL', () => {
  const bridge = loadBridge();
  const calls = [];
  bridge.validateHistoricalCandidate_ = () => ({
    bookingCode:'S-2',
    values:{ booking_code:'S-2', phone:'01000000002', full_name:'Patient Two', request_type:'first', requested_date:'2026-09-02', staff_note:'' },
    candidate:{ id:42, booking_code:'DB-2', status:'completed' }
  });
  bridge.supabaseFetch_ = (url, method, body, token, secret, prefer) => {
    calls.push({ url, method, body, prefer });
    if (method === 'patch') return [{ id:42 }];
    return [{ id:'patient-id' }];
  };
  bridge.insertOnce_ = () => ({ id:2 });
  bridge.applyHistoricalProjectionLink_({ approvedBy:'doctor-id', event:{ eventId:'event-id-2', note:'approved' } });
  const update = calls.find(call => call.method === 'patch');
  assert.equal(update.body.staff_note, '');
});

test('team management reserves the five-seat cap under a serialized doctor-only database lock', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '15_clinic_team_management.sql'), 'utf8');
  assert.match(migration, /private\.clinic_team_invite_reservations/i);
  assert.match(migration, /perform 1 from public\.clinic_settings where id = true for update/i);
  assert.match(migration, /v_active \+ v_reserved >= 5/i);
  assert.match(migration, /create table if not exists public\.clinic_team_events/i);
  assert.match(migration, /complete_clinic_team_invite/i);
  assert.match(migration, /values \(auth\.uid\(\), p_user_id, v_reservation\.email, 'invited'/i);
  assert.match(migration, /if auth\.uid\(\) is null or not private\.is_doctor\(\)/i);
  assert.match(migration, /cannot remove the last doctor/i);
  assert.match(migration, /revoke all on function public\.(?:reserve_clinic_team_invite|release_clinic_team_invite|change_clinic_team_role)/i);
  assert.match(migration, /grant execute on function public\.change_clinic_team_role\(uuid, public\.user_role\) to authenticated/i);
});

test('team administration keeps Auth Admin credentials server-side and checks the caller permission', () => {
  const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-team-admin', 'index.ts'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.js'), 'utf8');
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /ACTIVE_TEAM_ROLES\.has\(String\(actor\?\.role \|\| ""\)\)/);
  assert.match(edge, /rpc\("my_clinic_permissions", \{\}\)/);
  assert.match(edge, /permissions\.has\("team\.view"\)/);
  assert.match(edge, /permissions\.has\("team\.invite"\)/);
  assert.match(edge, /reserve_clinic_team_invite/);
  assert.match(edge, /change_clinic_team_role/);
  assert.match(edge, /clinic_team_events/);
  assert.match(edge, /audit:teamEvents|audit,/);
  assert.match(edge, /team\.disable/);
  assert.match(edge, /\["http:\/\/127\.0\.0\.1:5500", "http:\/\/127\.0\.0\.1:5500\/dashboard\/"\]/);
  assert.match(edge, /if \(!redirectTo\) return json/);
  assert.match(edge, /existingUsers\.some\(\(user: any\) => String\(user\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\) === email\)/);
  const activationFailure = edge.match(/if \(!profileActivated\.ok\) \{([\s\S]*?)\n\s*\}\n\s*return json/);
  assert.ok(activationFailure, 'invite activation failure path should be explicit');
  assert.match(activationFailure[1], /release_clinic_team_invite/);
  assert.match(activationFailure[1], /بلا وصول للوحة/);
  assert.doesNotMatch(activationFailure[1], /ban_duration/);
  assert.doesNotMatch(dashboard, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.match(dashboard, /hasPermission\('team\.invite'\) \? `<section class="panel"><div class="panel-title"><div><h2>إضافة عضو للفريق/);
  assert.match(dashboard, /app\.onsubmit = event => \{ if \(event\.target\?\.id === 'teamInviteForm'\) submitTeamInvite\(event\); \};/);
  assert.doesNotMatch(dashboard, /getElementById\('teamInviteForm'\)\?\.addEventListener\('submit'/);
  assert.match(dashboard, /\['invite', 'recovery'\]\.includes\(authLinkType\)/);
  assert.match(dashboard, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(dashboard, /history\.replaceState\(\{\}, document\.title, location\.pathname\)/);
  assert.match(dashboard, /isOwner\(\) \? 'غرفة التحكم' : 'إدارة الفريق'/);
});

test('team admin edge gate checks origin, live session, and active staff before permission checks', () => {
  const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-team-admin', 'index.ts'), 'utf8');
  const originGate = edge.indexOf('if (origin && !ALLOWED_ORIGINS.has(origin))');
  const userVerification = edge.indexOf('api("/auth/v1/user", "GET", anonKey, token)');
  const roleGate = edge.indexOf('ACTIVE_TEAM_ROLES.has(String(actor?.role || ""))');
  const firstPrivilegedAction = edge.indexOf('if (input.action === "team.list")');
  assert.ok(originGate >= 0 && originGate < userVerification, 'reject untrusted browser origins before handling the request');
  assert.ok(userVerification < roleGate && roleGate < firstPrivilegedAction, 'verify the bearer session and active staff role before permission-checked team actions');
  assert.match(edge, /team\.list"\) \{\s*if \(actor\.role !== "owner" && !permissions\.has\("team\.view"\)\)/);
  assert.match(edge, /team\.invite"\) \{\s*if \(actor\.role !== "owner" && !permissions\.has\("team\.invite"\)\)/);
  assert.match(edge, /"Vary":\s*"Origin"/);
  assert.match(edge, /if \(origin && ALLOWED_ORIGINS\.has\(origin\)\)[\s\S]*Access-Control-Allow-Origin/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin"\]\s*=\s*["']\*["']/);
  assert.match(edge, /declared > 16_384/);
  assert.match(edge, /raw\.length > 16_384/);
  assert.match(edge, /signal: AbortSignal\.timeout\(15_000\)/);
});

test('read-only role check permits staff workflow validation and never writes records', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'verify_role_boundaries_readonly.sql'), 'utf8');
  assert.match(sql, /private\.is_staff\(\) is not true/i);
  assert.match(sql, /private\.is_doctor\(\) is not false/i);
  assert.match(sql, /exception when no_data_found then null/i, 'staff workflow uses a nonexistent appointment');
  assert.match(sql, /exception when invalid_parameter_value then null/i, 'staff manual booking uses incomplete input');
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public\.|delete\s+from|commit)\b/i);
  assert.match(sql, /doctor-only calls; staff workflow\/manual paths reached validation without writes/i);
});

test('public browser assets contain no Supabase service-role credentials', () => {
  const root = path.join(__dirname, '..');
  const clientFiles = [
    'index.html', 'dashboard/index.html', 'dashboard/dashboard.js',
    'staff-access/index.html', 'staff-access/app.js', 'js/main.js',
    'js/gallery.js', 'js/config.js', 'js/bridge-client.js', 'js/admin-experience-v25.js'
  ];
  for (const file of clientFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{20,}/, `service credential marker found in ${file}`);
    for (const match of source.matchAll(/\b([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{20,})\b/g)) {
      let claims;
      try { claims = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8')); } catch { continue; }
      assert.notEqual(claims.role, 'service_role', `service-role JWT found in ${file}`);
    }
  }
});

function archiveSheetFixture(failWrites = 0) {
  const sheet = {
    rows: [],
    getLastRow() { return this.rows.length; },
    getLastColumn() { return this.rows[0]?.length || 0; },
    setFrozenRows() {},
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        setValues: values => {
          if (failWrites > 0) { failWrites -= 1; throw new Error('synthetic sheet write failure'); }
          while (sheet.rows.length < row + rowCount - 1) sheet.rows.push([]);
          values.forEach((line, index) => { sheet.rows[row + index - 1] = line.slice(0, columnCount); });
        },
        setFontWeight() {}
      };
    }
  };
  return sheet;
}

function archiveFixtureBridge({ failWrites = 0, status = 'completed' } = {}) {
  const bridge = loadBridge();
  const sheet = archiveSheetFixture(failWrites);
  const record = {
    appointment_id: 4242,
    booking_code: 'TEST-ARCHIVE-4242',
    payload: {
      appointment_id: 4242, booking_code: 'TEST-ARCHIVE-4242',
      full_name: 'Synthetic Archive Patient', phone: '01000004242',
      request_type: 'first', requested_date: '2026-11-10', requested_time: '16:00',
      status, amount_due: 500, amount_paid: 500,
      payment_method: 'cash', attachment_name: 'test.pdf', attachment_type: 'application/pdf'
    },
    attempts: 0,
    sync_status: 'pending',
    last_error: null
  };
  bridge.getOrCreate_ = (_name, headers) => {
    if (!sheet.rows.length) sheet.rows.push(headers.slice());
    return sheet;
  };
  bridge.findHeader_ = (currentSheet, aliases) => {
    const header = currentSheet.rows[0] || [];
    const index = header.findIndex(value => aliases.includes(value));
    return index < 0 ? 0 : index + 1;
  };
  bridge.rowByValue_ = (currentSheet, column, value) => {
    const index = currentSheet.rows.findIndex((row, rowIndex) => rowIndex > 0 && String(row[column - 1]) === String(value));
    return index < 0 ? 0 : index + 1;
  };
  bridge.supabaseFetch_ = (url, method, body) => {
    if (method === 'get') {
      if (record.sync_status === 'synced' && !url.includes('sync_status=eq.pending')) return [record];
      if (url.includes('sync_status=eq.pending')) return record.sync_status === 'pending' ? [record] : [];
      return record.sync_status === 'pending' ? [record] : [];
    }
    if (method === 'patch') Object.assign(record, body);
    return [];
  };
  return { bridge, record, sheet };
}

test('closed-case archive writes one workbook row and repeated requests remain idempotent', () => {
  const { bridge, record, sheet } = archiveFixtureBridge();
  const first = bridge.processClosedCaseArchive_({ appointmentId: 4242 }, { role: 'secretary' });
  assert.equal(first.status, 'success');
  assert.equal(record.sync_status, 'synced');
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][0], 4242);
  assert.equal(sheet.rows[1][2], 'Synthetic Archive Patient');
  assert.equal(sheet.rows[1][20], 500);
  assert.equal(sheet.rows[1][21], 500);
  assert.equal(sheet.rows[1][22], 'نقدًا');
  assert.equal(sheet.rows[0].some(header => /base64/i.test(header)), false);

  const retry = bridge.processClosedCaseArchive_({ appointmentId: 4242 }, { role: 'secretary' });
  assert.equal(retry.status, 'success');
  assert.equal(retry.alreadyArchived, true);
  assert.equal(sheet.rows.length, 2);
});

test('failed closed-case workbook write is queued and the retry worker archives it once', () => {
  const { bridge, record, sheet } = archiveFixtureBridge({ failWrites: 1 });
  const first = bridge.processClosedCaseArchive_({ appointmentId: 4242 }, { role: 'doctor' });
  assert.equal(first.status, 'error');
  assert.equal(first.code, 'archive_pending');
  assert.equal(record.sync_status, 'pending');
  assert.equal(record.last_error, 'sheet_export_failed');
  assert.equal(sheet.rows.length, 1);

  bridge.retryPendingClosedCaseArchives_();
  assert.equal(record.sync_status, 'synced');
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][0], 4242);
});

test('closed-case archive refuses a snapshot whose identity differs from its queue record', () => {
  const { bridge, record, sheet } = archiveFixtureBridge();
  record.payload.appointment_id = 4243;
  const result = bridge.processClosedCaseArchive_({ appointmentId: 4242 }, { role: 'doctor' });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'archive_pending');
  assert.equal(sheet.rows.length, 0);
  assert.equal(record.sync_status, 'pending');
});

test('no-show closed cases are accepted by the Sheet archive and keep their status label', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '17_archive_no_show_cases.sql'), 'utf8');
  assert.match(migration, /new\.status not in \('completed','cancelled','no_show'\)/i);
  const { bridge, sheet } = archiveFixtureBridge({ status:'no_show' });
  const result = bridge.processClosedCaseArchive_({ appointmentId: 4242 }, { role:'doctor' });
  assert.equal(result.status, 'success');
  assert.equal(sheet.rows[1][15], 'لم تحضر');
});

test('admin workflow changes and audit events are committed through one staff-only RPC', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '16_atomic_staff_workflow.sql'), 'utf8');
  const workflow = migration.match(/create or replace function public\.record_appointment_workflow\(([\s\S]*?)\n\$\$;/i);
  assert.ok(workflow, 'atomic workflow RPC should exist');
  assert.match(workflow[1], /security definer/i);
  assert.match(workflow[1], /set search_path = pg_catalog, public, private/i);
  assert.match(workflow[1], /v_actor is null or not private\.is_staff\(\)/i);
  assert.match(workflow[1], /where id = p_appointment_id for update/i);
  assert.match(workflow[1], /v_current\.status is distinct from p_expected_status/i);
  assert.match(workflow[1], /clinic is closed on the selected date/i, 'reschedules must respect clinic closures');
  assert.match(workflow[1], /clinic-booking-phone:[\s\S]*?a\.status in \('new','contacted','confirmed','rescheduled','follow_up'\)/i, 'reschedules must share the duplicate-booking lock and reject another active booking');
  assert.match(workflow[1], /clinic-booking-date:[\s\S]*?v_booked_count >= v_settings\.max_daily_slots/i, 'reschedules must respect daily capacity under the booking-date lock');
  assert.match(workflow[1], /v_current\.request_type <> 'birth'/i, 'birth bookings keep the existing closed-day exception');
  assert.match(workflow[1], /update public\.appointments set[\s\S]*?insert into public\.appointment_events/i);
  assert.match(migration, /Expand-only rollout: keep the existing authenticated table grants intact/i);
  assert.doesNotMatch(migration, /revoke\s+(?:insert|update).*from authenticated/is, 'expand migration must preserve grants used by the published client');
  assert.match(dashboardSource, /rpc\('record_appointment_workflow'/);
  assert.doesNotMatch(dashboardSource, /from\('appointments'\)\.update\(update\)/);
  assert.match(dashboardSource, /const closesCase = \['completed','cancelled','no_show'\]\.includes\(status\);\s*const closedCaseArchived = closesCase \? await archiveClosedCaseToSheet\(id\) : null;/);
});

test('manual bookings use an idempotent atomic RPC and preserve the audit event', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '16_atomic_staff_workflow.sql'), 'utf8');
  const manual = migration.match(/create or replace function public\.create_manual_appointment\(([\s\S]*?)\n\$\$;/i);
  assert.ok(manual, 'manual appointment RPC should exist');
  assert.match(manual[1], /v_actor is null or not private\.is_staff\(\)/i);
  assert.match(manual[1], /pg_advisory_xact_lock\(hashtextextended\('manual-booking:'/i);
  assert.match(manual[1], /clinic-booking-phone:/i, 'manual bookings share the public booking phone lock');
  assert.match(manual[1], /clinic-booking-phone:[\s\S]*?where a\.patient_id = p_patient_id/i, 'the shared lock is acquired before duplicate detection');
  assert.match(manual[1], /where source_event_id = p_request_key::text/i);
  assert.match(manual[1], /insert into public\.appointments[\s\S]*?insert into public\.appointment_events/i);
  assert.match(manual[1], /'already_created', true/i);
  assert.match(dashboardSource, /rpc\('create_manual_appointment'/);
  assert.match(dashboardSource, /modal\.dataset\.manualRequestId \|\|= window\.crypto\.randomUUID\(\)/);
  assert.doesNotMatch(dashboardSource, /from\('appointments'\)\.insert\(\{ patient_id:patientId/);
});

test('rollback-only SQL validator exercises the exact workflow RPC definitions', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '16_atomic_staff_workflow.sql'), 'utf8').replace(/\r\n/g, '\n');
  const validator = fs.readFileSync(path.join(__dirname, '..', 'supabase', '16_atomic_staff_workflow_VALIDATE_ROLLBACK_ONLY.sql'), 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['record_appointment_workflow','create_manual_appointment']) {
    const start = `create or replace function public.${name}(`;
    const extract = source => {
      const offset = source.indexOf(start);
      if (offset < 0) return null;
      const end = source.indexOf('\n$$;', offset);
      return end < 0 ? null : source.slice(offset, end + 4);
    };
    assert.equal(extract(validator), extract(migration), `${name} should match between migration and rollback validator`);
  }
  const archiveMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '17_archive_no_show_cases.sql'), 'utf8').replace(/\r\n/g, '\n');
  const archiveStart = 'create or replace function public.enqueue_closed_case_sheet_archive()';
  const extractArchive = source => {
    const offset = source.indexOf(archiveStart);
    if (offset < 0) return null;
    const end = source.indexOf('\n$$;', offset);
    return end < 0 ? null : source.slice(offset, end + 4);
  };
  assert.equal(extractArchive(validator), extractArchive(archiveMigration), 'no-show archive trigger function should match migration 17');
  assert.match(validator, /payload ->> 'status' <> 'no_show'/i, 'rollback validation should assert a no-show archive snapshot');
  assert.match(validator, /reschedule to a date with another active booking unexpectedly succeeded/i, 'rollback validation should exercise duplicate reschedule rejection');
  assert.match(validator, /reschedule beyond daily capacity unexpectedly succeeded/i, 'rollback validation should exercise capacity rejection');
  assert.match(validator, /reschedule on a closed date unexpectedly succeeded/i, 'rollback validation should exercise closed-date rejection');
  assert.match(validator, /expand-only validation found a legacy client grant was removed/i, 'rollback validation should ensure legacy client write privileges remain available');
  assert.doesNotMatch(validator, /direct (?:status update|appointment insert|audit event insert) unexpectedly succeeded/i, 'rollback validation must not expect legacy direct writes to be revoked');
  assert.equal((validator.match(/^begin;\s*$/gim) || []).length, 1, 'rollback validator should open one transaction');
  assert.equal((validator.match(/^rollback;\s*$/gim) || []).length, 1, 'rollback validator should end with one rollback');
  assert.equal((validator.match(/^commit;\s*$/gim) || []).length, 0, 'rollback validator must not commit');
});

test('permission matrix requires readable scopes for actions and unique named groups', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261114120000_permission_enforcement_and_named_profiles.sql'), 'utf8');
  assert.match(migration, /v_selected := private\.expand_clinic_permissions\(v_selected\)/i);
  assert.match(migration, /appointments\.manage' then array\['appointments\.view','patients\.view'\]/i);
  assert.match(migration, /attachments\.view' then array\['appointments\.view'\]/i);
  assert.match(migration, /visits\.close' then array\['appointments\.view','patients\.view'\]/i);
  assert.match(migration, /clinic_permission_profiles_owner_name_ci_uq/i);
  assert.match(migration, /clinic_member_permissions_manual_name_ci_uq/i);
  assert.match(migration, /permission profile name already exists/i);
  assert.match(migration, /permission set name already exists/i);
  assert.match(migration, /p_template_role not in \('doctor','assistant','secretary'\)/i);
  assert.match(migration, /v_role is null or v_role not in \('owner','doctor','secretary'\) then return false/i);
  assert.match(migration, /permission profile is assigned to one or more accounts/i);
  assert.match(migration, /function public\.reserve_clinic_team_invite\([\s\S]*?has_clinic_permission\('team\.invite'\)/i);
  assert.match(migration, /function public\.complete_clinic_team_invite\([\s\S]*?has_clinic_permission\('team\.invite'\)/i);
  assert.match(dashboardSource, /permission_template_role/);
  assert.match(dashboardSource, /function canOpenView\(view\) \{ return hasPermission\(VIEW_PERMISSIONS\[view\]\)/);
  assert.match(dashboardSource, /withPermissionDependencies\(selected\)/);
  assert.match(dashboardSource, /عند اختيار إجراء، ستُحدد صلاحيات العرض اللازمة له تلقائيًا/);
});

test('appointment payment history is not readable from the general appointment query', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261114120000_permission_enforcement_and_named_profiles.sql'), 'utf8');
  assert.match(migration, /revoke select \(amount_due,amount_paid,payment_method,payment_note,payment_recorded_by,payment_recorded_at\)\s+on public\.appointments from public,anon,authenticated/i);
  assert.match(migration, /function public\.doctor_finance_snapshot\(\)[\s\S]*?has_clinic_permission\('finance\.view'\)/i);
  assert.match(migration, /function public\.record_appointment_completion\([\s\S]*?has_clinic_permission\('visits\.close'\)[\s\S]*?has_clinic_permission\('payments\.record'\)/i);
  assert.match(migration, /function public\.record_appointment_payment\([\s\S]*?has_clinic_permission\('payments\.record'\)[\s\S]*?visit must be closed and unpaid before payment entry/i);
  assert.match(migration, /function public\.doctor_appointment_attachment\([\s\S]*?has_clinic_permission\('attachments\.view'\)/i);
  assert.match(dashboardSource, /installPermissionRefresh\(\)/);
  assert.match(dashboardSource, /window\.addEventListener\('focus', refreshPermissionsIfChanged\)/);
  assert.match(dashboardSource, /document\.addEventListener\('visibilitychange'/);
});

