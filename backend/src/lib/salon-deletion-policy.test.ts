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
test("complete policy preserves Message and fails closed for unknown models", () => {
  const { evaluate, classify, owned } = policyApi();
  assert.equal(classify("Message"), "SURVIVE_AS_INDEPENDENT_HISTORY");
  assert.equal(owned("Message", { salonId: "target" }, "target"), false);
  assert.equal(classify("Unknown"), "BLOCKING_UNCLASSIFIED");
  assert.equal(evaluate().complete, true);
});
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
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
test("policy Message survives and Salon completes classification", () => {
  const { classify, evaluate } = policyApi();
  for (const model of ["Message"])
    assert.equal(classify(model), "SURVIVE_AS_INDEPENDENT_HISTORY");
  assert.equal(evaluate().complete, true);
});
test("policy operational allowlist is explicit and never traverses owners or siblings", () => {
  const { evaluate, owned } = policyApi();
  const before = { id: "sibling", salonId: "sibling", ownerId: "owner" };
  const snapshot = structuredClone(before);
  const allowed = Object.entries(evaluate().classifications).filter(([, value]) => value === "DELETE_WITH_SALON").map(([name]) => name).sort();
  assert.deepEqual(allowed, ["AnalyticsEvent", "AvailabilitySlot", "Barber", "Booking", "LoyaltyCard", "LoyaltyCustomer", "LoyaltyStamp", "Offer", "QueueEntry", "Review", "Salon", "SalonAvailabilitySubscription", "SalonBoost", "SalonLiveStatus", "SalonMedia", "Service", "ServiceVisit", "StaffMembership", "StaffPresence", "StaffPresenceLease"]);
  for (const model of allowed) {
    assert.equal(owned(model, before, "target"), false);
    assert.equal(owned(model, model === "Salon" ? { id: "target" } : { salonId: "target" }, "target"), true);
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
    assert.equal(policyApi().classify(name), name === "ServiceVisit" || name === "Booking" || name === "StaffMembership" ? "DELETE_WITH_SALON" : "BLOCKING_UNCLASSIFIED");
    assert.equal(policyApi().owned(name, { salonId: "target" }, "target"), name === "ServiceVisit" || name === "Booking" || name === "StaffMembership");
    assert.equal(policyApi().owned(name, { salonId: "sibling" }, "target"), false);
    assert.equal(policyApi().classify("User"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
    assert.equal(policyApi().evaluate().complete, true);
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

for (const name of ["SalonBoost", "Offer"]) {
  test(`${name} qualifies as a salon-scoped leaf; unassigned and sibling rows survive`, () => {
    const edges = historicalEdges();
    assert.deepEqual(edges.filter(e => e.from === name), [edge(name, "Salon", ["salonId"], ["id"], "Cascade")]);
    assert.deepEqual(edges.filter(e => e.to === name), []);
    const { classify, owned, evaluate } = policyApi();
    assert.equal(classify(name), "DELETE_WITH_SALON");
    assert.equal(owned(name, { salonId: "target" }, "target"), true);
    for (const salonId of [null, undefined, "sibling"])
      assert.equal(owned(name, { salonId }, "target"), false);
    assert.ok(!evaluate().blockingModels.includes(name));
  });
}

test("SalonMedia DB metadata qualifies independently of external media bytes", async () => {
  const { loadSalonArchiveState } = await import("./salon-archive-source.js");
  const fields = ["id", "salonId", "kind", "url", "createdAt"];
  const model = Prisma.dmmf.datamodel.models.find(m => m.name === "SalonMedia")!;
  assert.deepEqual(model.fields.filter(f => f.kind !== "object").map(f => f.name).sort(), [...fields].sort());
  const edges = historicalEdges();
  assert.deepEqual(edges.filter(e => e.from === "SalonMedia"), [edge("SalonMedia", "Salon", ["salonId"], ["id"], "Cascade")]);
  assert.deepEqual(edges.filter(e => e.to === "SalonMedia"), []);
  const row = { id: "media", salonId: "target", kind: "image", url: "https://media.invalid/shared.jpg", createdAt: new Date("2026-01-01T00:00:00Z") };
  // Exercise the trusted loader's exact target predicate and full projection.
  // No external file API is part of this evidence or DB-row classification.
  const load = async (record: typeof row) => {
    const tx = Object.fromEntries(Prisma.dmmf.datamodel.models.map(m => [
      m.name[0].toLowerCase() + m.name.slice(1), { findMany: async () => [] },
    ]));
    (tx as any).salon = { findUnique: async () => rootSalon };
    tx.salonMedia = { findMany: async (...args: any[]) => {
      assert.deepEqual(args[0], { where: { salonId: "target" }, select: Object.fromEntries(fields.map(f => [f, true])) });
      return [record] as any;
    } };
    return loadSalonArchiveState(tx as any, "target");
  };
  const before = await load(row);
  assert.deepEqual(JSON.parse(before.sourceState.salonMediaContent![0]),
    [row.id, row.salonId, row.kind, row.url, row.createdAt.toISOString()]);
  const changes = { ...row, id: "media-b", kind: "video", url: "https://media.invalid/changed.mp4", createdAt: new Date("2026-02-01T00:00:00Z") };
  for (const field of ["id", "kind", "url", "createdAt"] as const)
    assert.notDeepEqual((await load({ ...row, [field]: changes[field] })).sourceState, before.sourceState, field);
  assert.equal(policyApi().classify("SalonMedia"), "DELETE_WITH_SALON");
  assert.equal(policyApi().owned("SalonMedia", row, "target"), true);
  assert.equal(policyApi().owned("SalonMedia", { ...row, salonId: "sibling" }, "target"), false);
});

test("Message survives as independent participant history with three SetNull parents and no children", () => {
  const model = Prisma.dmmf.datamodel.models.find(m => m.name === "Message")!;
  assert.deepEqual(model.fields.filter(f => f.kind !== "object").map(f => f.name).sort(),
    ["id", "salonId", "senderId", "receiverId", "subject", "body", "isRead", "createdAt"].sort());
  const edges = historicalEdges();
  assert.deepEqual(sortedEdges(edges.filter(e => e.from === "Message")), sortedEdges([
    edge("Message", "Salon", ["salonId"], ["id"], "SetNull"),
    edge("Message", "User", ["senderId"], ["id"], "SetNull"),
    edge("Message", "User", ["receiverId"], ["id"], "SetNull"),
  ]));
  assert.deepEqual(edges.filter(e => e.to === "Message"), []);
  assert.equal(policyApi().classify("Message"), "SURVIVE_AS_INDEPENDENT_HISTORY");
  assert.equal(policyApi().owned("Message", { salonId: "target" }, "target"), false);
});

test("Salon root inventory qualifies with V8 evidence and controlled Message detachment", () => {
  const model = Prisma.dmmf.datamodel.models.find(m => m.name === "Salon")!;
  assert.deepEqual(model.fields.filter(f => f.kind !== "object").map(f => f.name).sort(), [
    "id", "ownerId", "name", "slug", "city", "address", "latitude", "longitude", "phone", "email", "website",
    "description", "isVip", "adminVip", "classification", "isWomenOnly", "isActive", "status",
    "bookingIntakeEnabled", "saloTicketIntakeEnabled", "walkInIntakeEnabled", "rating", "reviewCount",
    "openingTime", "closingTime", "workingDays", "timeZone", "createdAt", "updatedAt",
  ].sort());
  const edges = historicalEdges();
  assert.deepEqual(edges.filter(e => e.from === "Salon"), [edge("Salon", "User", ["ownerId"], ["id"], "Cascade")]);
  const children = ["AnalyticsEvent", "AvailabilitySlot", "Barber", "Booking", "LoyaltyCard", "Offer", "QueueEntry",
    "Review", "SalonAvailabilitySubscription", "SalonBoost", "SalonLiveStatus", "SalonMedia", "Service", "ServiceVisit", "StaffMembership"];
  assert.deepEqual(sortedEdges(edges.filter(e => e.to === "Salon")), sortedEdges([
    ...children.map(name => edge(name, "Salon", ["salonId"], ["id"], "Cascade")),
    edge("Message", "Salon", ["salonId"], ["id"], "SetNull"),
  ]));
  for (const child of children) assert.equal(policyApi().classify(child), "DELETE_WITH_SALON");
  for (const name of ["SalonEnforcement", "SalonArchive", "SalonRetentionHold", "SalonPurgeClearance"])
    assert.deepEqual(edges.filter(e => e.from === name || e.to === name), [], `${name} survives without FKs`);
  assert.ok(validation.REQUIRED_ARCHIVE_CATEGORIES.some(category => String(category) === "SALON"));
  assert.deepEqual(policyApi().evaluate().blockingModels, []);
});

test("reviewed root, Message and leaf FK actions agree with checked-in SQL migrations", () => {
  const base = new URL("../../prisma/migrations/", import.meta.url);
  const sql = readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => readFileSync(new URL(`${entry.name}/migration.sql`, base), "utf8")).join("\n");
  for (const e of historicalEdges().filter(e => e.to === "Salon" || ["Salon", "Message", "SalonBoost", "Offer", "SalonMedia"].includes(e.from))) {
    const constraint = `${e.from}_${e.fields!.join("_")}_fkey`;
    const definitions = sql.split(";").filter(statement => statement.includes(`ADD CONSTRAINT "${constraint}"`));
    assert.equal(definitions.length, 1, constraint);
    assert.ok(definitions[0].includes(`REFERENCES "${e.to}"`), constraint);
    assert.ok(definitions[0].includes(`ON DELETE ${e.action === "SetNull" ? "SET NULL" : e.action.toUpperCase()}`), constraint);
    assert.ok(!sql.includes(`DROP CONSTRAINT "${constraint}"`), `${constraint} requires renewed migration review`);
  }
});

test("dependent-first ordering covers every classified FK and preserves independent Message", () => {
  // A schema proof only, never an executable purge plan. Existing same-transaction
  // retention, archive and cross-salon guards must pass before any future writes.
  const order = ["QueueEntry", "ServiceVisit", "Booking", "AvailabilitySlot", "StaffPresenceLease", "StaffPresence",
    "StaffMembership", "Barber", "Service", "LoyaltyStamp", "LoyaltyCustomer", "LoyaltyCard", "AnalyticsEvent",
    "Offer", "Review", "SalonAvailabilitySubscription", "SalonBoost", "SalonLiveStatus", "SalonMedia", "Salon"];
  const { classify, evaluate } = policyApi();
  const children = Object.keys(evaluate().classifications).filter(name => name !== "Salon" && classify(name) === "DELETE_WITH_SALON");
  assert.deepEqual(order.filter(name => name !== "Salon").sort(), children.sort());
  for (const e of historicalEdges().filter(e => order.includes(e.to))) {
    if (e.from === "Message") {
      assert.equal(classify(e.from), "SURVIVE_AS_INDEPENDENT_HISTORY");
      assert.equal(e.action, "SetNull");
      continue; // Approved detachment preserves conversation rows and archived provenance.
    }
    assert.ok(order.includes(e.from), `unhandled surviving reference ${e.from} -> ${e.to}`);
    assert.ok(order.indexOf(e.from) < order.indexOf(e.to), `${e.from} must precede ${e.to}`);
  }
  assert.equal(classify("Salon"), "DELETE_WITH_SALON");
});
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
test("StaffPresenceLease qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, evaluate } = policyApi();
  assert.equal(classify("StaffPresenceLease"), "DELETE_WITH_SALON");
  assert.ok(!evaluate().blockingModels.includes("StaffPresenceLease"));
});
test("StaffPresence qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, evaluate } = policyApi();
  assert.equal(classify("StaffPresence"), "DELETE_WITH_SALON");
  assert.ok(!evaluate().blockingModels.includes("StaffPresence"));
});
test("StaffMembership qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("StaffMembership"), "DELETE_WITH_SALON");
  assert.equal(owned("StaffMembership", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("StaffMembership", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("StaffMembership"));
});
test("AvailabilitySlot qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("AvailabilitySlot"), "DELETE_WITH_SALON");
  assert.equal(owned("AvailabilitySlot", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("AvailabilitySlot", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("AvailabilitySlot"));
});
test("Barber qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("Barber"), "DELETE_WITH_SALON");
  assert.equal(owned("Barber", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("Barber", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("Barber"));
});
test("Service qualifies as DELETE_WITH_SALON with complete archive and cross-salon readiness", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("Service"), "DELETE_WITH_SALON");
  assert.equal(owned("Service", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("Service", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("Service"));
});
test("LoyaltyCard qualifies as DELETE_WITH_SALON with complete archive and salon-scoped cascade", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("LoyaltyCard"), "DELETE_WITH_SALON");
  assert.equal(owned("LoyaltyCard", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("LoyaltyCard", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("LoyaltyCard"));
});
test("LoyaltyCustomer qualifies as DELETE_WITH_SALON with complete archive and cascade ownership", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("LoyaltyCustomer"), "DELETE_WITH_SALON");
  assert.equal(owned("LoyaltyCustomer", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("LoyaltyCustomer", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("LoyaltyCustomer"));
});
test("LoyaltyStamp qualifies as DELETE_WITH_SALON with complete archive and scalar-only barberId", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("LoyaltyStamp"), "DELETE_WITH_SALON");
  assert.equal(owned("LoyaltyStamp", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("LoyaltyStamp", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("LoyaltyStamp"));
});
test("AnalyticsEvent qualifies as DELETE_WITH_SALON with complete archive and leaf salon ownership", async () => {
  const { buildSalonArchiveState } = await import("./salon-archive.js");
  const { classify, owned, evaluate } = policyApi();
  const model = Prisma.dmmf.datamodel.models.find(m => m.name === "AnalyticsEvent")!;
  const fields = ["id", "salonId", "userId", "eventType", "source", "metadata", "createdAt"];
  assert.deepEqual(model.fields.filter(f => f.kind !== "object").map(f => f.name).sort(),
    [...fields].sort(), "new persisted fields require archive/policy review");
  const incoming = Prisma.dmmf.datamodel.models.flatMap(m => m.fields
    .filter(f => f.kind === "object" && f.type === "AnalyticsEvent" && (f.relationFromFields?.length ?? 0) > 0));
  assert.deepEqual(incoming, [], "new inbound FK requires policy review");
  const row = { id: "ev-1", salonId: "target", userId: "user-1", eventType: "profile_view", source: "app", metadata: { page: "home" }, createdAt: new Date("2026-01-01T00:00:00Z") };
  const build = (record: typeof row) => buildSalonArchiveState({
    salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [], analyticsEvents: [record],
  });
  const before = build(row);
  assert.deepEqual(JSON.parse(before.sourceState.analyticsEventContent![0]),
    ["ev-1", "target", "user-1", "profile_view", "app", { page: "home" }, "2026-01-01T00:00:00.000Z"]);
  const changes = { id: "ev-2", salonId: "other", userId: "other-user", eventType: "booking_view", source: "web", metadata: { page: "booking" }, createdAt: new Date("2026-02-01T00:00:00Z") };
  for (const field of fields.filter(f => f !== "salonId"))
    assert.notDeepEqual(build({ ...row, [field]: changes[field as keyof typeof changes] }).sourceState, before.sourceState, field);
  assert.equal(classify("AnalyticsEvent"), "DELETE_WITH_SALON");
  assert.equal(owned("AnalyticsEvent", { salonId: "sibling" }, "target"), false);
  assert.equal(owned("AnalyticsEvent", { salonId: "target" }, "target"), true);
  assert.ok(!evaluate().blockingModels.includes("AnalyticsEvent"));
});
test("historical policy StaffMembership: ServiceVisit Restrict resolves before parent; presence and leases are salon-scoped children", () => {
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
  for (const name of ["StaffMembership", "StaffPresence", "StaffPresenceLease"]) assert.equal(policyApi().classify(name), "DELETE_WITH_SALON");
});
test("historical policy leaves unrelated classifications and shared identities unchanged", () => {
  for (const name of ["Message"]) assert.equal(policyApi().classify(name), "SURVIVE_AS_INDEPENDENT_HISTORY");
  assert.equal(policyApi().classify("Review"), "DELETE_WITH_SALON");
  assert.equal(policyApi().classify("UnknownHistory"), "BLOCKING_UNCLASSIFIED");
  assert.equal(policyApi().classify("User"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
  assert.equal(policyApi().classify("UserSubscription"), "SHARED_OR_GLOBAL_DO_NOT_DELETE");
});

const rootSalon = {
  id: "target", ownerId: "owner", name: "SALO", slug: "salo", city: "Berlin", address: "Main 1",
  latitude: null, longitude: null, phone: "123", email: null, website: null, description: null,
  isVip: false, adminVip: false, classification: "REGULAR", isWomenOnly: false, isActive: true, status: "OPEN",
  bookingIntakeEnabled: true, saloTicketIntakeEnabled: true, walkInIntakeEnabled: true,
  rating: 0, reviewCount: 0, openingTime: null, closingTime: null, workingDays: ["MON"], timeZone: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
};

test("Salon ownership uses its primary key, never a client-shaped salonId", () => {
  const { classify, owned, evaluate } = policyApi();
  assert.equal(classify("Salon"), "DELETE_WITH_SALON");
  assert.equal(owned("Salon", { id: "target" }, "target"), true);
  assert.equal(owned("Salon", { id: "sibling", salonId: "target" }, "target"), false);
  assert.equal(owned("Salon", { salonId: "target" }, "target"), false);
  assert.equal(owned("Salon", { id: "" }, ""), false);
  assert.deepEqual(evaluate().blockingModels, []);
});
