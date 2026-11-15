import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { analyticsRoutes } from "./analytics.js";

// Fastify and real JWT verification; all persistence is replaced with test doubles.
const mock = prisma as any;
const original = { user: mock.user, salon: mock.salon, analyticsEvent: mock.analyticsEvent };
const originalSecret = process.env.JWT_ACCESS_SECRET;
let writes: any[], lookups: string[], logs: string[], failWrite: boolean;
beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "analytics-route-test-secret";
  writes = []; lookups = []; logs = []; failWrite = false;
  mock.user = { findUnique: async ({ where }: any) => where.id === "customer"
    ? { id: "customer", role: "CUSTOMER", status: "ACTIVE" } : null };
  mock.salon = { findUnique: async ({ where }: any) => {
    lookups.push(where.id);
    return ["public-a", "public-b"].includes(where.id) ? { id: where.id, ownerId: "unrelated-owner", isActive: true } : null;
  } };
  mock.analyticsEvent = { create: async ({ data }: any) => {
    if (failWrite) throw new Error("Test persistence failure");
    writes.push(data); return { id: "event", ...data };
  } };
});
afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = originalSecret;
});
function validAuth() { return `Bearer ${signAccessToken({ sub: "customer", role: "CUSTOMER" })}`; }
async function post(payload: any, authorization?: string) {
  const app = Fastify({ logger: { stream: { write: (line: string) => { logs.push(line); } } } });
  await app.register(analyticsRoutes);
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/analytics/events", payload,
      headers: authorization === undefined ? {} : { authorization } });
    // Give async handlers time to finish even when the auth helper sent early.
    await new Promise(resolve => setImmediate(resolve));
    return response;
  } finally { await app.close(); }
}
for (const kind of ["missing", "empty", "invalid", "expired"] as const) {
  test(`rejects ${kind} authentication without lookups, writes or duplicate replies`, async () => {
    const authorization = kind === "missing" ? undefined : kind === "empty" ? "Bearer " : kind === "invalid" ? "Bearer invalid-token"
      : `Bearer ${jwt.sign({ sub: "customer", role: "CUSTOMER" }, process.env.JWT_ACCESS_SECRET!, { expiresIn: -1 })}`;
    const response = await post({ salonId: "public-a", eventType: "profile_view" }, authorization);
    assert.equal(response.statusCode, 401);
    assert.ok(!logs.join("").includes("FST_ERR_REP_ALREADY_SENT"), "must not send a second reply after auth rejection");
    assert.deepEqual(writes, []);
    assert.deepEqual(lookups, []);
  });
}
for (const salonId of [undefined, "", "   ", null]) {
  test(`rejects missing/empty salonId ${JSON.stringify(salonId)} with 400`, async () => {
    const response = await post({ salonId, eventType: "profile_view" }, validAuth());
    assert.equal(response.statusCode, 400); assert.deepEqual(writes, []); assert.deepEqual(lookups, []);
  });
}
test("nonexistent salon returns 404 before creating an event", async () => {
  const response = await post({ salonId: "missing", eventType: "profile_view" }, validAuth());
  assert.equal(response.statusCode, 404); assert.deepEqual(writes, []); assert.deepEqual(lookups, ["missing"]);
});
test("customer discovery is allowed for unrelated public salons without prior relationships", async () => {
  // No booking, favorite or membership delegate is provided or needed.
  for (const salonId of ["public-a", "public-b"]) {
    const response = await post({ salonId, eventType: "search_impression", userId: "forged-user" }, validAuth());
    assert.equal(response.statusCode, 200); assert.equal(response.json().ok, true);
    assert.equal(response.json().event.userId, "customer");
  }
  assert.equal(writes.length, 2);
});
const eventTypes = ["profile_view", "search_impression", "phone_click", "route_click", "booking_click", "favorite_click", "loyalty_view", "offer_view", "boost_impression", "new_customer", "referral_click", "referral_new_customer"];
test("preserves all current canonical event types", async () => {
  for (const eventType of eventTypes) {
    const response = await post({ salonId: "public-a", eventType }, validAuth());
    assert.equal(response.statusCode, 200); assert.equal(response.json().event.eventType, eventType);
  }
});
test("preserves normalization, default source and metadata, and unknown-type fallback", async () => {
  for (const [input, expected] of [["  PHONE-CLICKS  ", "phone_click"], ["Search Impressions", "search_impression"], ["referral_conversion", "referral_new_customer"], ["unknown", "profile_view"]]) {
    const response = await post({ salonId: " public-a ", eventType: input, source: "" }, validAuth());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().event, { id: "event", salonId: "public-a", userId: "customer", eventType: expected, source: "app", metadata: {} });
  }
  const response = await post({ salonId: "public-a", eventType: "profile", source: " directory_card ", metadata: { query: "Berlin" } }, validAuth());
  assert.equal(response.json().event.source, "directory_card");
  assert.deepEqual(response.json().event.metadata, { query: "Berlin" });
});
test("retains payload validation and persistence error response", async () => {
  assert.equal((await post({ salonId: "public-a", eventType: " " }, validAuth())).statusCode, 400);
  failWrite = true;
  const response = await post({ salonId: "public-a", eventType: "profile_view" }, validAuth());
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "Failed to track analytics event" });
});
