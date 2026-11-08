const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'js', 'main.js'), 'utf8');
const start = mainSource.indexOf('function makeClientBookingCode(');
const end = mainSource.indexOf('\nfunction pushBookingResult(', start);
assert.notEqual(start, -1, 'booking-code functions exist');
assert.notEqual(end, -1, 'booking-code function boundary exists');
const bookingCodeSource = mainSource.slice(start, end);

function makeContext(initialCode = '') {
  const context = {
    currentBookingCode: initialCode,
    history: {
      state: { clinicSite: true, clinicBookingView: 'form' },
      replaceState(state) { this.state = state; },
    },
    location: { href: 'http://localhost/' },
    todayISO: () => '2026-11-08',
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
  };
  vm.createContext(context);
  vm.runInContext(bookingCodeSource, context);
  return context;
}

test('booking id is regenerated for the chosen future date', () => {
  const context = makeContext('BK-20261108-AAAAAAAA');
  const bookingCode = vm.runInContext('ensureClientBookingCode("first", "2026-11-10")', context);
  assert.match(bookingCode, /^BK-20261110-[A-F0-9]{8}$/);
  assert.equal(context.history.state.bookingCode, bookingCode);
});

test('same-date retry keeps its booking idempotency key', () => {
  const context = makeContext('BK-20261110-BBBBBBBB');
  const bookingCode = vm.runInContext('ensureClientBookingCode("birth", "2026-11-10")', context);
  assert.equal(bookingCode, 'BK-20261110-BBBBBBBB');
});

test('contact-only request keeps the contact code format', () => {
  const context = makeContext('C-AAAAAAAAAAAA');
  const bookingCode = vm.runInContext('ensureClientBookingCode("contacts", "")', context);
  assert.equal(bookingCode, 'C-AAAAAAAAAAAA');
});
