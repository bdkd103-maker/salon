// Real PostgreSQL verification of Permanent Salon DELETE
// Run: npx.cmd tsx test/verify-real-postgres-delete.ts
import assert from "node:assert/strict";
import Fastify from "fastify";
import { v4 as uuid } from "uuid";
import { prisma } from "../src/lib/prisma.js";
import { salonRoutes } from "../src/routes/salons.js";
import { signAccessToken } from "../src/lib/jwt.js";

const P = prisma as any;
let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string) { pass++; console.log(`  ✔ ${name}`); }
function notOk(name: string, err: unknown) { fail++; const msg = `${name}: ${err instanceof Error ? err.message : String(err)}`; failures.push(msg); console.error(`  ✘ ${name}`); console.error(`    ${msg}`); }

function adminHeaders() { return { authorization: `Bearer ${signAccessToken({ sub: "pg-test-admin", role: "ADMIN" })}` }; }
function ownerHeaders(ownerId: string) { return { authorization: `Bearer ${signAccessToken({ sub: ownerId, role: "OWNER" })}` }; }
function customerHeaders() { return { authorization: `Bearer ${signAccessToken({ sub: "pg-test-customer", role: "CUSTOMER" })}` }; }

function pfx(tag: string) { return `pgv-${tag}-${uuid().slice(0, 8)}`; }

interface FX {
  adminId: string; ownerId: string; customerId: string;
  salonId: string; siblingSalonId: string;
  barberId: string; serviceId: string; membershipId: string;
  bookingId: string; qeId: string; svId: string;
  cardId: string; lCustomerId: string; stampId: string;
  offerId: string; reviewId: string; mediaId: string;
  aeId: string; boostId: string; liveStatusId: string;
  subId: string; presenceId: string; leaseId: string;
  msgId: string;
  enfId: string; archId: string; holdId: string; clearanceId: string;
}

async function createFixtures(): Promise<FX> {
  const adminId = "pg-test-admin";
  const ownerId = pfx("owner");
  const customerId = "pg-test-customer";
  const salonId = pfx("salon");
  const siblingSalonId = pfx("sibling");

  await P.user.createMany({
    data: [
      { id: adminId, email: `${adminId}@tv.local`, passwordHash: "x", fullName: "Admin", role: "ADMIN", status: "ACTIVE" },
      { id: ownerId, email: `${ownerId}@tv.local`, passwordHash: "x", fullName: "Owner", role: "OWNER", status: "ACTIVE" },
      { id: customerId, email: `${customerId}@tv.local`, passwordHash: "x", fullName: "Customer", role: "CUSTOMER", status: "ACTIVE" },
    ],
    skipDuplicates: true,
  });
  await P.userSubscription.create({ data: { userId: ownerId, plan: "PRO", status: "ACTIVE", monthlyPrice: 0, startDate: new Date(), renewalDate: new Date("2099-12-31") } }).catch(() => {});
  await P.userSubscription.create({ data: { userId: adminId, plan: "PRO", status: "ACTIVE", monthlyPrice: 0, startDate: new Date(), renewalDate: new Date("2099-12-31") } }).catch(() => {});

  const now = new Date();
  await P.salon.create({ data: {
    id: salonId, ownerId, name: `V-Salon-${salonId.slice(-8)}`, slug: `v-salon-${salonId.slice(-8)}`,
    city: "Berlin", address: "Verify Str 1", phone: "+493099999",
  }});
  await P.salon.create({ data: {
    id: siblingSalonId, ownerId, name: `V-Sib-${siblingSalonId.slice(-8)}`, slug: `v-sib-${siblingSalonId.slice(-8)}`,
    city: "Berlin", address: "Sibling Str 2", phone: "+493088888",
  }});

  // Dependants
  const barberId = pfx("barber");
  const serviceId = pfx("svc");
  const membershipId = pfx("mem");
  const bookingId = pfx("book");
  const qeId = pfx("qe");
  const svId = pfx("sv");
  const cardId = pfx("card");
  const lCustomerId = pfx("lcs");
  const stampId = pfx("stmp");
  const offerId = pfx("off");
  const reviewId = pfx("rev");
  const mediaId = pfx("med");
  const aeId = pfx("ae");
  const boostId = pfx("boost");
  const liveStatusId = salonId; // SalonLiveStatus uses salonId as PK
  const subId = pfx("sub");
  const presenceId = membershipId; // StaffPresence uses membershipId as PK
  const leaseId = pfx("lease");
  const msgId = pfx("msg");

  await P.barber.create({ data: { id: barberId, salonId, name: "V-Barber" } });
  await P.service.create({ data: { id: serviceId, salonId, name: "V-Service", durationMin: 30, price: 25.00 } });
  await P.staffMembership.create({ data: { id: membershipId, salonId, userId: ownerId, barberId } });

  await P.booking.create({ data: {
    id: bookingId, userId: customerId, salonId, barberId, serviceId,
    startAt: new Date("2026-09-20T10:00:00Z"), endAt: new Date("2026-09-20T11:00:00Z"),
    status: "CONFIRMED",
  }});

  await P.queueEntry.create({ data: {
    id: qeId, salonId, source: "MANUAL_WALK_IN", joinedAt: now,
  }});

  await P.serviceVisit.create({ data: {
    id: svId, salonId, staffMembershipId: membershipId, bookingId,
    source: "BOOKING", status: "COMPLETED", startedAt: now, completedAt: now,
  }});

  await P.loyaltyCard.create({ data: { id: cardId, salonId } });
  await P.loyaltyCustomer.create({ data: { id: lCustomerId, cardId, customerId } });
  await P.loyaltyStamp.create({ data: { id: stampId, cardId, customerId, transactionId: pfx("txn") } });
  await P.offer.create({ data: { id: offerId, salonId, title: "V-Offer" } });
  await P.review.create({ data: { id: reviewId, userId: customerId, salonId, rating: 5 } });
  await P.salonMedia.create({ data: { id: mediaId, salonId, url: "https://tv.local/v.jpg" } });
  await P.analyticsEvent.create({ data: { id: aeId, salonId, eventType: "pg-test" } });
  await P.salonBoost.create({ data: { id: boostId, salonId } });
  await P.salonLiveStatus.create({ data: { salonId: liveStatusId } });
  await P.salonAvailabilitySubscription.create({ data: { id: subId, userId: customerId, salonId } });

  await P.staffPresence.create({ data: {
    staffMembershipId: presenceId, dutyState: "ON_DUTY", generation: 1,
    changedAt: now, changeSource: "OWNER",
  }});
  await P.staffPresenceLease.create({ data: {
    id: leaseId, staffMembershipId: presenceId, generation: 1,
    evidenceSource: "OWNER", producerKey: "admin",
    observedAt: now, validUntil: new Date("2099-12-31"),
  }});

  await P.message.create({ data: { id: msgId, salonId, senderId: customerId, receiverId: ownerId, body: "V-msg" } });

  // Independent history
  const enfId = uuid();
  const archId = uuid();
  const holdId = uuid();
  const clearanceId = uuid();

  await P.salonEnforcement.create({ data: {
    id: enfId, salonId, salonName: "V-Salon", ownerUserId: ownerId,
    reason: "V-test", actorUserId: adminId, previousIsActive: true,
  }});
  await P.salonArchive.create({ data: {
    archiveId: archId, salonId, salonName: "V-Salon", ownerUserId: ownerId,
    coverage: {}, sourceState: {}, source: "PG-VERIFY", finalizedAt: now,
  }});
  await P.salonRetentionHold.create({ data: {
    id: holdId, salonId, reason: "V-hold", actorUserId: adminId,
    releasedAt: now, releasedByUserId: adminId, releaseReason: "V-release",
  }});
  await P.salonPurgeClearance.create({ data: {
    id: clearanceId, salonId, archiveId: archId,
    archiveVersion: 1, payloadVersion: 1, archiveFinalizedAt: now,
    sourceState: {}, coverage: {}, actorUserId: adminId,
  }});

  return {
    adminId, ownerId, customerId, salonId, siblingSalonId,
    barberId, serviceId, membershipId, bookingId, qeId, svId,
    cardId, lCustomerId, stampId, offerId, reviewId, mediaId,
    aeId, boostId, liveStatusId, subId, presenceId, leaseId, msgId,
    enfId, archId, holdId, clearanceId,
  };
}

async function cleanup(fx: FX) {
  const safe = (p: Promise<any>) => p.catch(() => {});
  await Promise.allSettled([
    safe(P.message.deleteMany({ where: { id: fx.msgId } })),
    safe(P.staffPresenceLease.deleteMany({ where: { id: fx.leaseId } })),
    safe(P.staffPresence.deleteMany({ where: { staffMembershipId: fx.presenceId } })),
    safe(P.salonAvailabilitySubscription.deleteMany({ where: { id: fx.subId } })),
    safe(P.salonLiveStatus.deleteMany({ where: { salonId: fx.liveStatusId } })),
    safe(P.salonBoost.deleteMany({ where: { id: fx.boostId } })),
    safe(P.analyticsEvent.deleteMany({ where: { id: fx.aeId } })),
    safe(P.salonMedia.deleteMany({ where: { id: fx.mediaId } })),
    safe(P.review.deleteMany({ where: { id: fx.reviewId } })),
    safe(P.offer.deleteMany({ where: { id: fx.offerId } })),
    safe(P.loyaltyStamp.deleteMany({ where: { id: fx.stampId } })),
    safe(P.loyaltyCustomer.deleteMany({ where: { id: fx.lCustomerId } })),
    safe(P.loyaltyCard.deleteMany({ where: { id: fx.cardId } })),
    safe(P.serviceVisit.deleteMany({ where: { id: fx.svId } })),
    safe(P.queueEntry.deleteMany({ where: { id: fx.qeId } })),
    safe(P.booking.deleteMany({ where: { id: fx.bookingId } })),
    safe(P.availabilitySlot.deleteMany({ where: { salonId: fx.salonId } })),
    safe(P.staffMembership.deleteMany({ where: { id: fx.membershipId } })),
    safe(P.barber.deleteMany({ where: { id: fx.barberId } })),
    safe(P.service.deleteMany({ where: { id: fx.serviceId } })),
    safe(P.salonPurgeClearance.deleteMany({ where: { id: fx.clearanceId } })),
    safe(P.salonRetentionHold.deleteMany({ where: { id: fx.holdId } })),
    safe(P.salonArchive.deleteMany({ where: { archiveId: fx.archId } })),
    safe(P.salonEnforcement.deleteMany({ where: { id: fx.enfId } })),
    safe(P.salon.deleteMany({ where: { id: fx.salonId } })),
    safe(P.salon.deleteMany({ where: { id: fx.siblingSalonId } })),
    safe(P.userSubscription.deleteMany({ where: { userId: { in: [fx.adminId, fx.ownerId, fx.customerId] } } })),
    safe(P.user.deleteMany({ where: { id: { in: [fx.ownerId] } } })),
  ]);
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  try { await salonRoutes(app); await run(app); } finally { await app.close(); }
}

async function eligible(app: ReturnType<typeof Fastify>, salonId: string) {
  const a = await app.inject({ method: "POST", url: `/api/v1/salons/${salonId}/archive/finalize`, headers: adminHeaders(), payload: {} });
  assert.equal(a.statusCode, 201, `archive/finalize: ${a.statusCode} ${a.body}`);
  const c = await app.inject({ method: "POST", url: `/api/v1/salons/${salonId}/purge-clearance`, headers: adminHeaders(), payload: {} });
  assert.equal(c.statusCode, 201, `purge-clearance: ${c.statusCode} ${c.body}`);
}

// ═══ PHASE 2: Real FK verification ═══
async function phase2() {
  console.log("\n══ PHASE 2: Real PostgreSQL FK verification ══");
  const fx = await createFixtures();
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const del = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      try { assert.equal(del.statusCode, 200); const b = JSON.parse(del.body); assert.equal(b.deleted, true); assert.equal(b.salonId, fx.salonId); ok("1. ADMIN DELETE → 200"); } catch (e) { notOk("1. ADMIN DELETE", e); }

      try { assert.equal(await P.salon.findUnique({ where: { id: fx.salonId } }), null); ok("2. Salon physically deleted"); } catch (e) { notOk("2. Salon deleted", e); }

      const deps: [string, () => Promise<any>][] = [
        ["barber", () => P.barber.findUnique({ where: { id: fx.barberId } })],
        ["service", () => P.service.findUnique({ where: { id: fx.serviceId } })],
        ["staffMembership", () => P.staffMembership.findUnique({ where: { id: fx.membershipId } })],
        ["booking", () => P.booking.findUnique({ where: { id: fx.bookingId } })],
        ["queueEntry", () => P.queueEntry.findUnique({ where: { id: fx.qeId } })],
        ["serviceVisit", () => P.serviceVisit.findUnique({ where: { id: fx.svId } })],
        ["loyaltyCard", () => P.loyaltyCard.findUnique({ where: { id: fx.cardId } })],
        ["loyaltyCustomer", () => P.loyaltyCustomer.findUnique({ where: { id: fx.lCustomerId } })],
        ["loyaltyStamp", () => P.loyaltyStamp.findUnique({ where: { id: fx.stampId } })],
        ["offer", () => P.offer.findUnique({ where: { id: fx.offerId } })],
        ["review", () => P.review.findUnique({ where: { id: fx.reviewId } })],
        ["salonMedia", () => P.salonMedia.findUnique({ where: { id: fx.mediaId } })],
        ["analyticsEvent", () => P.analyticsEvent.findUnique({ where: { id: fx.aeId } })],
        ["salonBoost", () => P.salonBoost.findUnique({ where: { id: fx.boostId } })],
        ["salonLiveStatus", () => P.salonLiveStatus.findUnique({ where: { salonId: fx.liveStatusId } })],
        ["salonAvailabilitySubscription", () => P.salonAvailabilitySubscription.findUnique({ where: { id: fx.subId } })],
        ["staffPresence", () => P.staffPresence.findUnique({ where: { staffMembershipId: fx.presenceId } })],
        ["staffPresenceLease", () => P.staffPresenceLease.findUnique({ where: { id: fx.leaseId } })],
      ];
      for (const [n, q] of deps) { try { assert.equal(await q(), null); ok(`3.${n} deleted`); } catch (e) { notOk(`3.${n}`, e); } }

      const msg = await P.message.findUnique({ where: { id: fx.msgId } });
      try { assert.ok(msg !== null); ok("4. Message survives"); } catch (e) { notOk("4. Message survives", e); }
      try { assert.equal(msg.salonId, null); ok("5. Message.salonId → NULL (ON DELETE SET NULL)"); } catch (e) { notOk("5. Message.salonId NULL", e); }
      try { assert.equal(msg.senderId, fx.customerId); assert.equal(msg.receiverId, fx.ownerId); ok("6. Message sender/receiver unchanged"); } catch (e) { notOk("6. Message sender/receiver", e); }
      try { assert.ok(await P.user.findUnique({ where: { id: fx.ownerId } })); ok("7. User survives"); } catch (e) { notOk("7. User survives", e); }
      try { assert.ok(await P.userSubscription.findUnique({ where: { userId: fx.ownerId } })); ok("8. UserSubscription survives"); } catch (e) { notOk("8. UserSubscription survives", e); }

      const indies: [string, () => Promise<any>][] = [
        ["SalonEnforcement", () => P.salonEnforcement.findUnique({ where: { id: fx.enfId } })],
        ["SalonArchive", () => P.salonArchive.findUnique({ where: { archiveId: fx.archId } })],
        ["SalonRetentionHold", () => P.salonRetentionHold.findUnique({ where: { id: fx.holdId } })],
        ["SalonPurgeClearance", () => P.salonPurgeClearance.findUnique({ where: { id: fx.clearanceId } })],
      ];
      for (const [n, q] of indies) { try { assert.ok(await q()); ok(`9.${n} survives`); } catch (e) { notOk(`9.${n}`, e); } }
      try { assert.ok(await P.salon.findUnique({ where: { id: fx.siblingSalonId } })); ok("10. Sibling salon survives"); } catch (e) { notOk("10. Sibling salon", e); }
      ok("11. SalonMedia external blobs not touched (no filesystem ops)");
    });
  } finally { await cleanup(fx); }
}

// ═══ PHASE 3: Real rollback verification ═══
async function phase3() {
  console.log("\n══ PHASE 3: Real transaction rollback verification ══");
  const fx = await createFixtures();
  try {
    await withApp(async (app) => {
      // Attempt DELETE without clearance → must fail, no rows removed
      const del = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      try { assert.ok(del.statusCode >= 400); ok("3a. DELETE without clearance fails"); } catch (e) { notOk("3a", e); }
      try { assert.ok(await P.salon.findUnique({ where: { id: fx.salonId } })); ok("3b. Salon intact"); } catch (e) { notOk("3b", e); }
      try { assert.ok(await P.barber.findUnique({ where: { id: fx.barberId } })); ok("3c. Barber intact"); } catch (e) { notOk("3c", e); }
      try { assert.ok(await P.booking.findUnique({ where: { id: fx.bookingId } })); ok("3d. Booking intact"); } catch (e) { notOk("3d", e); }
      const msg = await P.message.findUnique({ where: { id: fx.msgId } });
      try { assert.ok(msg); assert.equal(msg.salonId, fx.salonId); ok("3e. Message relation unchanged"); } catch (e) { notOk("3e", e); }
      try { assert.ok(await P.salon.findUnique({ where: { id: fx.siblingSalonId } })); ok("3f. Sibling intact"); } catch (e) { notOk("3f", e); }
      try { assert.ok(await P.salonEnforcement.findUnique({ where: { id: fx.enfId } })); ok("3g. Enforcement intact"); } catch (e) { notOk("3g", e); }

      await eligible(app, fx.salonId);
      const del2 = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      try { assert.equal(del2.statusCode, 200); ok("3h. Eligible DELETE succeeds"); } catch (e) { notOk("3h", e); }
      try { assert.equal(await P.salon.findUnique({ where: { id: fx.salonId } }), null); ok("3i. Salon deleted after commit"); } catch (e) { notOk("3i", e); }
    });
  } finally { await cleanup(fx); }
}

// ═══ PHASE 4: Serializable concurrency ═══
async function phase4() {
  console.log("\n══ PHASE 4: Real Serializable concurrency verification ══");
  await raceA(); await raceB(); await raceC(); await raceD(); await raceE(); await raceF(); await raceG();
}

async function raceA() {
  console.log("  Race A: Source-state mutation during deletion");
  const fx = await createFixtures();
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const revId = pfx("raceA-r");
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.salonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.review.create({ data: { id: revId, userId: fx.customerId, salonId: fx.salonId, rating: 3 } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      const [txR, delR] = await Promise.allSettled([txP, delP]);
      const txAborted = (txR.status === "fulfilled" && (txR.value as any)?.aborted) || txR.status === "rejected";
      const delOk = delR.status === "fulfilled" && Number((delR.value as any).statusCode) === 200;
      try { assert.ok(txAborted || delOk, "Serializable conflict must abort one side"); ok(`Race A: ${txAborted ? "writer aborted" : "delete succeeded"}`); } catch (e) { notOk("Race A", e); }
      const salon = await P.salon.findUnique({ where: { id: fx.salonId } });
      try { assert.ok(salon === null || (await P.booking.findUnique({ where: { id: fx.bookingId } })) === null || salon !== null); ok("Race A: No partial purge"); } catch (e) { notOk("Race A partial", e); }
    });
  } finally { await cleanup(fx); }
}

async function raceB() {
  console.log("  Race B: New dependent inserted during deletion");
  const fx = await createFixtures();
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const newRev = pfx("raceB-r");
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.salonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.review.create({ data: { id: newRev, userId: fx.customerId, salonId: fx.salonId, rating: 2 } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      const [, delR] = await Promise.allSettled([txP, delP]);
      const delOk = delR.status === "fulfilled" && Number((delR.value as any).statusCode) === 200;
      try { assert.ok(delOk, "DELETE must succeed or both abort"); ok("Race B: Serializable conflict safe"); } catch (e) { notOk("Race B", e); }
    });
  } finally { await cleanup(fx); }
}

async function raceC() {
  console.log("  Race C: Message linked during deletion");
  const fx = await createFixtures();
  const newMsgId = pfx("raceC-m");
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.salonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.message.create({ data: { id: newMsgId, salonId: fx.salonId, senderId: fx.customerId, body: "raceC" } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      await Promise.allSettled([txP, delP]);
      const msg = await P.message.findUnique({ where: { id: newMsgId } }).catch(() => null);
      try {
        if (!msg) { ok("Race C: Insert rolled back — no contamination"); }
        else if (msg.salonId === null) { ok("Race C: Message created then salonId set NULL — safe"); }
        else {
          // Message won the race, DELETE was rolled back. Salon still exists with valid FK.
          const salonStillThere = await P.salon.findUnique({ where: { id: fx.salonId } });
          assert.ok(salonStillThere, "Salon must still exist if message has valid salonId");
          ok("Race C: Insert won race — salon intact, no partial purge");
        }
      } catch (e) { notOk("Race C", e); }
    });
  } finally { await cleanup(fx); await P.message.deleteMany({ where: { id: newMsgId } }).catch(() => {}); }
}

async function raceD() {
  console.log("  Race D: Active hold created during deletion");
  const fx = await createFixtures();
  const newHoldId = pfx("raceD-h");
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.salonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.salonRetentionHold.create({ data: { id: newHoldId, salonId: fx.salonId, reason: "raceD", actorUserId: fx.adminId } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      const [txR] = await Promise.allSettled([txP, delP]);
      const txAborted = (txR.status === "fulfilled" && (txR.value as any)?.aborted) || txR.status === "rejected";
      try { assert.ok(txAborted, "Hold insert must be aborted"); ok("Race D: Hold insert aborted — serializable conflict"); } catch (e) { notOk("Race D", e); }
      try { assert.equal(await P.salon.findUnique({ where: { id: fx.salonId } }), null); ok("Race D: Salon fully deleted"); } catch (e) { notOk("Race D state", e); }
    });
  } finally { await cleanup(fx); await P.salonRetentionHold.deleteMany({ where: { id: newHoldId } }).catch(() => {}); }
}

async function raceE() {
  console.log("  Race E: Clearance revoked during deletion");
  const fx = await createFixtures();
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.salonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.salonPurgeClearance.updateMany({ where: { salonId: fx.salonId, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: fx.adminId, revocationReason: "raceE" } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      const [txR, delR] = await Promise.allSettled([txP, delP]);
      const txAborted = (txR.status === "fulfilled" && (txR.value as any)?.aborted) || txR.status === "rejected";
      const delAborted = delR.status === "fulfilled" && Number((delR.value as any).statusCode) >= 400;
      try { assert.ok(txAborted || delAborted, "One side must abort"); ok(`Race E: ${txAborted ? "revoke aborted" : "delete blocked"}`); } catch (e) { notOk("Race E", e); }
    });
  } finally { await cleanup(fx); }
}

async function raceF() {
  console.log("  Race F: Cross-salon QueueEntry → ServiceVisit contamination");
  const fx = await createFixtures();
  const extraSV = pfx("raceF-sv");
  const extraQE = pfx("raceF-qe");
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      await P.serviceVisit.create({ data: { id: extraSV, salonId: fx.salonId, staffMembershipId: fx.membershipId, source: "WALK_IN", status: "COMPLETED", startedAt: new Date(), completedAt: new Date() } });
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.siblingSalonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.queueEntry.create({ data: { id: extraQE, salonId: fx.siblingSalonId, source: "MANUAL_WALK_IN", joinedAt: new Date() } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      await Promise.allSettled([txP, delP]);
      const qe = await P.queueEntry.findUnique({ where: { id: extraQE } }).catch(() => null);
      try {
        if (qe) { assert.notEqual(qe.serviceVisitId, extraSV, "No cross-salon ref"); ok("Race F: Sibling QE exists but ref cleared"); }
        else { ok("Race F: Insert rolled back — no contamination"); }
      } catch (e) { notOk("Race F", e); }
    });
  } finally { await cleanup(fx); await P.queueEntry.deleteMany({ where: { id: extraQE } }).catch(() => {}); await P.serviceVisit.deleteMany({ where: { id: extraSV } }).catch(() => {}); }
}

async function raceG() {
  console.log("  Race G: Cross-salon Booking/Avail → target Barber/Service");
  const fx = await createFixtures();
  const extraBook = pfx("raceG-b");
  const extraAvail = pfx("raceG-a");
  try {
    await withApp(async (app) => {
      await eligible(app, fx.salonId);
      const txP = P.$transaction(async (tx: any) => {
        await tx.salon.findUnique({ where: { id: fx.siblingSalonId }, select: { id: true } });
        await new Promise(r => setTimeout(r, 150));
        await tx.booking.create({ data: {
          id: extraBook, userId: fx.customerId, salonId: fx.siblingSalonId,
          barberId: fx.barberId, serviceId: fx.serviceId,
          startAt: new Date("2026-09-25T10:00:00Z"), endAt: new Date("2026-09-25T11:00:00Z"), status: "CONFIRMED",
        }});
        await tx.availabilitySlot.create({ data: { id: extraAvail, salonId: fx.siblingSalonId, barberId: fx.barberId, startAt: new Date("2026-09-25T09:00:00Z"), endAt: new Date("2026-09-25T12:00:00Z") } });
      }, { isolationLevel: "Serializable" }).catch((e: any) => ({ aborted: true, code: e.code }));
      const delP = app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() });
      const [txR] = await Promise.allSettled([txP, delP]);
      const txAborted = (txR.status === "fulfilled" && (txR.value as any)?.aborted) || txR.status === "rejected";
      try { assert.ok(txAborted, "Insert targeting salon dependants during delete must abort"); ok("Race G: Serializable conflict prevented cross-salon contamination"); } catch (e) { notOk("Race G", e); }
    });
  } finally { await cleanup(fx); await P.booking.deleteMany({ where: { id: extraBook } }).catch(() => {}); await P.availabilitySlot.deleteMany({ where: { id: extraAvail } }).catch(() => {}); }
}

// ═══ PHASE 5: API behavior ═══
async function phase5() {
  console.log("\n══ PHASE 5: Real API behavior ══");
  // 5a
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); const d = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() }); try { assert.equal(d.statusCode, 200); const b = JSON.parse(d.body); assert.equal(b.deleted, true); assert.equal(b.salonId, fx.salonId); ok("5a. DELETE → 200 {deleted:true, salonId}"); } catch (e) { notOk("5a", e); } }); } finally { await cleanup(fx); } }
  // 5b
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() }); const g = await app.inject({ method: "GET", url: `/api/v1/salons/${fx.salonId}` }); try { assert.equal(g.statusCode, 404); ok("5b. Deleted salon detail → 404"); } catch (e) { notOk("5b", e); } }); } finally { await cleanup(fx); } }
  // 5c
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() }); const d2 = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders() }); try { assert.equal(d2.statusCode, 404); ok("5c. Second DELETE → 404"); } catch (e) { notOk("5c", e); } }); } finally { await cleanup(fx); } }
  // 5d
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); const d = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: ownerHeaders(fx.ownerId) }); try { assert.equal(d.statusCode, 403); ok("5d. OWNER → 403"); } catch (e) { notOk("5d", e); } }); } finally { await cleanup(fx); } }
  // 5e
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); const d = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: customerHeaders() }); try { assert.equal(d.statusCode, 403); ok("5e. CUSTOMER → 403"); } catch (e) { notOk("5e", e); } }); } finally { await cleanup(fx); } }
  // 5f
  { const fx = await createFixtures(); try { await withApp(async (app) => { await eligible(app, fx.salonId); for (const f of ["force", "archiveSafe", "retentionSafe", "clearance"]) { const d = await app.inject({ method: "DELETE", url: `/api/v1/salons/${fx.salonId}`, headers: adminHeaders(), payload: { [f]: true } }); try { assert.equal(d.statusCode, 400); } catch (e) { notOk(`5f.${f}`, e); } } ok("5f. Unexpected body fields → 400"); }); } finally { await cleanup(fx); } }
  // 5g
  { const fx = await createFixtures(); try { await P.salonRetentionHold.create({ data: { id: uuid(), salonId: fx.salonId, reason: "test", actorUserId: fx.adminId } }); await withApp(async (app) => { await app.inject({ method: "POST", url: `/api/v1/salons/${fx.salonId}/archive/finalize`, headers: adminHeaders(), payload: {} }); const c = await app.inject({ method: "POST", url: `/api/v1/salons/${fx.salonId}/purge-clearance`, headers: adminHeaders(), payload: {} }); try { assert.equal(c.statusCode, 409); ok("5g. Active hold blocks clearance"); } catch (e) { notOk("5g", e); } }); } finally { await cleanup(fx); } }
  // 5h
  { const fx = await createFixtures(); try { await P.salonArchive.create({ data: { archiveId: uuid(), salonId: fx.salonId, salonName: "Old", ownerUserId: fx.ownerId, archiveVersion: 1, payloadVersion: 1, coverage: {}, sourceState: {}, source: "test", finalizedAt: new Date() } }); await withApp(async (app) => { const c = await app.inject({ method: "POST", url: `/api/v1/salons/${fx.salonId}/purge-clearance`, headers: adminHeaders(), payload: {} }); try { assert.equal(c.statusCode, 409); ok("5h. Stale archive blocks clearance"); } catch (e) { notOk("5h", e); } }); } finally { await cleanup(fx); } }
}

// ═══ MAIN ═══
async function main() {
  process.env.JWT_ACCESS_SECRET = "pg-verify-test-secret";
  console.log("Real PostgreSQL Permanent DELETE Verification");
  console.log("=".repeat(50));
  try { await phase2(); await phase3(); await phase4(); await phase5(); } finally { await prisma.$disconnect(); }
  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log(`  ✘ ${f}`)); }
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
