const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const bridgePath = path.join(__dirname, '..', 'google-apps-script', 'commercial', 'Code.gs');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.js'), 'utf8');
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
        getDisplayValues: () => rows.slice(row - 1, row - 1 + rowCount)
          .map(line => line.slice(column - 1, column - 1 + columnCount).map(value => String(value ?? '')))
      };
    }
  };
}

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
  for (const name of ['WORKBOOK_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'ATTACHMENTS_FOLDER_ID', 'NOTIFICATION_EMAIL']) {
    properties[name] = `synthetic-${name}`;
  }
  triggerHandlers = ['retryPendingSyncs'];
  health = JSON.parse(bridge.doGet({}).content);
  assert.equal(health.status, 'ready');
  assert.equal(health.configured, true);
  assert.equal(health.retryTriggerInstalled, true);
  assert.equal(JSON.stringify(health).includes('synthetic-'), false);
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

test('cutover keeps role helpers out of public RPCs and fetches attachments through the bridge', () => {
  assert.match(lockdownSource, /create schema if not exists private/i);
  assert.match(lockdownSource, /grant execute on function private\.is_staff\(\) to authenticated/i);
  assert.match(lockdownSource, /revoke all on function public\.is_staff\(\) from public, anon, authenticated/i);
  assert.match(lockdownSource, /drop function if exists public\.get_appointment_attachment\(bigint\)/i);
  assert.match(dashboardSource, /callSheetBridge\('attachment\.get'/);
  assert.doesNotMatch(dashboardSource, /rpc\('get_appointment_attachment'/);
});

test('rejects an unrecognized workflow status', () => {
  const bridge = loadBridge();
  assert.throws(() => bridge.sanitizeAppointmentUpdate_({ status: 'admin' }, 'doctor'), /حالة الحجز غير معتمدة/);
});
