// Contract tests only: Prisma delegates are replaced before requests; no database access.
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { signAccessToken } from '../lib/jwt.js';
import { ownerTeamRoutes } from './owner-team.js';

const mock = prisma as any;
const original = Object.fromEntries(['user', 'salon', 'barber', 'staffMembership', '$transaction'].map(key => [key, mock[key]]));
const salonId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
let actor: any, target: any, duplicate: any, uniqueConflict: boolean, rows: any, reads: number;
const payload = () => ({ fullName: 'Fixture Staff', email: 'Staff@Example.test', phone: '', password: 'Synthetic-initial-passphrase', barberName: 'Fixture Barber' });
beforeEach(() => {
  // This suite runs in its own process and uses no inherited credential values.
  process.env.JWT_ACCESS_SECRET = 'owner-team-contract-fixture';
  actor = { id: 'owner-1', role: 'OWNER', status: 'ACTIVE' };
  target = null; duplicate = null; uniqueConflict = false; reads = 0;
  rows = { users: [], barbers: [], memberships: [] };
  mock.user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return { ...actor };
      reads++; assert.equal(where.email, 'staff@example.test'); return target;
    },
    create: async ({ data }: any) => { const user = { id: 'staff-1', ...data }; rows.users.push(user); return user; },
    update: async () => { throw new Error('Provisioning must not overwrite existing credentials'); },
  };
  mock.salon = { findUnique: async () => ({ id: salonId, ownerId: 'owner-1', name: 'Fixture' }) };
  mock.barber = { create: async ({ data }: any) => { const barber = { id: 'barber-1', ...data }; rows.barbers.push(barber); return barber; } };
  mock.staffMembership = {
    findFirst: async ({ where }: any) => { assert.equal(where.salonId, salonId); return duplicate; },
    findMany: async () => [],
    create: async ({ data }: any) => {
      if (uniqueConflict) throw Object.assign(new Error('Fixture uniqueness conflict'), { code: 'P2002' });
      const membership = { id: memberId, ...data, barber: rows.barbers[0] }; rows.memberships.push(membership); return membership;
    },
  };
  mock.$transaction = async (run: any) => {
    const before = structuredClone(rows);
    try { return await run(mock); } catch (error) { rows = before; throw error; }
  };
});
afterEach(() => Object.assign(mock, original));
async function request(method = 'POST', body: any = payload(), authorization: string | null = 'valid') {
  const app = Fastify(); await ownerTeamRoutes(app);
  try {
    const headers = authorization === null ? {} : { authorization: authorization === 'valid' ? `Bearer ${signAccessToken({ sub: actor.id, role: actor.role })}` : 'Bearer synthetic-invalid' };
    return await app.inject({ method: method as any, url: `/api/v1/salons/${salonId}/team${['PATCH', 'DELETE'].includes(method) ? '/' + memberId : ''}`, headers, ...(['POST', 'PATCH'].includes(method) ? { payload: body } : {}) });
  } finally { await app.close(); }
}

test('new email creates a STAFF account, ACTIVE membership and same-salon barber atomically', async () => {
  const response = await request(); assert.equal(response.statusCode, 201);
  assert.equal(rows.users.length, 1); assert.equal(rows.barbers.length, 1); assert.equal(rows.memberships.length, 1);
  const user = rows.users[0], member = rows.memberships[0];
  assert.equal(user.role, 'STAFF'); assert.equal(user.status, 'ACTIVE'); assert.equal(user.email, 'staff@example.test');
  assert.equal(user.emailVerified, true, 'current contract trusts Owner-supplied email without verification');
  assert.equal(member.userId, user.id); assert.equal(member.status, 'ACTIVE'); assert.equal(member.salonId, salonId);
  assert.equal(member.barberId, rows.barbers[0].id); assert.equal(rows.barbers[0].salonId, salonId);
  assert.ok(typeof user.passwordHash === 'string' && user.passwordHash !== payload().password, 'password must not be stored as plaintext');
  assert.ok(await verifyPassword(user.passwordHash, payload().password), 'existing verification helper must accept the stored digest');
  assert.ok(!(await verifyPassword(user.passwordHash, 'Synthetic-wrong-passphrase')), 'wrong password must fail');
  assert.ok(!/password|tokenHash|accessToken|refreshToken/i.test(JSON.stringify(response.json())), 'response must exclude credential fields');
});

test('existing STAFF identity is linked without changing its password or profile', async () => {
  const digest = await hashPassword('Synthetic-existing-passphrase');
  target = { id: 'staff-existing', role: 'STAFF', status: 'ACTIVE', email: 'staff@example.test', fullName: 'Existing Fixture', passwordHash: digest };
  const response = await request(); assert.equal(response.statusCode, 201);
  assert.equal(rows.users.length, 0); assert.equal(rows.memberships[0].userId, target.id);
  assert.ok(target.passwordHash === digest, 'existing digest must remain unchanged');
  assert.ok(await verifyPassword(target.passwordHash, 'Synthetic-existing-passphrase'));
  assert.ok(!(await verifyPassword(target.passwordHash, payload().password)), 'submitted new password is deliberately ignored for existing STAFF');
  assert.equal(target.fullName, 'Existing Fixture');
});

for (const status of ['INACTIVE', 'SUSPENDED', 'DELETED']) {
  test(`documents current risk: existing ${status} STAFF can receive an ACTIVE membership`, async () => {
    target = { id: 'staff-existing', role: 'STAFF', status, email: 'staff@example.test', fullName: 'Existing Fixture', passwordHash: null };
    assert.equal((await request()).statusCode, 201);
    assert.equal(target.status, status); assert.ok(target.passwordHash === null);
    assert.equal(rows.users.length, 0); assert.equal(rows.memberships[0].status, 'ACTIVE');
  });
}

for (const status of ['ACTIVE', 'SUSPENDED', 'REVOKED']) {
  test(`duplicate ${status} membership returns conflict without creating another barber or membership`, async () => {
    target = { id: 'staff-existing', role: 'STAFF', status: 'ACTIVE' }; duplicate = { id: memberId, status };
    assert.equal((await request()).statusCode, 409);
    assert.equal(rows.users.length + rows.barbers.length + rows.memberships.length, 0);
  });
}
test('database uniqueness conflict is mapped to 409 and rolls back provisioning writes', async () => {
  uniqueConflict = true; assert.equal((await request()).statusCode, 409);
  assert.equal(rows.users.length + rows.barbers.length + rows.memberships.length, 0);
});
for (const role of ['OWNER', 'ADMIN', 'CUSTOMER']) {
  test(`existing ${role} identity is never converted to STAFF`, async () => {
    target = { id: 'existing', role, status: 'ACTIVE' };
    assert.equal((await request()).statusCode, 409); assert.equal(target.role, role);
    assert.equal(rows.users.length + rows.barbers.length + rows.memberships.length, 0);
  });
}
for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
  test(`another Owner cannot ${method} this salon's Team`, async () => {
    actor.id = 'owner-other'; assert.equal((await request(method, method === 'PATCH' ? { status: 'ACTIVE' } : payload())).statusCode, 403);
    assert.equal(reads, 0); assert.equal(rows.users.length + rows.barbers.length + rows.memberships.length, 0);
  });
}
for (const role of ['STAFF', 'CUSTOMER']) {
  test(`${role} cannot provision a Staff account`, async () => {
    actor.role = role; assert.equal((await request()).statusCode, 403); assert.equal(reads, 0);
  });
}
for (const status of ['INACTIVE', 'SUSPENDED', 'DELETED']) {
  test(`${status} Owner account is rejected before provisioning`, async () => {
    actor.status = status; assert.equal((await request()).statusCode, 401); assert.equal(reads, 0);
  });
}
test('missing and invalid credentials are rejected before provisioning', async () => {
  assert.equal((await request('POST', payload(), null)).statusCode, 401);
  assert.equal((await request('POST', payload(), 'invalid')).statusCode, 401); assert.equal(reads, 0);
});
test('required password and strict role validation remain unchanged', async () => {
  const { password, ...missing } = payload();
  assert.equal((await request('POST', missing)).statusCode, 400);
  assert.equal((await request('POST', { ...payload(), role: 'ADMIN' })).statusCode, 400); assert.equal(reads, 0);
});
test('existing ADMIN override can provision a STAFF account', async () => {
  actor = { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE' };
  assert.equal((await request()).statusCode, 201); assert.equal(rows.users[0].role, 'STAFF');
});
