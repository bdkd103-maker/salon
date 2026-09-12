import test from "node:test";
import assert from "node:assert/strict";
import { createRegistrationVerification, OTP_LIFETIME_MS, serializable } from "./registration-verification.js";
import { VerificationError } from "./verification-email.js";
import { verificationTestDatabase } from "./registration-verification.test-support.js";

function setup() {
  const db = verificationTestDatabase();
  let time = new Date("2026-09-06T12:00:00Z");
  const sent: { code: string; destination: string; id: string }[] = [];
  const service = createRegistrationVerification(db, { now: () => time, hmacKey: () => "isolated-test-key-not-a-real-secret-123", assertDeliveryConfigured: () => {}, send: async (destination, code, id) => { sent.push({ destination, code, id }); return "test-provider-id"; } });
  return { db, service, sent, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

test("stores only protected code/proof, binds email, consumes once and rolls back on failure", async () => {
  const { db, service, sent } = setup();
  const challenge = await service.request("customer@example.com", "ip");
  assert.equal("code" in challenge, false);
  const row = await db.registrationVerificationChallenge.findUnique({ where: { id: challenge.challengeId } });
  assert.notEqual(row.codeDigest, sent[0].code);
  assert.equal(row.codeDigest.length, 64);
  assert.match(sent[0].code, /^\d{6}$/);
  const proof = await service.confirm(challenge.challengeId, sent[0].code, "ip");
  await assert.rejects(service.confirm(challenge.challengeId, sent[0].code, "ip"));
  await assert.rejects(serializable(db, tx => service.consume(tx, proof.verificationToken, "different@example.com")));
  await assert.rejects(serializable(db, async tx => { await service.consume(tx, proof.verificationToken, "customer@example.com"); throw new Error("Account failure"); }));
  const outcomes = await Promise.allSettled([1, 2].map(() => serializable(db, tx => service.consume(tx, proof.verificationToken, "customer@example.com"))));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
});

test("wrong attempts commit and lock out; resend does not reset attempts", async () => {
  const { db, service, sent, advance } = setup();
  const c = await service.request("customer@example.com", "ip");
  const wrong = sent[0].code === "000000" ? "000001" : "000000";
  for (let n = 0; n < 2; n++) await assert.rejects(service.confirm(c.challengeId, wrong, "ip"));
  advance(61_000); await service.request(null, "ip", c.challengeId);
  assert.equal((await db.registrationVerificationChallenge.findUnique({ where: { id: c.challengeId } })).attemptCount, 2);
  for (let n = 0; n < 3; n++) await assert.rejects(service.confirm(c.challengeId, wrong, "ip"));
  await assert.rejects(service.confirm(c.challengeId, sent.at(-1)!.code, "ip"));
  advance(61_000); await assert.rejects(service.request(null, "ip", c.challengeId));
});

test("OTP and registration token expire independently", async () => {
  const { service, sent, advance, db } = setup();
  let c = await service.request("customer@example.com", "ip");
  advance(OTP_LIFETIME_MS); await assert.rejects(service.confirm(c.challengeId, sent[0].code, "ip"));
  c = await service.request("customer@example.com", "ip");
  const proof = await service.confirm(c.challengeId, sent.at(-1)!.code, "ip");
  advance(OTP_LIFETIME_MS); await assert.rejects(serializable(db, tx => service.consume(tx, proof.verificationToken, "customer@example.com")));
});

test("cooldown/hour/day limits survive fresh challenges and concurrent sends", async () => {
  const { service, advance, sent } = setup();
  const concurrent = await Promise.allSettled([1, 2].map(() => service.request("customer@example.com", "ip")));
  assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(sent.length, 1);
  for (let n = 0; n < 4; n++) { advance(61_000); await service.request("customer@example.com", "ip"); }
  advance(61_000); await assert.rejects(service.request("customer@example.com", "ip"), (e: any) => e.statusCode === 429 && e.retryAfter > 0);
  advance(3600_000);
  for (let n = 0; n < 5; n++) { advance(61_000); await service.request("customer@example.com", "ip"); }
  advance(3600_000); await assert.rejects(service.request("customer@example.com", "another-ip"), (e: any) => e.statusCode === 429);
});

test("new challenge invalidates previous proof; concurrent confirmation yields one proof", async () => {
  const { db, service, advance, sent } = setup();
  const c = await service.request("customer@example.com", "ip");
  const results = await Promise.allSettled([1, 2].map(() => service.confirm(c.challengeId, sent[0].code, "ip")));
  const success = results.filter(r => r.status === "fulfilled"); assert.equal(success.length, 1);
  advance(61_000); await service.request("customer@example.com", "ip");
  await assert.rejects(serializable(db, tx => service.consume(tx, (success[0] as PromiseFulfilledResult<any>).value.verificationToken, "customer@example.com")));
});

test("failed or ambiguous delivery never permits confirmation", async () => {
  for (const code of ["EMAIL_REJECTED", "EMAIL_DELIVERY_UNKNOWN"]) {
    const db = verificationTestDatabase();
    let sentCode = "";
    const service = createRegistrationVerification(db, { hmacKey: () => "isolated-test-key-not-a-real-secret-123", assertDeliveryConfigured: () => {}, send: async (_email, value) => { sentCode = value; throw new VerificationError(503, code, "Unavailable"); } });
    await assert.rejects(service.request("customer@example.com", "ip"));
    const [row] = await db.registrationVerificationChallenge.findMany({});
    assert.equal(row.codeDigest, null);
    assert.equal(row.deliveryState, code === "EMAIL_REJECTED" ? "FAILED" : "UNKNOWN");
    await assert.rejects(service.confirm(row.id, sentCode, "ip"));
  }
});

test("serializable conflicts are retried with a bounded retry count", async () => {
  let attempts = 0;
  const db = { $transaction: async () => { if (++attempts < 3) throw { code: "P2034" }; return "ok"; } };
  assert.equal(await serializable(db, async () => "ok"), "ok");
  assert.equal(attempts, 3);
});
