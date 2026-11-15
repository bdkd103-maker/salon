import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../lib/jwt.js';
import { ownerTeamRoutes } from './owner-team.js';
import { staffStatusRoutes } from './staff-status.js';

const mock = prisma as any;
const original = { user: mock.user, staffMembership: mock.staffMembership, salon: mock.salon, serviceVisit: mock.serviceVisit, queueEntry: mock.queueEntry, $transaction: mock.$transaction };
const originalSecret = process.env.JWT_ACCESS_SECRET;
let active: any, role: string, membershipPresent: boolean, reads: number;
const startedAt = new Date('2026-01-01T10:00:00Z');
beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = 'busy-reminder-fixture';
  active = { id: 'visit-1', salonId: 'salon-1', staffMembershipId: 'member-1', status: 'IN_SERVICE', version: 1, startedAt, completedAt: null, bookingId: null };
  role = 'STAFF'; membershipPresent = true; reads = 0;
  mock.user = { findUnique: async () => ({ id: 'staff-1', role, status: 'ACTIVE' }) };
  const member = () => ({ id: 'member-1', salonId: 'salon-1', userId: 'staff-1', status: 'ACTIVE', revokedAt: null, barberId: 'barber-1', presence: null, serviceVisits: active?.status === 'IN_SERVICE' ? [active] : [], salon: { id: 'salon-1', name: 'Fixture' }, barber: { name: 'Fixture' } });
  mock.staffMembership = {
    findMany: async ({ where, include }: any) => {
      reads++; assert.equal(where.userId, 'staff-1'); assert.equal(where.status, 'ACTIVE'); assert.equal(where.revokedAt, null);
      assert.deepEqual(include.serviceVisits.where, { status: 'IN_SERVICE' });
      return membershipPresent ? [member()] : [];
    },
    findUnique: async () => membershipPresent ? member() : null,
  };
  mock.salon = { findUnique: async () => ({ id: 'salon-1', ownerId: 'owner-1' }) };
  mock.$transaction = async (run: any) => run(mock);
  mock.serviceVisit = {
    findUnique: async () => active,
    update: async ({ where, data }: any) => {
      assert.equal(where.id, active.id); assert.equal(where.version, active.version);
      active = { ...active, ...data, version: active.version + 1 }; return active;
    },
  };
  // A linked queue remains STARTED; service completion is represented by its visit.
  mock.queueEntry = { findUnique: async ({ where }: any) => {
    assert.equal(where.serviceVisitId, 'visit-1'); return { id: 'queue-1', status: 'STARTED', serviceVisitId: 'visit-1', salonId: 'salon-1', customerId: null };
  } };
});
afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = originalSecret;
});
async function app() { const app = Fastify(); await ownerTeamRoutes(app); await staffStatusRoutes(app); return app; }
const headers = () => ({ authorization: `Bearer ${signAccessToken({ sub: 'staff-1', role })}` });
test('staff/me returns matching authorized active visit ID/start and server time', async () => {
  const server = await app();
  try {
    const before = Date.now(), res = await server.inject({ url: '/api/v1/staff/me', headers: headers() }), after = Date.now();
    assert.equal(res.statusCode, 200); const body = res.json();
    assert.equal(body.activeVisitId, 'visit-1'); assert.equal(body.activeVisitStartedAt, startedAt.toISOString());
    assert.ok(Date.parse(body.serverTime) >= before && Date.parse(body.serverTime) <= after);
    assert.equal(body.occupancy, 'BUSY'); assert.equal(body.presenceState, 'OFF_DUTY');
    assert.equal(body.serviceVisits, undefined);
  } finally { await server.close(); }
});
test('staff/me returns null visit timing when no service is active', async () => {
  active = null; const server = await app();
  try { const res = await server.inject({ url: '/api/v1/staff/me', headers: headers() }); assert.equal(res.statusCode, 200); assert.equal(res.json().activeVisitId, null); assert.equal(res.json().activeVisitStartedAt, null); }
  finally { await server.close(); }
});
test('non-staff cannot read timing and inactive membership cannot recover a visit', async () => {
  const server = await app();
  try {
    role = 'OWNER'; assert.equal((await server.inject({ url: '/api/v1/staff/me', headers: headers() })).statusCode, 403); assert.equal(reads, 0);
    role = 'STAFF'; membershipPresent = false; assert.equal((await server.inject({ url: '/api/v1/staff/me', headers: headers() })).statusCode, 404);
  } finally { await server.close(); }
});
test('existing completion preserves queue link, rejects replay and does not falsely make expired presence FREE', async () => {
  const server = await app();
  try {
    const res = await server.inject({ method: 'PATCH', url: '/api/v1/salons/salon-1/service-visits/visit-1/complete', headers: headers() });
    assert.equal(res.statusCode, 200); assert.equal(res.json().serviceVisit.status, 'COMPLETED');
    assert.equal(res.json().occupancy, 'NOT_AVAILABLE'); assert.equal(active.startedAt, startedAt);
    assert.equal((await server.inject({ method: 'PATCH', url: '/api/v1/salons/salon-1/service-visits/visit-1/complete', headers: headers() })).statusCode, 409);
    const self = (await server.inject({ url: '/api/v1/staff/me', headers: headers() })).json(); assert.equal(self.activeVisitStartedAt, null);
  } finally { await server.close(); }
});
