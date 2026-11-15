import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import { accessTokenVersionMatches, userAuthVersion } from './auth-version.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';
import { prisma } from './prisma.js';
import { requireUserFromAuthHeader, createSessionForUser, sanitizeUser } from './auth.js';
import { passwordResetPurposeMatchesRole, CUSTOMER_PASSWORD_RESET, STAFF_PASSWORD_RESET } from './credential-proof-purpose.js';
import { persistPendingStaffInvitation, staffOnboardingSettings, validateStaffOnboardingConfiguration } from './staff-onboarding.js';
import { buildStaffInvitationEmail } from './staff-invitation-email.js';
import { createCustomerPasswordReset } from './customer-password-reset.js';
import { verificationTestDatabase } from './registration-verification.test-support.js';
import { loyaltyRoutes } from '../routes/loyalty.js';
import { authRoutes } from '../routes/auth.js';

// Synthetic process-local fixtures only; never load environment files or use a DB.
process.env.JWT_ACCESS_SECRET = 'foundation-unit-access-fixture';
process.env.JWT_REFRESH_SECRET = 'foundation-unit-refresh-fixture';
const now = new Date('2026-11-14T12:00:00Z');
const enabled = { STAFF_ONBOARDING_ENABLED: 'true', STAFF_ACTIVATION_URL: 'https://salon.example.test/staff/activate' };
const email = { apiKey: 'unit-fixture', from: 'SALO <sender@example.test>', mode: 'testing' };
const input = () => ({ salonId: 'salon-a', initiatedByUserId: 'owner-a', destinationEmail: ' STAFF@Example.test ', fullName: 'Staff Person', barberName: 'Person', secret: 'a'.repeat(64), expiresAt: new Date(now.getTime() + 60_000) });
function invitationDB() {
  const rows: any[] = [];
  let calls = 0;
  return { rows, get calls() { return calls; }, staffInvitation: { create: async ({ data, select }: any) => {
    calls++;
    if (rows.some(row => row.salonId === data.salonId && row.destinationEmail === data.destinationEmail && row.status === 'PENDING')) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    rows.push(data);
    return Object.fromEntries(Object.keys(select).map(key => [key, data[key]]));
  } } };
}

test('onboarding defaults off; misspelled flags do not persist invitations', async () => {
  assert.equal(staffOnboardingSettings({}).enabled, false);
  for (const flag of [undefined, 'false', 'TRUE', '1', ' true ']) {
    const db = invitationDB();
    await assert.rejects(persistPendingStaffInvitation(db, input(), { env: { STAFF_ONBOARDING_ENABLED: flag }, now: () => now }), { code: 'STAFF_ONBOARDING_DISABLED' });
    assert.equal(db.calls, 0);
  }
});

test('invitation persistence normalizes email, hashes proof, returns metadata only, creates no account or membership', async () => {
  // Deliberately no user, membership, session, or email delegates on this mock.
  const db = invitationDB();
  const result = await persistPendingStaffInvitation(db, input(), { env: enabled, now: () => now });
  const row = db.rows[0];
  assert.equal(row.destinationEmail, 'staff@example.test');
  assert.equal(typeof row.secretDigest === 'string' && row.secretDigest.length === 64 && row.secretDigest !== input().secret, true);
  assert.equal('secret' in row || 'secret' in result || 'secretDigest' in result, false);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.deliveryState, 'PENDING');
  assert.equal(row.generation, 1);
  assert.equal(row.acceptedAt, null);
  assert.equal(row.consumedAt, null);
  assert.equal(db.rows.length, 1);
});

test('duplicate/concurrent pending invitations fail safely; different salons and terminal history coexist', async () => {
  const db = invitationDB();
  const results = await Promise.allSettled([1, 2].map(() => persistPendingStaffInvitation(db, input(), { env: enabled, now: () => now })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'STAFF_INVITATION_PENDING');
  await persistPendingStaffInvitation(db, { ...input(), salonId: 'salon-b' }, { env: enabled, now: () => now });
  db.rows[0].status = 'EXPIRED';
  await persistPendingStaffInvitation(db, input(), { env: enabled, now: () => now });
  assert.equal(db.rows.length, 3);
});

test('invalid profile, expiry, and raw-secret formats never reach persistence', async () => {
  for (const change of [{ destinationEmail: 'invalid' }, { secret: 'short' }, { expiresAt: now }, { fullName: '' }, { salonId: '' }]) {
    const db = invitationDB();
    await assert.rejects(persistPendingStaffInvitation(db, { ...input(), ...change }, { env: enabled, now: () => now }), { code: 'STAFF_INVITATION_INVALID' });
    assert.equal(db.calls, 0);
  }
});

test('configuration fails closed without explicit secure URL and email configuration', () => {
  assert.throws(() => validateStaffOnboardingConfiguration(staffOnboardingSettings({}), email), { code: 'STAFF_ONBOARDING_DISABLED' });
  for (const url of [undefined, 'http://example.test', 'https://user@example.test', 'https://example.test?x=1', 'https://example.test#x']) {
    assert.throws(() => validateStaffOnboardingConfiguration({ enabled: true, activationPageUrl: url }, email), { code: 'STAFF_ONBOARDING_UNCONFIGURED' });
  }
  assert.throws(() => validateStaffOnboardingConfiguration(staffOnboardingSettings(enabled), {}), { code: 'EMAIL_UNAVAILABLE' });
});

test('DE/EN/AR invitation content is pure, disabled by default, with explicit URL and fragment proof', () => {
  const invitation = { id: 'invitation-a', secret: input().secret, salonName: 'Test Salon', expiresAt: input().expiresAt };
  assert.throws(() => buildStaffInvitationEmail(invitation, staffOnboardingSettings({}), email), { code: 'STAFF_ONBOARDING_DISABLED' });
  for (const locale of ['de', 'en', 'ar'] as const) {
    const content = buildStaffInvitationEmail({ ...invitation, locale }, staffOnboardingSettings(enabled), email);
    assert.equal(content.subject.length > 0 && content.text.includes('Test Salon'), true);
    const link = new URL(content.text.split('\n')[1]);
    assert.equal(link.origin, 'https://salon.example.test');
    assert.equal(link.search, '');
    assert.equal(new URLSearchParams(link.hash.slice(1)).has('secret'), true);
    assert.equal(content.text.includes(invitation.expiresAt.toISOString()), true);
  }
});

test('version policy accepts legacy only at zero and rejects malformed, stale, future versions', () => {
  assert.equal(userAuthVersion({}), 0);
  assert.equal(accessTokenVersionMatches({}, { authVersion: 0 }), true);
  assert.equal(accessTokenVersionMatches({}, { authVersion: 1 }), false);
  assert.equal(accessTokenVersionMatches({ av: 4 }, { authVersion: 4 }), true);
  for (const av of [-1, 3, 5, null, '4', 1.2, Number.MAX_SAFE_INTEGER]) assert.equal(accessTokenVersionMatches({ av }, { authVersion: 4 }), false);
  assert.equal(accessTokenVersionMatches({ av: 0 }, { authVersion: -1 }), false);
  assert.throws(() => userAuthVersion({ authVersion: -1 }));
});

test('JWT issuance includes version; signed legacy remains bounded by original expiration', () => {
  assert.equal(verifyAccessToken(signAccessToken({ sub: 'staff-a', role: 'STAFF', authVersion: 3 })).av, 3);
  assert.equal(verifyAccessToken(signAccessToken({ sub: 'staff-a', role: 'STAFF' })).av, 0);
  const legacy = jwt.sign({ sub: 'staff-a', role: 'STAFF' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
  assert.equal(verifyAccessToken(legacy).av, undefined);
  for (const av of [-1, '0', null, 0.5]) {
    const malformed = jwt.sign({ sub: 'staff-a', role: 'STAFF', av }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
    assert.throws(() => verifyAccessToken(malformed));
  }
  const expired = jwt.sign({ sub: 'staff-a', role: 'STAFF' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: -1 });
  assert.throws(() => verifyAccessToken(expired));
});

test('shared authentication validates persisted version, including restricted-access routes', async () => {
  const original = (prisma as any).user;
  let version = 0;
  (prisma as any).user = { findUnique: async () => ({ id: 'staff-a', role: 'STAFF', status: 'ACTIVE', authVersion: version }) };
  let status = 0;
  const reply = { code: (code: number) => { status = code; return { send: () => undefined }; } };
  const legacy = jwt.sign({ sub: 'staff-a', role: 'STAFF' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
  try {
    assert.equal((await requireUserFromAuthHeader({ headers: { authorization: `Bearer ${legacy}` } }, reply)).id, 'staff-a');
    version = 2;
    await assert.rejects(requireUserFromAuthHeader({ headers: { authorization: `Bearer ${legacy}` } }, reply));
    assert.equal(status, 401);
    const stale = signAccessToken({ sub: 'staff-a', role: 'STAFF', authVersion: 1 });
    await assert.rejects(requireUserFromAuthHeader({ headers: { authorization: `Bearer ${stale}` } }, reply, { allowRestrictedAccount: true }));
    const current = signAccessToken({ sub: 'staff-a', role: 'STAFF', authVersion: 2 });
    assert.equal((await requireUserFromAuthHeader({ headers: { authorization: `Bearer ${current}` } }, reply)).id, 'staff-a');
  } finally { (prisma as any).user = original; }
});

test('session issuance retains hash-only refresh persistence and public user response shape', async () => {
  let persisted: any;
  const db = { session: { create: async ({ data }: any) => { persisted = data; } } } as any;
  const session = await createSessionForUser({ id: 'staff-a', role: 'STAFF', authVersion: 7 }, { headers: {}, ip: '127.0.0.1' }, db);
  assert.equal(verifyAccessToken(session.accessToken).av, 7);
  assert.equal(typeof persisted.tokenHash === 'string' && persisted.tokenHash !== session.refreshToken, true);
  assert.equal('refreshToken' in persisted || 'token' in persisted, false);
  assert.deepEqual(sanitizeUser({ id: 'staff-a', authVersion: 7, staffPasswordChangeRequired: false }), { id: 'staff-a' });
});

test('optional loyalty authentication hides protected roster for stale and legacy nonzero versions', async () => {
  const mock = prisma as any;
  const original = { user: mock.user, salon: mock.salon, loyaltyCard: mock.loyaltyCard };
  let version = 0;
  mock.user = { findUnique: async () => ({ id: 'owner-a', role: 'OWNER', status: 'ACTIVE', authVersion: version }) };
  mock.salon = { findUnique: async () => ({ ownerId: 'owner-a' }) };
  mock.loyaltyCard = { findFirst: async ({ include }: any) => ({ id: 'card-a', customers: include.customers ? [] : undefined, stamps: [] }) };
  const app = Fastify();
  try {
    await loyaltyRoutes(app);
    const read = async (token: string) => {
      const response = await app.inject({ url: '/api/v1/loyalty/cards/salon-a', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200);
      return 'customers' in response.json().card;
    };
    const legacy = jwt.sign({ sub: 'owner-a', role: 'OWNER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
    assert.equal(await read(legacy), true);
    version = 2;
    assert.equal(await read(legacy), false);
    assert.equal(await read(signAccessToken({ sub: 'owner-a', role: 'OWNER', authVersion: 1 })), false);
    assert.equal(await read(signAccessToken({ sub: 'owner-a', role: 'OWNER', authVersion: 2 })), true);
  } finally { await app.close(); Object.assign(mock, original); }
});

test('existing refresh rotation issues persisted version without changing refresh/session semantics', async () => {
  const mock = prisma as any;
  const original = { user: mock.user, session: mock.session, $transaction: mock.$transaction };
  const rows = new Map<string, any>();
  mock.user = { findUnique: async () => ({ id: 'staff-a', role: 'STAFF', status: 'ACTIVE', authVersion: 3 }) };
  mock.session = {
    create: async ({ data }: any) => { const row = { ...data, revokedAt: null }; rows.set(row.id, row); return row; },
    findUnique: async ({ where }: any) => rows.get(where.id),
    updateMany: async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revokedAt !== null || row.userId !== where.userId || row.tokenHash !== where.tokenHash || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  mock.$transaction = async (work: any) => work({ session: mock.session });
  const app = Fastify();
  try {
    const initial = await createSessionForUser({ id: 'staff-a', role: 'STAFF' }, { headers: {}, ip: '127.0.0.1' });
    await authRoutes(app);
    const request = () => app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: initial.refreshToken } });
    const response = await request();
    assert.equal(response.statusCode, 200);
    assert.equal(verifyAccessToken(response.json().accessToken).av, 3);
    assert.equal(rows.size, 2);
    assert.equal([...rows.values()].filter(row => row.revokedAt !== null).length, 1);
    assert.equal([...rows.values()].some(row => row.tokenHash === response.json().refreshToken), false);
    assert.equal((await request()).statusCode, 401);
  } finally { await app.close(); Object.assign(mock, original); }
});

test('proof purpose is explicit and role-bound; absent and unknown purposes fail closed', () => {
  for (const role of ['CUSTOMER', 'STAFF', 'OWNER', 'ADMIN']) for (const purpose of [CUSTOMER_PASSWORD_RESET, STAFF_PASSWORD_RESET, undefined, 'STAFF_ACTIVATION']) {
    assert.equal(passwordResetPurposeMatchesRole({ purpose }, role), (role === 'CUSTOMER' && purpose === CUSTOMER_PASSWORD_RESET) || (role === 'STAFF' && purpose === STAFF_PASSWORD_RESET));
  }
});

function recovery() {
  const db = verificationTestDatabase();
  let time = now;
  let lastCode = '';
  const service = createCustomerPasswordReset(db, { now: () => time, hmacKey: () => 'foundation-recovery-unit-fixture', assertDeliveryConfigured: () => {}, send: async (_to, code) => { lastCode = code; return 'fixture-message'; } });
  return { db, service, code: () => lastCode, advance: () => { time = new Date(time.getTime() + 61_000); } };
}

test('Customer resend, confirmation and completion reject Staff-purpose material without changing passwords', async () => {
  const { db, service, code, advance } = recovery();
  await db.user.create({ data: { id: 'customer-a', email: 'customer@example.test', role: 'CUSTOMER', status: 'ACTIVE' } });
  const challenge = await service.request('customer@example.test', 'fixture-ip');
  await db.passwordReset.update({ where: { id: challenge.challengeId }, data: { purpose: STAFF_PASSWORD_RESET } });
  const sent = code();
  advance();
  await service.resend(challenge.challengeId, 'fixture-ip');
  assert.equal(code() === sent, true);
  await assert.rejects(service.confirm(challenge.challengeId, sent, 'fixture-ip'));
  await db.passwordReset.update({ where: { id: challenge.challengeId }, data: { purpose: CUSTOMER_PASSWORD_RESET } });
  const proof = await service.confirm(challenge.challengeId, sent, 'fixture-ip');
  await db.passwordReset.update({ where: { id: challenge.challengeId }, data: { purpose: STAFF_PASSWORD_RESET } });
  await assert.rejects(service.complete(proof.resetToken, 'Synthetic-fixture-password-123'));
  assert.equal((await db.user.findUnique({ where: { id: 'customer-a' } })).passwordHash, undefined);
});

test('Customer proofs cannot update an account whose role changed to Staff', async () => {
  const { db, service, code } = recovery();
  await db.user.create({ data: { id: 'customer-a', email: 'customer@example.test', role: 'CUSTOMER', status: 'ACTIVE' } });
  const challenge = await service.request('customer@example.test', 'fixture-ip');
  const proof = await service.confirm(challenge.challengeId, code(), 'fixture-ip');
  await db.user.update({ where: { id: 'customer-a' }, data: { role: 'STAFF' } });
  await assert.rejects(service.complete(proof.resetToken, 'Synthetic-fixture-password-123'));
  assert.equal((await db.user.findUnique({ where: { id: 'customer-a' } })).passwordHash, undefined);
});

test('Customer issuance does not invalidate another-purpose proof', async () => {
  const { db, service } = recovery();
  await db.user.create({ data: { id: 'customer-a', email: 'customer@example.test', role: 'CUSTOMER', status: 'ACTIVE' } });
  await db.passwordReset.create({ data: { id: 'staff-proof', userId: 'customer-a', purpose: STAFF_PASSWORD_RESET, usedAt: null, invalidatedAt: null } });
  await service.request('customer@example.test', 'fixture-ip');
  assert.equal((await db.passwordReset.findUnique({ where: { id: 'staff-proof' } })).invalidatedAt, null);
});

test('migrated legacy Customer OTP and existing reset proof keep their original formats', async () => {
  const { db, service } = recovery();
  await db.user.create({ data: { id: 'customer-a', email: 'customer@example.test', role: 'CUSTOMER', status: 'ACTIVE' } });
  const code = '123456';
  // Simulate an old row after the additive DEFAULT labels it as Customer.
  await db.passwordReset.create({ data: {
    id: 'legacy-otp', userId: 'customer-a', purpose: CUSTOMER_PASSWORD_RESET,
    generation: 1, codeDigest: createHmac('sha256', 'foundation-recovery-unit-fixture').update(JSON.stringify(['customer-password-reset-otp', 'legacy-otp', 'customer-a', '1', code])).digest('hex'),
    deliveryState: 'ACCEPTED', expiresAt: new Date(now.getTime() + 60_000), attemptCount: 0,
    usedAt: null, invalidatedAt: null, verifiedAt: null,
  } });
  const proof = await service.confirm('legacy-otp', code, 'fixture-ip');
  assert.equal(typeof proof.resetToken === 'string', true);
  const secret = 'b'.repeat(64);
  await db.passwordReset.create({ data: {
    id: 'legacy-proof', userId: 'customer-a', purpose: CUSTOMER_PASSWORD_RESET,
    tokenHash: createHash('sha256').update(secret).digest('hex'),
    expiresAt: new Date(now.getTime() + 60_000), verifiedAt: now, usedAt: null, invalidatedAt: null,
  } });
  assert.deepEqual(await service.complete(`legacy-proof.${secret}`, 'Synthetic-fixture-password-123'), { reset: true });
  await assert.rejects(service.complete(`legacy-proof.${secret}`, 'Synthetic-fixture-password-123'));
});

test('foundation is not wired to routes or existing provisioning', () => {
  for (const file of ['../routes/auth.ts', '../routes/owner-team.ts', '../server.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal(/(?:persistPendingStaffInvitation|buildStaffInvitationEmail|staff-onboarding\.js)/.test(source), false);
  }
});
