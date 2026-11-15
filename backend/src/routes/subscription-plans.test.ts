import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { dashboardRoutes } from "./dashboard.js";

const original = { user: prisma.user, userSubscription: prisma.userSubscription };
afterEach(() => Object.assign(prisma, original));

for (const method of ["GET", "POST"] as const) {
  test(`${method} subscription preserves SMART and unresolved price`, async () => {
    process.env.JWT_ACCESS_SECRET = "subscription-plan-test-secret";
    const subscription = { id: "sub-1", userId: "owner-1", plan: "SMART", status: "ACTIVE", monthlyPrice: null };
    let written: any;
    (prisma as any).user = { findUnique: async () => ({ id: "owner-1", role: "OWNER", status: "ACTIVE" }) };
    (prisma as any).userSubscription = {
      findUnique: async () => subscription,
      upsert: async (args: any) => { written = args; return { ...subscription, ...args.update }; },
    };
    const app = Fastify();
    try {
      await dashboardRoutes(app);
      const response = await app.inject({
        method, url: "/api/v1/subscriptions/me",
        headers: { authorization: `Bearer ${signAccessToken({ sub: "owner-1", role: "OWNER" })}` },
        ...(method === "POST" ? { payload: { plan: "SMART", status: "ACTIVE" } } : {}),
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().subscription.plan, "SMART");
      assert.equal(response.json().subscription.monthlyPrice, null);
      assert.equal(response.json().subscription.meta.monthlyPrice, null);
      if (method === "POST") {
        assert.equal(written.create.plan, "SMART");
        assert.equal(written.update.plan, "SMART");
        assert.equal(written.create.monthlyPrice, null);
        assert.equal(written.update.monthlyPrice, null);
      }
    } finally { await app.close(); }
  });
}

test("OWNER can cancel an existing plan without triggering the self-escalation guard", async () => {
  process.env.JWT_ACCESS_SECRET = "subscription-plan-test-secret";
  const subscription = { id: "sub-2", userId: "owner-2", plan: "PRO", status: "ACTIVE", monthlyPrice: 19 };
  let written: any;
  (prisma as any).user = { findUnique: async () => ({ id: "owner-2", role: "OWNER", status: "ACTIVE" }) };
  (prisma as any).userSubscription = {
    findUnique: async () => subscription,
    upsert: async (args: any) => { written = args; return { ...subscription, ...args.update }; },
  };
  const app = Fastify();
  try {
    await dashboardRoutes(app);
    const response = await app.inject({
      method: "POST", url: "/api/v1/subscriptions/me",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "owner-2", role: "OWNER" })}` },
      payload: { plan: "PRO", status: "CANCELLED" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().subscription.status, "CANCELLED");
    assert.equal(written.update.status, "CANCELLED");
    assert.ok(written.update.cancellationDate, "cancellation date must be recorded");
  } finally { await app.close(); }
});
