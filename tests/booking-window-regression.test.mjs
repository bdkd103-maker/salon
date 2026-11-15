import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Isolation review: evaluate time helpers and selected route source only. The
// HTTP fixture uses in-memory Fastify injection and an explicitly fake store.
// No application imports, Prisma client, environment files or listening server.
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('backend/package.json', root));
const read = file => readFileSync(new URL(file, root), 'utf8');
const helper = read('backend/src/lib/booking-time.ts');
assert.doesNotMatch(helper, /\bimport\s/);
const routes = read('backend/src/routes/bookings.ts');
const start = routes.indexOf('function validateBookingWindow(');
const end = routes.indexOf('async function getSalonBookingContext(', start);
assert.ok(start >= 0 && end > start, 'pure validator source boundaries');
const context = vm.createContext({ Date, Intl, assert, test });
vm.runInContext(stripTypeScriptTypes(helper + '\n' + routes.slice(start, end)).replace(/^export /gm, ''), context, { timeout: 1000 });
const within = (start, end, zone = 'Europe/Berlin') => context.isWithinOperatingHours(start, end, zone, '09:00', '18:00');
const validate = (start, end) => context.validateBookingWindow(
  { openingTime: '09:00', closingTime: '18:00' },
  context.parseWallClockInTimeZone(start, 'Europe/Berlin'),
  context.parseWallClockInTimeZone(end, 'Europe/Berlin'),
  'Europe/Berlin', 60,
);

test('daytime booking cannot span a closed night even when both clock times fit', () => {
  assert.equal(within('2026-09-07T17:00', '2026-09-08T10:00'), false);
});

test('daytime booking cannot span one or more complete days', () => {
  assert.equal(within('2026-09-07T09:00', '2026-09-08T09:00'), false);
  assert.equal(within('2026-09-07T09:00', '2026-09-09T18:00'), false);
});

test('containment compares full local dates across month and year boundaries', () => {
  assert.equal(within('2026-08-31T17:00', '2026-09-01T10:00'), false);
  assert.equal(within('2026-12-31T17:00', '2027-01-01T10:00'), false);
});

test('valid same-day boundaries and outside-hours rejection remain unchanged', () => {
  assert.equal(within('2026-09-07T09:00', '2026-09-07T18:00'), true);
  assert.equal(within('2026-09-07T08:59', '2026-09-07T10:00'), false);
  assert.equal(within('2026-09-07T17:00', '2026-09-07T18:01'), false);
});

test('day containment uses salon-local dates even if UTC dates differ', () => {
  // Local 16:00 -> 18:00 spans 23:00Z -> 01:00Z in Los Angeles summer time.
  assert.equal(within('2026-08-31T16:00', '2026-08-31T18:00', 'America/Los_Angeles'), true);
});

test('route validator rejects multi-day daytime bookings and retains valid bookings', () => {
  assert.equal(validate('2026-09-07T17:00', '2026-09-08T10:00'), 'Selected time is outside salon opening hours');
  assert.equal(validate('2026-09-07T09:00', '2026-09-07T10:00'), null);
});

test('existing overnight helper behavior is preserved', () => {
  assert.equal(context.isWithinOperatingHours('2026-09-07T18:00', '2026-09-08T02:00', 'Europe/Berlin', '18:00', '02:00'), true);
});

test('malformed dates reach ordinary validation instead of throwing server errors', () => {
  for (const input of ['', '2026-09-07', '2026-09-07T', 'not-a-dateT09:00', '2026-09-07Tbad']) {
    const invalid = context.parseWallClockInTimeZone(input, 'Europe/Berlin');
    assert.equal(Number.isNaN(invalid.getTime()), true, input);
    assert.equal(validate(input, '2026-09-07T10:00'), 'Invalid time window', input);
    assert.equal(validate('2026-09-07T09:00', input), 'Invalid time window', input);
  }
});

test('existing supported wall-clock forms retain their conversion behavior', () => {
  for (const input of ['2026-09-07T09:00', '2026-09-07T09:00:00', '2026-09-07T09:00:00Z', '2026-09-07T09:00:00+02:00']) {
    assert.equal(context.parseWallClockInTimeZone(input, 'Europe/Berlin').toISOString(), '2026-09-07T07:00:00.000Z', input);
  }
});

test('impossible calendar dates and out-of-range clocks cannot roll into bookings', () => {
  for (const input of ['2026-02-29T09:00', '2026-09-31T09:00', '2026-04-31T09:00', '2026-13-01T09:00', '2026-00-01T09:00', '2026-09-00T09:00', '2026-09-07T24:00', '2026-09-07T09:60', '2026-09-07T09:00:60', '2026-09-07T09.5:00']) {
    assert.equal(Number.isNaN(context.parseWallClockInTimeZone(input, 'Europe/Berlin').getTime()), true, input);
    assert.equal(validate(input, '2026-09-07T10:00'), 'Invalid time window', input);
  }
});

test('valid leap days, month ends and clock boundaries retain their conversion', () => {
  for (const [input, expected] of [
    ['2028-02-29T09:00', '2028-02-29T08:00:00.000Z'],
    ['2026-01-31T09:00', '2026-01-31T08:00:00.000Z'],
    ['2026-04-30T09:00', '2026-04-30T07:00:00.000Z'],
    ['2026-09-07T00:00:00', '2026-09-06T22:00:00.000Z'],
    ['2026-09-07T23:59:59', '2026-09-07T21:59:59.000Z'],
  ]) assert.equal(context.parseWallClockInTimeZone(input, 'Europe/Berlin').toISOString(), expected, input);
});

test('booking POST returns 400 for malformed dates before overlap checks or writes', async () => {
  const Fastify = require('fastify');
  const { z } = require('zod');
  const app = Fastify();
  let bookingOperations = 0;
  const forbiddenBookingOperation = () => { bookingOperations++; throw new Error('Unexpected booking access'); };
  const schemaStart = routes.indexOf('const bookingSchema =');
  const schemaEnd = routes.indexOf('const bookingUpdateSchema =', schemaStart);
  const contextStart = routes.indexOf('async function getSalonBookingContext(');
  const contextEnd = routes.indexOf('export async function bookingRoutes(', contextStart);
  const postStart = routes.indexOf('  app.post("/api/v1/bookings",');
  const postEnd = routes.indexOf('  app.patch("/api/v1/bookings/:id",', postStart);
  for (const [from, to] of [[schemaStart, schemaEnd], [contextStart, contextEnd], [postStart, postEnd]]) {
    assert.ok(from >= 0 && to > from, 'booking fixture source boundaries');
  }
  const fixture = vm.createContext({ Date, Intl, app, z,
    requireUserFromAuthHeader: async () => ({ id: 'fixture-customer', role: 'CUSTOMER' }),
    getPlatformSettings: async () => ({ bookingGloballyEnabled: true }),
    prisma: {
      salon: { findUnique: async () => ({ id: 'fixture-salon', isActive: true, bookingIntakeEnabled: true, openingTime: '09:00', closingTime: '18:00', services: [], barbers: [] }) },
      booking: { count: forbiddenBookingOperation },
      $transaction: forbiddenBookingOperation,
    },
  });
  const source = helper + routes.slice(schemaStart, schemaEnd) + routes.slice(start, contextEnd) + routes.slice(postStart, postEnd);
  try {
    vm.runInContext(stripTypeScriptTypes(source).replace(/^export /gm, ''), fixture, { timeout: 1000 });
    for (const invalid of ['2026-09-07', 'not-a-dateT09:00', '2026-09-07Tbad', '2026-09-31T09:00', '2026-09-07T09:60']) {
      for (const field of ['startAt', 'endAt']) {
        const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: {
          salonId: 'fixture-salon', startAt: '2026-09-07T09:00', endAt: '2026-09-07T10:00', [field]: invalid,
        } });
        assert.equal(response.statusCode, 400, `${field}: ${invalid}`);
        assert.equal(response.json().error, 'Invalid time window');
      }
    }
    const rolledDate = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: {
      salonId: 'fixture-salon', startAt: '2026-09-31T09:00', endAt: '2026-09-31T10:00',
    } });
    assert.equal(rolledDate.statusCode, 400);
    assert.equal(rolledDate.json().error, 'Invalid time window');
    assert.equal(bookingOperations, 0);
  } finally {
    await app.close();
  }
});

// Reuse the existing two pure helper tests without executing application imports.
const existing = read('backend/src/lib/booking-time.test.ts');
assert.deepEqual([...existing.matchAll(/import[\s\S]*?from "([^"]+)";/g)].map(match => match[1]), [
  'node:assert/strict', 'node:test', './booking-time.js',
]);
vm.runInContext(stripTypeScriptTypes(existing.replace(/import[\s\S]*?from "[^"]+";/g, '')), context, { timeout: 1000 });
