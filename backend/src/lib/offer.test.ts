import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeOfferInput } from "./offer.js";

describe("normalizeOfferInput", () => {
  it("normalizes a last-minute offer payload and preserves required values", () => {
    const offer = normalizeOfferInput({
      title: "🔥 Last Minute",
      description: "20% off haircut today",
      price: "39",
      discount: "20",
      serviceName: "Haarschnitt",
      startAt: "2026-08-30T14:00:00Z",
      endAt: "2026-08-30T17:00:00Z",
      startTime: "14:00",
      endTime: "17:00",
      availableSlots: "2",
      isActive: true,
    });

    assert.equal(offer.title, "🔥 Last Minute");
    assert.equal(offer.price, 39);
    assert.equal(offer.discount, 20);
    assert.equal(offer.serviceName, "Haarschnitt");
    assert.equal(offer.availableSlots, 2);
    assert.equal(offer.isActive, true);
  });
});
