import type { Prisma } from "@prisma/client";
import { buildSalonArchiveState } from "./salon-archive.js";

// Shared by finalization and current-source revalidation within their transactions.
export async function loadSalonArchiveState(tx: Prisma.TransactionClient, salonId: string) {
  const [bookings, serviceVisits, salonBoosts, barbers, reviews, salonMedia, services, availability, staffMemberships, queueEntries, cards, offers, analyticsEvents, liveStatus, availabilitySubscriptions] = await Promise.all([
    tx.booking.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, userId: true, barberId: true, serviceId: true, startAt: true, endAt: true, status: true, notes: true, customerName: true, customerPhone: true, createdAt: true, updatedAt: true, cancelledAt: true, cancellationReason: true } }),
    tx.serviceVisit.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, bookingId: true, staffMembershipId: true, source: true, status: true, startedAt: true, completedAt: true, cancelledAt: true, version: true, startedByUserId: true, completedByUserId: true, cancelledByUserId: true, createdAt: true, updatedAt: true } }),
    tx.salonBoost.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, status: true } }),
    tx.barber.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, name: true, specialty: true, isActive: true, createdAt: true, updatedAt: true } }),
    tx.review.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, userId: true, rating: true, comment: true, createdAt: true } }),
    tx.salonMedia.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, kind: true, url: true, createdAt: true } }),
    tx.service.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, name: true, description: true, durationMin: true, price: true, isActive: true, createdAt: true, updatedAt: true } }),
    tx.availabilitySlot.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, barberId: true, startAt: true, endAt: true, status: true, createdAt: true } }),
    tx.staffMembership.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, userId: true, barberId: true, status: true, revokedAt: true, createdAt: true, updatedAt: true } }),
    tx.queueEntry.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, customerId: true, serviceVisitId: true, source: true, status: true, joinedAt: true, calledAt: true, startedAt: true, cancelledAt: true, expiredAt: true, noShowAt: true, version: true, createdAt: true, updatedAt: true } }),
    tx.loyaltyCard.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, isActive: true, requiredStamps: true, rewardType: true, rewardTitle: true, rewardText: true, description: true, createdAt: true, updatedAt: true } }),
    tx.offer.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, title: true, description: true, price: true, isActive: true, availableSlots: true, discount: true, endAt: true, endTime: true, serviceName: true, startAt: true, startTime: true } }),
    tx.analyticsEvent.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, userId: true, eventType: true, source: true, metadata: true, createdAt: true } }),
    tx.salonLiveStatus.findMany({ where: { salonId: salonId }, select: { salonId: true, operationalState: true, observedAt: true, expiresAt: true, source: true } }),
    tx.salonAvailabilitySubscription.findMany({ where: { salonId: salonId }, select: { id: true, salonId: true, userId: true, status: true, lastKnownAvailableChairs: true, lastNotifiedAt: true, createdAt: true } }),
  ]);
  const staffPresence = (await Promise.all(staffMemberships.map(membership =>
    tx.staffPresence.findMany({
      where: { staffMembershipId: membership.id },
      select: { staffMembershipId: true, dutyState: true, generation: true, changedAt: true, changedByUserId: true, changeSource: true, createdAt: true, updatedAt: true },
    }),
  ))).flat();
  const staffPresenceWithLeases = await Promise.all(staffPresence.map(async presence => {
    const leases = await tx.staffPresenceLease.findMany({
      where: { staffMembershipId: presence.staffMembershipId },
      select: { id: true, staffMembershipId: true, generation: true, evidenceSource: true, producerKey: true, observedAt: true, validUntil: true, revokedAt: true, createdAt: true, updatedAt: true },
    });
    return { ...presence, leases };
  }));
  const loyalty = await Promise.all(cards.map(async card => {
    const [customers, stamps] = await Promise.all([
      tx.loyaltyCustomer.findMany({ where: { cardId: card.id }, select: { id: true, cardId: true, customerId: true, currentStamps: true, totalVisits: true, lastStampedAt: true, rewardRedeemedAt: true, createdAt: true, updatedAt: true } }),
      tx.loyaltyStamp.findMany({ where: { cardId: card.id }, select: { id: true, cardId: true, customerId: true, barberId: true, transactionId: true, stampAt: true, isValid: true, verificationToken: true, createdAt: true } }),
    ]);
    return { ...card, customers, stamps };
  }));

  return buildSalonArchiveState({
    salonId: salonId,
    bookingIds: bookings.map((row) => row.id),
    serviceVisitIds: serviceVisits.map((row) => row.id),
    salonBoostIds: salonBoosts.map((row) => row.id),
    bookings, serviceVisits, salonBoosts, barbers, reviews, salonMedia,
    services, availability, staffMemberships, staffPresence: staffPresenceWithLeases, queueEntries,
    loyalty, offers, analyticsEvents, liveStatus, availabilitySubscriptions,
  });
}
