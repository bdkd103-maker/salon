import assert from "node:assert/strict";
test("group1 Review qualifies only with complete persisted content and no inbound row dependencies", async () => {
  const { buildSalonArchiveState } = await import("./salon-archive.js");
  const model = Prisma.dmmf.datamodel.models.find(model => model.name === "Review")!;
  const fields = ["id", "salonId", "userId", "rating", "comment", "createdAt"];
  assert.deepEqual(model.fields.filter(field => field.kind !== "object").map(field => field.name).sort(),
    [...fields].sort(), "new persisted fields require archive/policy review");
  const incoming = Prisma.dmmf.datamodel.models.flatMap(model => model.fields
    .filter(field => field.kind === "object" && field.type === "Review" && (field.relationFromFields?.length ?? 0) > 0));
  assert.deepEqual(incoming, [], "new inbound FK requires policy review");
  const row = { id: "review", salonId: "target", userId: "customer", rating: 4, comment: "Original", createdAt: new Date("2026-01-01T00:00:00Z") };
  const build = (record: typeof row) => buildSalonArchiveState({
    salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [], reviews: [record],
  });
  const before = build(row);
  assert.deepEqual(JSON.parse(before.sourceState.reviewContent![0]),
    ["review", "target", "customer", 4, "Original", "2026-01-01T00:00:00.000Z"]);
  const changes = { id: "review-b", salonId: "other", userId: "other-user", rating: 2, comment: "Changed", createdAt: new Date("2026-02-01T00:00:00Z") };
  for (const field of fields)
    assert.notDeepEqual(build({ ...row, [field]: changes[field as keyof typeof changes] }).sourceState, before.sourceState, field);
  assert.equal(policyApi().classify("Review"), "DELETE_WITH_SALON");
  assert.equal(policyApi().owned("Review", { salonId: "sibling" }, "target"), false);
});
test("group1 incomplete evidence and unresolved references remain blocking despite salonId", () => {
  const { evaluate, classify, owned } = policyApi();
  for (const model of ["Barber", "Service", "AvailabilitySlot", "SalonMedia"]) {
    assert.equal(classify(model), "BLOCKING_UNCLASSIFIED", model);
    assert.equal(owned(model, { salonId: "target" }, "target"), false, model);
    assert.ok(Object.hasOwn(evaluate().classifications, model));
  }
  for (const model of ["Booking", "ServiceVisit", "Message"]) assert.equal(classify(model), "BLOCKING_UNCLASSIFIED");
  assert.equal(evaluate().complete, false);
});
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import * as validation from "./salon-clearance-revalidation.js";

function policyApi() {
  const evaluate = Reflect.get(validation, "evaluateSalonDeletionPolicy");
  const classify = Reflect.get(validation, "classifySalonDeletionModel");
  const owned = Reflect.get(validation, "isTargetSalonOwnedOperationalRecord");
  assert.equal(typeof evaluate, "function", "explicit deletion policy must exist");
  assert.equal(typeof classify, "function");
  assert.equal(typeof owned, "function");
  return { evaluate, classify, owned };
}
test("policy explicitly classifies every current Prisma model", () => {
  const { evaluate } = policyApi();
  const names = [...readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8").matchAll(/^model (\w+) \{/gm)].map(match => match[1]);
  const result = evaluate();
  assert.deepEqual(Object.keys(result.classifications).sort(), names.sort());
  assert.deepEqual(result.unknownModels, []);
  assert.ok(Object.values(result.classifications).every(value =>
    ["DELETE_WITH_SALON", "SURVIVE_AS_INDEPENDENT_HISTORY", "SHARED_OR_GLOBAL_DO_NOT_DELETE", "BLOCKING_UNCLASSIFIED"].includes(value as string)));
});
test("policy unknown model fails closed including a newly generated salon relation", () => {
  const { classify, evaluate } = policyApi();
  assert.equal(classify("NewSalonHistory"), "BLOCKING_UNCLASSIFIED");
  const models = Prisma.dmmf.datamodel.models as any[];
  models.push({ name: "NewSalonHistory", fields: [{ name: "salonId", type: "String" }] });
  try {
    const result = evaluate();
    assert.equal(result.complete, false);
    assert.ok(result.unknownModels.includes("NewSalonHistory"));
    assert.ok(result.blockingModels.includes("NewSalonHistory"));
  } finally { models.pop(); }
});
for (const model of ["User", "UserSubscription", "DeviceToken", "Session", "PasswordReset", "Notification"]) {
  test(`policy preserves shared ${model}`, () => {
    assert.equal(policyApi().classify(model), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
  });
}
for (const model of ["SalonEnforcement", "SalonArchive", "SalonRetentionHold", "SalonPurgeClearance"]) {
  test(`policy preserves independent ${model}`, () => {
    assert.equal(policyApi().classify(model), "SURVIVE_AS_INDEPENDENT_HISTORY");
  });
}
test("policy Message and uncovered lease/history block readiness", () => {
  const { classify, evaluate } = policyApi();
  for (const model of ["Message", "StaffPresenceLease", "Booking", "SalonBoost"])
    assert.equal(classify(model), "BLOCKING_UNCLASSIFIED");
  assert.equal(evaluate().complete, false);
});
test("policy operational allowlist is explicit and never traverses owners or siblings", () => {
  const { evaluate, owned } = policyApi();
  const before = { id: "sibling", salonId: "sibling", ownerId: "owner" };
  const snapshot = structuredClone(before);
  const allowed = Object.entries(evaluate().classifications).filter(([, value]) => value === "DELETE_WITH_SALON").map(([name]) => name).sort();
  assert.deepEqual(allowed, ["Review", "SalonAvailabilitySubscription", "SalonLiveStatus"]);
  for (const model of allowed) {
    assert.equal(owned(model, before, "target"), false);
    assert.equal(owned(model, { salonId: "target" }, "target"), true);
  }
  for (const model of ["User", "UserSubscription", "Salon", "Message", "Unknown"])
    assert.equal(owned(model, { id: "owner", salonId: "target" }, "target"), false);
  assert.deepEqual(before, snapshot);
});
test("policy client arguments cannot replace trusted classification or clear blockers", () => {
  const { evaluate } = policyApi();
  const expected = evaluate();
  assert.deepEqual(evaluate({ force: true, classifications: {}, blockingModels: [] }), expected);
});
