import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeEventType } from "./analytics.js";

describe("normalizeEventType", () => {
  it("maps friendly UI labels to the canonical analytics event names", () => {
    assert.equal(normalizeEventType("profile view"), "profile_view");
    assert.equal(normalizeEventType("search impression"), "search_impression");
    assert.equal(normalizeEventType("phone click"), "phone_click");
    assert.equal(normalizeEventType("route click"), "route_click");
    assert.equal(normalizeEventType("booking click"), "booking_click");
    assert.equal(normalizeEventType("favorite click"), "favorite_click");
    assert.equal(normalizeEventType("loyalty view"), "loyalty_view");
    assert.equal(normalizeEventType("stempel usage"), "loyalty_view");
    assert.equal(normalizeEventType("offer view"), "offer_view");
    assert.equal(normalizeEventType("boost impression"), "boost_impression");
    assert.equal(normalizeEventType("boost views"), "boost_impression");
    assert.equal(normalizeEventType("new customer"), "new_customer");
    assert.equal(normalizeEventType("referral click"), "referral_click");
    assert.equal(normalizeEventType("referral customer"), "referral_new_customer");
    assert.equal(normalizeEventType("new customer via referral"), "referral_new_customer");
  });
});
