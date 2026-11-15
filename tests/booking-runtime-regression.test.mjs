import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Isolation review: only Fastify injection/Zod and evaluated booking source.
// No application imports, Prisma Client, dotenv, listening sockets or providers.
// The fake store evaluates tenant predicates against multiple synthetic salons;
// real PostgreSQL query behavior requires a separate disposable-runtime check.
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('backend/package.json', root));
const Fastify = require('fastify');
const { z } = require('zod');
const read = file => readFileSync(new URL(file, root), 'utf8');
const helper = read('backend/src/lib/booking-time.ts');
assert.doesNotMatch(helper, /\bimport\s/);
const routeSource = read('backend/src/routes/bookings.ts');
const start = routeSource.indexOf('const bookingSchema =');
assert.ok(start > 0, 'strip application imports before evaluating routes');
const source = stripTypeScriptTypes(helper + '\n' + routeSource.slice(start)).replace(/^export /gm, '');

async function fixture(t, actor = { id: 'staff-a', role: 'STAFF' }) {
  const salons = [
    { id: 'salon-a', ownerId: 'owner-a', memberships: [{ userId: 'staff-a', status: 'ACTIVE', revokedAt: null }] },
    { id: 'salon-b', ownerId: 'owner-b', memberships: [{ userId: 'staff-b', status: 'ACTIVE', revokedAt: null }] },
    { id: 'salon-inactive', ownerId: 'owner-b', memberships: [{ userId: 'staff-a', status: 'INACTIVE', revokedAt: null }] },
    { id: 'salon-revoked', ownerId: 'owner-b', memberships: [{ userId: 'staff-a', status: 'ACTIVE', revokedAt: new Date() }] },
    { id: 'salon-former-owner', ownerId: 'staff-a', memberships: [] },
  ].map(salon => ({ ...salon, isActive: true, bookingIntakeEnabled: true,
    openingTime: '09:00', closingTime: '18:00', workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    services: [{ id: 'service-a', durationMin: 30 }], barbers: [] }));
  const bookings = salons.map(salon => ({ id: 'booking-' + salon.id, salonId: salon.id,
    userId: 'customer-a', salon, serviceId: 'service-a', service: salon.services[0], barberId: null,
    status: 'PENDING', startAt: new Date('2026-11-20T09:00:00Z'), endAt: new Date('2026-11-20T09:30:00Z'),
    cancelledAt: null, cancellationReason: null, notes: null }));
  let writes = 0;
  let overlapReads = 0;
  const matches = (booking, where) => {
    if (!Object.keys(where).length) return true;
    if (where.userId !== undefined) return booking.userId === where.userId;
    if (where.salon?.ownerId !== undefined) return booking.salon.ownerId === where.salon.ownerId;
    const membership = where.salon?.staffMemberships?.some;
    if (membership) return booking.salon.memberships.some(row =>
      Object.entries(membership).every(([key, value]) => row[key] === value));
    throw new Error('Unexpected fake-store predicate');
  };
  const prisma = {
    salon: { findUnique: async ({ where }) => salons.find(salon => salon.id === where.id) },
    booking: {
      findMany: async ({ where, include }) => bookings.filter(booking => matches(booking, where)).map(booking => {
        if (include.user) {
          assert.deepEqual(Object.keys(include.user.select).sort(), ['email', 'fullName', 'id', 'phone']);
        }
        return { ...booking, ...(include.user ? { user: { id: booking.userId, fullName: 'Synthetic Customer',
          email: 'customer@example.test', phone: '+4915123456789' } } : {}) };
      }),
      findUnique: async ({ where }) => bookings.find(booking => booking.id === where.id),
      count: async () => { overlapReads++; return 0; },
      create: async ({ data }) => {
        writes++;
        const salon = salons.find(salon => salon.id === data.salonId);
        const booking = { id: 'created-booking', ...data, salon, service: salon.services[0], cancelledAt: null };
        bookings.push(booking);
        return booking;
      },
      update: async ({ where, data }) => {
        writes++;
        const booking = bookings.find(booking => booking.id === where.id);
        Object.assign(booking, data);
        return booking;
      },
    },
    service: { findUnique: async () => ({ id: 'service-a', salonId: 'salon-a', durationMin: 30 }) },
    $transaction: async fn => fn(prisma),
  };
  const context = vm.createContext({ Date, Intl, z, prisma,
    requireUserFromAuthHeader: async (_request, reply) => {
      if (!actor) { reply.code(401).send({ error: 'Unauthorized' }); throw new Error('Unauthorized'); }
      return actor;
    },
    getPlatformSettings: async () => ({ bookingGloballyEnabled: true }),
    notifyOperationalEvent: async () => {}, earnCompletedBooking: async () => {},
  });
  vm.runInContext(source, context, { timeout: 1000 });
  const app = Fastify();
  t.after(() => app.close());
  await context.bookingRoutes(app);
  return { app, salons, bookings, counts: () => ({ writes, overlapReads }) };
}

test('Staff list includes assigned salon bookings and excludes foreign/inactive/revoked memberships', async t => {
  const { app } = await fixture(t);
  const response = await app.inject({ method: 'GET', url: '/api/v1/bookings' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().bookings.map(row => row.salonId), ['salon-a']);
});

test('Staff without membership cannot read bookings by matching a legacy salon owner id', async t => {
  const { app, salons } = await fixture(t);
  salons[0].memberships = [];
  const response = await app.inject({ method: 'GET', url: '/api/v1/bookings' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().bookings, []);
});

test('Staff read scope covers each active assigned salon without becoming platform-wide', async t => {
  const { app, salons } = await fixture(t);
  salons[1].memberships.push({ userId: 'staff-a', status: 'ACTIVE', revokedAt: null });
  const response = await app.inject({ method: 'GET', url: '/api/v1/bookings' });
  assert.deepEqual(response.json().bookings.map(row => row.salonId).sort(), ['salon-a', 'salon-b']);
});

for (const [role, ids] of [['OWNER', ['salon-a']], ['ADMIN', ['salon-a', 'salon-b', 'salon-inactive', 'salon-revoked', 'salon-former-owner']]]) {
  test(`${role} booking read scope is preserved`, async t => {
    const { app } = await fixture(t, { id: 'owner-a', role });
    const response = await app.inject({ method: 'GET', url: '/api/v1/bookings' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().bookings.map(row => row.salonId), ids);
  });
}

test('Customer cannot use salon-wide listing; own history remains available', async t => {
  const { app } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/bookings' })).statusCode, 403);
  const own = await app.inject({ method: 'GET', url: '/api/v1/bookings/me' });
  assert.equal(own.statusCode, 200);
  assert.ok(own.json().bookings.every(row => row.userId === 'customer-a' && !('user' in row)));
});

test('Membership-based reads do not grant Staff edit or cancellation permission', async t => {
  const { app, counts } = await fixture(t);
  for (const method of ['PATCH', 'DELETE']) {
    const response = await app.inject({ method, url: '/api/v1/bookings/booking-salon-a',
      ...(method === 'PATCH' ? { payload: { status: 'CONFIRMED' } } : {}) });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(counts().writes, 0);
});

const payload = (date = '2026-11-21') => ({ salonId: 'salon-a', serviceId: 'service-a',
  startAt: date + 'T10:00', endAt: date + 'T10:30', timeZone: 'Europe/Berlin' });

test('Customer can create a Saturday booking when Saturday is configured', async t => {
  const { app, counts } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload() });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().booking.startAt, '2026-11-21T09:00:00.000Z');
  assert.equal(counts().writes, 1);
});

test('Owner can update an existing booking on a configured Saturday', async t => {
  const { app, bookings, counts } = await fixture(t, { id: 'owner-a', role: 'OWNER' });
  bookings[0].startAt = new Date('2026-11-21T09:00:00Z');
  bookings[0].endAt = new Date('2026-11-21T09:30:00Z');
  const response = await app.inject({ method: 'PATCH', url: '/api/v1/bookings/booking-salon-a', payload: { notes: 'Synthetic edit' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(counts().writes, 1);
});

test('Configured closed weekdays and Saturdays reject before overlap checks or writes', async t => {
  const { app, salons, counts } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  salons[0].workingDays = ['tue'];
  for (const date of ['2026-11-20', '2026-11-21']) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload(date) });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, 'Selected day is unavailable');
  }
  assert.deepEqual(counts(), { writes: 0, overlapReads: 0 });
});

test('Sunday is bookable only when explicitly in the configured working days', async t => {
  const { app, salons } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  const request = { method: 'POST', url: '/api/v1/bookings', payload: payload('2026-11-22') };
  assert.equal((await app.inject(request)).statusCode, 400);
  salons[0].workingDays.push('sun');
  assert.equal((await app.inject(request)).statusCode, 200);
});

test('Missing or empty legacy schedules retain weekday acceptance and weekend rejection', async t => {
  const { app, salons } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  for (const workingDays of [undefined, []]) {
    salons[0].workingDays = workingDays;
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload('2026-11-20') })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload() })).statusCode, 400);
  }
});

test('Existing holiday rejection is preserved on a configured Saturday', async t => {
  const { app, counts } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload('2026-10-03') });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(counts(), { writes: 0, overlapReads: 0 });
});

test('Configured day comparison uses the booking timezone across UTC midnight', async t => {
  const { app, salons } = await fixture(t, { id: 'customer-a', role: 'CUSTOMER' });
  Object.assign(salons[0], { workingDays: ['sat'], openingTime: '00:00', closingTime: '05:00' });
  const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: {
    ...payload(), startAt: '2026-11-21T00:00', endAt: '2026-11-21T00:30',
  } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().booking.startAt, '2026-11-20T23:00:00.000Z');
});

test('Unauthenticated booking submission remains protected without database writes', async t => {
  const { app, counts } = await fixture(t, null);
  const response = await app.inject({ method: 'POST', url: '/api/v1/bookings', payload: payload() });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(counts(), { writes: 0, overlapReads: 0 });
});
