const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const bridgePath = path.join(__dirname, '..', 'google-apps-script', 'commercial', 'Code.gs');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.js'), 'utf8');
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

test('Edge Function proxy restricts actions and browser origins and requires a staff bearer token', () => {
  assert.match(bridgeHtmlSource, /https:\/\/dokyy2\.github\.io/);
  const edgeFunction = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'clinic-sheet-bridge', 'index.ts'), 'utf8');
  assert.match(edgeFunction, /http:\/\/127\.0\.0\.1:5500/);
  assert.match(edgeFunction, /http:\/\/localhost:5500/);
  assert.match(edgeFunction, /const ALLOWED_ACTIONS = new Set/);
  assert.match(edgeFunction, /!ALLOWED_ACTIONS\.has\(body\.action\)/);
  assert.match(edgeFunction, /bearer\.length < 40/);
  assert.match(edgeFunction, /accessToken: bearer/);
  assert.match(edgeFunction, /redirect: "follow"/);
  const functionConfig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  assert.match(functionConfig, /\[functions\.clinic-sheet-bridge\][\s\S]*verify_jwt = false/);
  assert.match(bridgeClientSource, /functions\/v1\/clinic-sheet-bridge/);
  assert.match(bridgeClientSource, /headers\.Authorization = `Bearer \$\{accessToken\}`/);
  assert.match(bridgeClientSource, /credentials: 'omit'/);
  assert.match(bridgeClientSource, /fetch\s*\(/);
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
