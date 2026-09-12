import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { hashPassword } from "../lib/auth.js";
import { createCustomerPasswordReset } from "../lib/customer-password-reset.js";
import { prisma } from "../lib/prisma.js";
import { verificationTestDatabase } from "../lib/registration-verification.test-support.js";
import { authRoutes } from "./auth.js";

test("public CUSTOMER password-reset routes are enumeration-resistant and preserve normal login", async () => {
  const db = verificationTestDatabase();
  const original = { transaction: prisma.$transaction, user: prisma.user, session: prisma.session };
  const mutable = prisma as any;
  mutable.$transaction = db.$transaction;
  mutable.user = db.user;
  mutable.session = db.session;
  process.env.JWT_ACCESS_SECRET = "isolated-reset-test-access";
  process.env.JWT_REFRESH_SECRET = "isolated-reset-test-refresh";

  await db.user.create({ data: {
    id: "customer-1",
    email: "customer@example.com",
    fullName: "Customer One",
    role: "CUSTOMER",
    status: "ACTIVE",
    passwordHash: await hashPassword("OriginalPassword123"),
  } });
  await db.user.create({ data: {
    id: "owner-1",
    email: "owner@example.com",
    fullName: "Owner One",
    role: "OWNER",
    status: "ACTIVE",
    passwordHash: await hashPassword("OwnerPassword123"),
  } });
  await db.session.create({ data: { id: "old-session", userId: "customer-1", revokedAt: null } });

  let deliveredCode = "";
  const resetService = createCustomerPasswordReset(db, {
    hmacKey: () => "isolated-test-key-not-a-real-secret-123",
    assertDeliveryConfigured: () => {},
    send: async (_destination, code) => {
      deliveredCode = code;
      return "test-provider-id";
    },
  });
  const unusedRegistrationVerification = {
    request: async () => { throw new Error("Registration verification is not part of this test"); },
    confirm: async () => { throw new Error("Registration verification is not part of this test"); },
    consume: async () => { throw new Error("Registration verification is not part of this test"); },
  };
  const app = Fastify();
  await authRoutes(app, unusedRegistrationVerification, resetService);
  const post = (path: string, payload: any) => app.inject({ method: "POST", url: `/api/v1/auth/password-reset/${path}`, payload });

  try {
    const customerRequest = await post("request", { email: " CUSTOMER@example.com " });
    const missingRequest = await post("request", { email: "missing@example.com" });
    const ownerRequest = await post("request", { email: "owner@example.com" });
    assert.equal(customerRequest.statusCode, 202);
    assert.equal(missingRequest.statusCode, 202);
    assert.equal(ownerRequest.statusCode, 202);
    assert.deepEqual(Object.keys(customerRequest.json()), Object.keys(missingRequest.json()));
    assert.deepEqual(Object.keys(customerRequest.json()), Object.keys(ownerRequest.json()));
    assert.equal(customerRequest.body.includes(deliveredCode), false);

    const challengeId = customerRequest.json().challengeId;
    const confirmed = await post("confirm", { challengeId, code: deliveredCode });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const resetToken = confirmed.json().resetToken;
    assert.equal(confirmed.body.includes(deliveredCode), false);

    const completed = await post("complete", { resetToken, newPassword: "ReplacementPassword123" });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.deepEqual(completed.json(), { reset: true });
    assert.equal(completed.body.includes("ReplacementPassword123"), false);
    assert.ok((await db.session.findUnique({ where: { id: "old-session" } })).revokedAt);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "customer@example.com", password: "OriginalPassword123" },
    });
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "customer@example.com", password: "ReplacementPassword123" },
    });
    assert.equal(oldLogin.statusCode, 401);
    assert.equal(newLogin.statusCode, 200, newLogin.body);
    assert.equal(newLogin.json().user.role, "CUSTOMER");

    const reused = await post("complete", { resetToken, newPassword: "AnotherPassword123" });
    assert.equal(reused.statusCode, 400);
    const owner = await db.user.findUnique({ where: { id: "owner-1" } });
    const ownerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: owner.email, password: "OwnerPassword123" },
    });
    assert.equal(ownerLogin.statusCode, 200);
  } finally {
    mutable.$transaction = original.transaction;
    mutable.user = original.user;
    mutable.session = original.session;
    await app.close();
  }
});
