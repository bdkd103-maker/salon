import test from "node:test";
import assert from "node:assert/strict";
import { sendVerificationEmail } from "./verification-email.js";
const config = { apiKey: "isolated-test-value", from: "onboarding@resend.dev", mode: "testing" };
test("provider acceptance requires a message id and uses server-only authentication/idempotency", async () => {
  const id = await sendVerificationEmail("customer@example.com", "123456", "generation-id", config, (async (url: any, options: any) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers["Idempotency-Key"], "generation-id");
    assert.equal(JSON.parse(options.body).to[0], "customer@example.com");
    return new Response(JSON.stringify({ id: "provider-id" }), { status: 200 });
  }) as typeof fetch);
  assert.equal(id, "provider-id");
});
test("unconfigured/production testing sender fails before any network request", async () => {
  for (const settings of [{}, { ...config, mode: "production" }]) {
    await assert.rejects(sendVerificationEmail("customer@example.com", "123456", "id", settings, (async () => { assert.fail("No network permitted"); }) as typeof fetch), (e: any) => e.code === "EMAIL_UNAVAILABLE");
  }
});
test("provider errors and timeouts never become successful delivery or leak raw responses", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    await assert.rejects(sendVerificationEmail("customer@example.com", "123456", "id", config, (async () => new Response("private provider details", { status })) as typeof fetch), (e: any) => e.statusCode === 503 && !e.message.includes("private provider details"));
  }
  await assert.rejects(sendVerificationEmail("customer@example.com", "123456", "id", config, (async () => { throw new Error("private transport details"); }) as typeof fetch), (e: any) => e.code === "EMAIL_DELIVERY_UNKNOWN" && !e.message.includes("private"));
  await assert.rejects(sendVerificationEmail("customer@example.com", "123456", "id", config, (async () => new Response("{}", { status: 200 })) as typeof fetch));
});
