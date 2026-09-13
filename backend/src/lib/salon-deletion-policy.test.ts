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
  for (const model of ["Message"]) assert.equal(classify(model), "BLOCKING_UNCLASSIFIED");
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
  for (const model of ["Message", "StaffPresenceLease", "SalonBoost"])
    assert.equal(classify(model), "BLOCKING_UNCLASSIFIED");
  assert.equal(evaluate().complete, false);
});
test("policy operational allowlist is explicit and never traverses owners or siblings", () => {
  const { evaluate, owned } = policyApi();
  const before = { id: "sibling", salonId: "sibling", ownerId: "owner" };
  const snapshot = structuredClone(before);
  const allowed = Object.entries(evaluate().classifications).filter(([, value]) => value === "DELETE_WITH_SALON").map(([name]) => name).sort();
  assert.deepEqual(allowed, ["Booking", "QueueEntry", "Review", "SalonAvailabilitySubscription", "SalonLiveStatus", "ServiceVisit"]);
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

// Complete persisted V2 fixtures for policy proof.
const v2Booking = {"id": "b", "salonId": "target", "userId": "customer", "barberId": null, "serviceId": null, "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-01-01T00:00:00.000Z", "status": "COMPLETED", "notes": null, "customerName": null, "customerPhone": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "cancelledAt": null, "cancellationReason": null};
const v2Visit = {"id": "v", "salonId": "target", "bookingId": null, "staffMembershipId": "m", "source": "WALK_IN", "status": "COMPLETED", "startedAt": "2026-01-01T00:00:00.000Z", "completedAt": null, "cancelledAt": null, "version": 1, "startedByUserId": null, "completedByUserId": null, "cancelledByUserId": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const v2Membership = {"id": "m", "salonId": "target", "userId": "owner", "barberId": "barber", "status": "ACTIVE", "revokedAt": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const historicalPolicyCases = [
  ["Booking", "bookings", "bookingContent", v2Booking],
  ["ServiceVisit", "serviceVisits", "serviceVisitContent", v2Visit],
  ["StaffMembership", "staffMemberships", "staffMembershipContent", v2Membership],
] as const;
for (const [name, category, content, row] of historicalPolicyCases) {
  test(`historical policy ${name}: complete V2 evidence does not clear unresolved dependencies`, async () => {
    const { buildSalonArchiveState } = await import("./salon-archive.js");
    const model = Prisma.dmmf.datamodel.models.find(model => model.name === name)!;
    assert.deepEqual(model.fields.filter(field => field.kind !== "object").map(field => field.name).sort(), Object.keys(row).sort());
    const input = { salonId: "target", bookingIds: category === "bookings" ? [row.id] : [], serviceVisitIds: category === "serviceVisits" ? [row.id] : [], salonBoostIds: [], [category]: [row] };
    const evidence = buildSalonArchiveState(input, { archiveVersion: 2, payloadVersion: 2 });
    assert.equal(evidence.archiveVersion, 2);
    assert.equal(evidence.payloadVersion, 2);
    assert.deepEqual(JSON.parse(evidence.sourceState[content]![0]), Object.values(row));
    assert.throws(() => buildSalonArchiveState({ ...input, [category]: [{ ...row, salonId: "sibling" }] }), /another salon/);
    assert.equal(policyApi().classify(name), name === "ServiceVisit" || name === "Booking" ? "DELETE_WITH_SALON" : "BLOCKING_UNCLASSIFIED");
    assert.equal(policyApi().owned(name, { salonId: "target" }, "target"), name === "ServiceVisit" || name === "Booking");
    assert.equal(policyApi().owned(name, { salonId: "sibling" }, "target"), false);
    assert.equal(policyApi().classify("User"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
    assert.equal(policyApi().evaluate().complete, false);
  });
}
// FK-owning fields describe cascade direction; inverse parent arrays do not.
function historicalEdges() {
  return Prisma.dmmf.datamodel.models.flatMap(model => model.fields
    .filter(field => field.kind === "object" && (field.relationFromFields?.length ?? 0) > 0)
    .map(field => ({ from: model.name, to: field.type, fields: field.relationFromFields, references: field.relationToFields,
      action: field.relationOnDelete ?? (field.isRequired ? "Restrict" : "SetNull") })));
}
function edge(from: string, to: string, fields: string[], references: string[], action: string) {
  return { from, to, fields, references, action };
}
function sortedEdges(edges: ReturnType<typeof historicalEdges>) {
  return edges.map(value => JSON.stringify(value)).sort();
}
test("historical policy Booking: ServiceVisit Restrict must be resolved first; parents survive", () => {
  const edges = historicalEdges();
  assert.deepEqual(sortedEdges(edges.filter(e => e.from === "Booking")), sortedEdges([
    edge("Booking", "Salon", ["salonId"], ["id"], "Cascade"),
    edge("Booking", "User", ["userId"], ["id"], "Cascade"),
    edge("Booking", "Barber", ["barberId"], ["id"], "SetNull"),
    edge("Booking", "Service", ["serviceId"], ["id"], "SetNull"),
  ]));
  assert.deepEqual(edges.filter(e => e.to === "Booking"), [edge("ServiceVisit", "Booking", ["bookingId", "salonId"], ["id", "salonId"], "Restrict")]);
  assert.equal(policyApi().classify("ServiceVisit"), "DELETE_WITH_SALON");
});
test("historical policy ServiceVisit: QueueEntry Restrict lacks a salon composite FK", () => {
  const edges = historicalEdges();
  assert.deepEqual(sortedEdges(edges.filter(e => e.from === "ServiceVisit")), sortedEdges([
    edge("ServiceVisit", "Salon", ["salonId"], ["id"], "Cascade"),
    edge("ServiceVisit", "Booking", ["bookingId", "salonId"], ["id", "salonId"], "Restrict"),
    edge("ServiceVisit", "StaffMembership", ["staffMembershipId", "salonId"], ["id", "salonId"], "Restrict"),
    ...["startedByUserId", "completedByUserId", "cancelledByUserId"].map(field => edge("ServiceVisit", "User", [field], ["id"], "SetNull")),
  ]));
  assert.deepEqual(edges.filter(e => e.to === "ServiceVisit"), [edge("QueueEntry", "ServiceVisit", ["serviceVisitId"], ["id"], "Restrict")]);
  assert.equal(policyApi().classify("QueueEntry"), "DELETE_WITH_SALON");
  assert.equal(policyApi().classify("ServiceVisit"), "DELETE_WITH_SALON");
});
test("QueueEntry qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("QueueEntry"), "DELETE_WITH_SALON");
  assert.equal(owned("QueueEntry", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("QueueEntry", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("QueueEntry"));
});
test("ServiceVisit qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("ServiceVisit"), "DELETE_WITH_SALON");
  assert.equal(owned("ServiceVisit", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("ServiceVisit", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("ServiceVisit"));
});
test("Booking qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("Booking"), "DELETE_WITH_SALON");
  assert.equal(owned("Booking", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("Booking", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("Booking"));
});
test("historical policy StaffMembership: Restrict visits and cascading presence/leases remain blockers", () => {
  const edges = historicalEdges();
  assert.deepEqual(sortedEdges(edges.filter(e => e.from === "StaffMembership")), sortedEdges([
    edge("StaffMembership", "Salon", ["salonId"], ["id"], "Cascade"),
    edge("StaffMembership", "User", ["userId"], ["id"], "Cascade"),
    edge("StaffMembership", "Barber", ["barberId", "salonId"], ["id", "salonId"], "Cascade"),
  ]));
  assert.deepEqual(sortedEdges(edges.filter(e => e.to === "StaffMembership")), sortedEdges([
    edge("ServiceVisit", "StaffMembership", ["staffMembershipId", "salonId"], ["id", "salonId"], "Restrict"),
    edge("StaffPresence", "StaffMembership", ["staffMembershipId"], ["id"], "Cascade"),
  ]));
  assert.deepEqual(edges.filter(e => e.to === "StaffPresence"), [edge("StaffPresenceLease", "StaffPresence", ["staffMembershipId"], ["staffMembershipId"], "Cascade")]);
  assert.deepEqual(edges.filter(e => e.to === "StaffPresenceLease"), []);
  for (const name of ["StaffMembership", "StaffPresence", "StaffPresenceLease"]) assert.equal(policyApi().classify(name), "BLOCKING_UNCLASSIFIED");
});
test("historical policy leaves unrelated classifications and shared identities unchanged", () => {
  for (const name of ["Barber", "Service", "Message", "LoyaltyCard", "LoyaltyCustomer", "LoyaltyStamp"]) assert.equal(policyApi().classify(name), "BLOCKING_UNCLASSIFIED");
  assert.equal(policyApi().classify("Review"), "DELETE_WITH_SALON");
  assert.equal(policyApi().classify("UnknownHistory"), "BLOCKING_UNCLASSIFIED");
  assert.equal(policyApi().classify("User"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
  assert.equal(policyApi().classify("UserSubscription"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
});
