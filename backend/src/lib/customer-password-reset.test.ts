import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "./auth.js";
import { createCustomerPasswordReset } from "./customer-password-reset.js";
import { verificationTestDatabase } from "./registration-verification.test-support.js";

function setup() {
  const db = verificationTestDatabase();
  let time = new Date("2026-09-07T12:00:00Z");
  const sent: Array<{ destination: string; code: string; id: string }> = [];
  const service = createCustomerPasswordReset(db, {
    now: () => time,
    hmacKey: () => "isolated-test-key-not-a-real-secret-123",
    assertDeliveryConfigured: () => {},
    send: async (destination, code, id) => {
      sent.push({ destination, code, id });
      return "test-provider-id";
    },
  });
  return { db, service, sent, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

async function createUser(db: any, overrides: Record<string, any> = {}) {
  return db.user.create({ data: {
    id: overrides.id || "customer-1",
    email: overrides.email || "customer@example.com",
    fullName: "Customer One",
    role: overrides.role || "CUSTOMER",
    status: overrides.status || "ACTIVE",
    passwordHash: overrides.passwordHash || await hashPassword("OriginalPassword123"),
  } });
}

test("password reset request is enumeration-resistant and only delivers to an active CUSTOMER", async () => {
  const { db, service, sent } = setup();
  await createUser(db);
  await createUser(db, { id: "owner-1", email: "owner@example.com", role: "OWNER" });
  await createUser(db, { id: "inactive-1", email: "inactive@example.com", status: "DELETED" });

  const customer = await service.request("customer@example.com", "ip-1");
  const missing = await service.request("missing@example.com", "ip-2");
  const owner = await service.request("owner@example.com", "ip-3");
  const inactive = await service.request("inactive@example.com", "ip-4");

  for (const response of [customer, missing, owner, inactive]) {
    assert.deepEqual(Object.keys(response), ["challengeId", "status", "expiresAt", "resendAvailableAt"]);
    assert.equal(response.status, "accepted");
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].destination, "customer@example.com");
  assert.equal((await db.passwordReset.findMany({})).length, 1);
});

test("stores only protected reset material, locks after five failures, and resend preserves attempts", async () => {
  const { db, service, sent, advance } = setup();
  await createUser(db);
  const requested = await service.request("customer@example.com", "ip");
  const stored = await db.passwordReset.findUnique({ where: { id: requested.challengeId } });
  assert.notEqual(stored.codeDigest, sent[0].code);
  assert.equal(stored.codeDigest.length, 64);
  assert.equal(stored.tokenHash.length, 64);

  const wrong = sent[0].code === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 2; attempt += 1) await assert.rejects(service.confirm(requested.challengeId, wrong, "ip"));
  advance(61_000);
  await service.resend(requested.challengeId, "ip");
  assert.equal((await db.passwordReset.findUnique({ where: { id: requested.challengeId } })).attemptCount, 2);
  for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(service.confirm(requested.challengeId, wrong, "ip"));
  await assert.rejects(service.confirm(requested.challengeId, sent.at(-1)!.code, "ip"));
});

test("reset proof expires, is single-use, updates only the CUSTOMER password, and revokes sessions", async () => {
  const { db, service, sent } = setup();
  const customer = await createUser(db);
  await db.session.create({ data: { id: "session-1", userId: customer.id, revokedAt: null } });
  const requested = await service.request(customer.email, "ip");
  const proof = await service.confirm(requested.challengeId, sent[0].code, "ip");
  assert.equal(JSON.stringify(proof).includes(sent[0].code), false);

  const result = await service.complete(proof.resetToken, "ReplacementPassword123");
  assert.deepEqual(result, { reset: true });
  const updated = await db.user.findUnique({ where: { id: customer.id } });
  assert.equal(await verifyPassword(updated.passwordHash, "ReplacementPassword123"), true);
  assert.equal(await verifyPassword(updated.passwordHash, "OriginalPassword123"), false);
  assert.ok((await db.passwordReset.findUnique({ where: { id: requested.challengeId } })).usedAt);
  assert.ok((await db.session.findUnique({ where: { id: "session-1" } })).revokedAt);
  await assert.rejects(service.complete(proof.resetToken, "AnotherPassword123"));
});

test("completion is atomic, rolls back failures, and allows only one concurrent consumer", async () => {
  const { db, service, sent } = setup();
  const customer = await createUser(db);
  const requested = await service.request(customer.email, "ip");
  const proof = await service.confirm(requested.challengeId, sent[0].code, "ip");
  const originalUpdate = db.user.update;
  db.user.update = async () => { throw new Error("test update failure"); };
  await assert.rejects(service.complete(proof.resetToken, "ReplacementPassword123"));
  assert.equal((await db.passwordReset.findUnique({ where: { id: requested.challengeId } })).usedAt, null);
  db.user.update = originalUpdate;

  const outcomes = await Promise.allSettled([
    service.complete(proof.resetToken, "ReplacementPassword123"),
    service.complete(proof.resetToken, "ReplacementPassword123"),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
});

test("OTP and reset proof expire after ten minutes and rate limits persist", async () => {
  const { db, service, sent, advance } = setup();
  await createUser(db);
  let requested = await service.request("customer@example.com", "ip");
  advance(10 * 60_000);
  await assert.rejects(service.confirm(requested.challengeId, sent[0].code, "ip"));

  advance(61_000);
  requested = await service.request("customer@example.com", "ip");
  const proof = await service.confirm(requested.challengeId, sent.at(-1)!.code, "ip");
  advance(10 * 60_000);
  await assert.rejects(service.complete(proof.resetToken, "ReplacementPassword123"));

  const isolated = setup();
  for (let count = 0; count < 5; count += 1) {
    await isolated.service.request("missing@example.com", `ip-${count}`);
    isolated.advance(61_000);
  }
  await assert.rejects(isolated.service.request("missing@example.com", "another-ip"), (error: any) => error.statusCode === 429 && error.retryAfter > 0);
});

test("delivery failures never create a confirmable challenge or expose provider errors", async () => {
  const db = verificationTestDatabase();
  await createUser(db);
  let deliveredCode = "";
  const service = createCustomerPasswordReset(db, {
    hmacKey: () => "isolated-test-key-not-a-real-secret-123",
    assertDeliveryConfigured: () => {},
    send: async (_destination, code) => {
      deliveredCode = code;
      throw new Error("private provider response");
    },
  });
  const response = await service.request("customer@example.com", "ip");
  assert.equal(response.status, "accepted");
  const stored = await db.passwordReset.findUnique({ where: { id: response.challengeId } });
  assert.equal(stored.deliveryState, "FAILED");
  assert.equal(stored.codeDigest, null);
  await assert.rejects(service.confirm(response.challengeId, deliveredCode, "ip"));
});
