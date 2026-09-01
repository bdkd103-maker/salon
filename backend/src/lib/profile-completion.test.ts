import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { calculateProfileCompletion } from "./profile-completion.js";

describe("calculateProfileCompletion", () => {
  it("returns a realistic percentage and missing items from real salon data", () => {
    const completion = calculateProfileCompletion({
      name: "The Grooming Room",
      description: "Modern barber studio",
      address: "Berlin",
      phone: "+491234",
      openingTime: "09:00",
      closingTime: "19:00",
      services: [{ id: "1", price: 25 }],
      website: "https://example.com",
      categories: ["Haircut"],
      media: [{ id: "m1" }],
    });

    assert.equal(completion.completion, 100);
    assert.deepEqual(completion.missing, []);

    const incomplete = calculateProfileCompletion({
      name: "The Grooming Room",
      address: "Berlin",
      phone: "+491234",
      services: [{ id: "1", price: 25 }],
    });

    assert.ok(incomplete.completion < 100);
    assert.ok(incomplete.missing.includes("Öffnungszeiten hinzufügen"));
    assert.ok(incomplete.missing.includes("Fotos hinzufügen"));
  });
});
