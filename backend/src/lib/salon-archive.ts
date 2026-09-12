import { Prisma } from "@prisma/client";

export const SALON_ARCHIVE_VERSION = 1;
export const SALON_ARCHIVE_PAYLOAD_VERSION = 1;

export type SalonArchiveSourceState = {
  salonId: string;
  bookingIds: string[];
  serviceVisitIds: string[];
  salonBoostIds: string[];
  bookingContent?: string[];
  serviceVisitContent?: string[];
  salonBoostContent?: string[];
  barberContent?: string[];
  reviewContent?: string[];
  salonMediaContent?: string[];
  serviceContent?: string[];
  availabilityContent?: string[];
  staffMembershipContent?: string[];
  staffPresenceContent?: string[];
  queueEntryContent?: string[];
  loyaltyContent?: string[];
  offerContent?: string[];
  analyticsEventContent?: string[];
  liveStatusContent?: string[];
  availabilitySubscriptionContent?: string[];
};

export type SalonArchiveCoverage = {
  categories: string[];
  emptyHistory: boolean;
  counts: {
    bookings: number;
    serviceVisits: number;
    salonBoosts: number;
    barbers?: number;
    reviews?: number;
    salonMedia?: number;
    services?: number;
    availability?: number;
    staffMemberships?: number;
    staffPresence?: number;
    queueEntries?: number;
    loyalty?: number;
    offers?: number;
    analyticsEvents?: number;
    liveStatus?: number;
    availabilitySubscriptions?: number;
  };
};

type BuildSalonArchiveInput = {
  queueEntries?: Array<{ id: string; salonId: string; customerId: string | null; serviceVisitId: string | null; source: string; status: string; joinedAt: Date | string; calledAt: Date | string | null; startedAt: Date | string | null; cancelledAt: Date | string | null; expiredAt: Date | string | null; noShowAt: Date | string | null; version: number }>;
  loyalty?: Array<{ id: string; salonId: string; isActive: boolean; requiredStamps: number; rewardType: string; rewardTitle: string; rewardText: string; description: string | null; createdAt: Date | string; customers: LoyaltyCustomerSource[]; stamps: LoyaltyStampSource[] }>;
  offers?: Array<{ id: string; salonId: string | null; title: string; description: string | null; price: string | Prisma.Decimal | null; isActive: boolean; availableSlots: number | null; discount: string | Prisma.Decimal | null; endAt: Date | string | null; endTime: string | null; serviceName: string | null; startAt: Date | string | null; startTime: string | null }>;
  analyticsEvents?: Array<{ id: string; salonId: string; userId: string | null; eventType: string; source: string; metadata: Prisma.JsonValue; createdAt: Date | string }>;
  liveStatus?: Array<{ salonId: string; operationalState: string | null; observedAt: Date | string | null; expiresAt: Date | string | null; source: string | null }>;
  availabilitySubscriptions?: Array<{ id: string; salonId: string; userId: string; status: string; lastKnownAvailableChairs: number; lastNotifiedAt: Date | string | null; createdAt: Date | string }>;
  services?: Array<{ id: string; salonId: string; name: string; description: string | null; durationMin: number; price: string | Prisma.Decimal; isActive: boolean }>;
  availability?: Array<{ id: string; salonId: string; barberId: string | null; startAt: Date | string; endAt: Date | string; status: string }>;
  staffMemberships?: Array<{ id: string; salonId: string; userId: string; barberId: string; status: string; revokedAt: Date | string | null }>;
  staffPresence?: Array<{ staffMembershipId: string; dutyState: string; generation: number; changedAt: Date | string; changedByUserId: string | null; changeSource: string }>;
  salonId: string;
  bookingIds: string[];
  serviceVisitIds: string[];
  salonBoostIds: string[];
  bookings?: Array<{ id: string; salonId: string; status: string }>;
  serviceVisits?: Array<{ id: string; salonId: string; status: string }>;
  salonBoosts?: Array<{ id: string; salonId: string; status: string }>;
  barbers?: Array<{ id: string; salonId: string; name: string; specialty: string | null; isActive: boolean }>;
  reviews?: Array<{ id: string; salonId: string; userId: string; rating: number; comment: string | null; createdAt: Date | string }>;
  salonMedia?: Array<{ id: string; salonId: string; kind: string; url: string; createdAt: Date | string }>;
};

type LoyaltyCustomerSource = {
  id: string; cardId: string; customerId: string; currentStamps: number; totalVisits: number;
  lastStampedAt: Date | string | null; rewardRedeemedAt: Date | string | null;
};
type LoyaltyStampSource = {
  id: string; cardId: string; customerId: string; barberId: string | null;
  transactionId: string; stampAt: Date | string; isValid: boolean;
};
function archiveDate(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}
function canonicalMetadata(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalMetadata(value[key]!)]));
  }
  return value;
}
function loyaltyChildren(card: NonNullable<BuildSalonArchiveInput["loyalty"]>[number]) {
  for (const child of [...card.customers, ...card.stamps]) {
    if (child.cardId !== card.id) throw new Error("Loyalty child belongs to another card");
  }
  return [
    sortedUnique(card.customers.map(row => JSON.stringify([
      row.id, row.cardId, row.customerId, row.currentStamps, row.totalVisits,
      archiveDate(row.lastStampedAt), archiveDate(row.rewardRedeemedAt),
    ]))),
    sortedUnique(card.stamps.map(row => JSON.stringify([
      row.id, row.cardId, row.customerId, row.barberId, row.transactionId,
      archiveDate(row.stampAt), row.isValid,
    ]))),
  ];
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

export function buildSalonArchiveState(input: BuildSalonArchiveInput) {
  const bookingIds = sortedUnique(input.bookingIds);
  const serviceVisitIds = sortedUnique(input.serviceVisitIds);
  const salonBoostIds = sortedUnique(input.salonBoostIds);

  const coverage: SalonArchiveCoverage = {
    categories: ["BOOKING", "SERVICE_VISIT", "SALON_BOOST"],
    emptyHistory:
      bookingIds.length === 0 &&
      serviceVisitIds.length === 0 &&
      salonBoostIds.length === 0,
    counts: {
      bookings: bookingIds.length,
      serviceVisits: serviceVisitIds.length,
      salonBoosts: salonBoostIds.length,
    },
  };

  const sourceState: SalonArchiveSourceState = {
    salonId: input.salonId,
    bookingIds,
    serviceVisitIds,
    salonBoostIds,
    ...(input.bookings === undefined ? {} : {
      // Fixed field order ignores object-key order; sorting/deduplication ignores row noise.
      // Conflicting content for the same ID is retained rather than chosen by input order.
      bookingContent: sortedUnique(input.bookings.map((booking) =>
        JSON.stringify([booking.id, booking.salonId, booking.status]),
      )),
    }),
    ...(input.serviceVisits === undefined ? {} : {
  serviceVisitContent: sortedUnique(input.serviceVisits.map((visit) =>
    JSON.stringify([visit.id, visit.salonId, visit.status]),
  )),
}),
...(input.salonBoosts === undefined ? {} : {
  salonBoostContent: sortedUnique(input.salonBoosts.map((boost) =>
    JSON.stringify([boost.id, boost.salonId, boost.status]),
  )),
}),
};

// Only supplied categories are evaluated; omitted data must not imply empty coverage.
if (input.barbers !== undefined) {
  sourceState.barberContent = sortedUnique(input.barbers.map(row =>
    JSON.stringify([row.id, row.salonId, row.name, row.specialty, row.isActive]),
  ));
  coverage.categories.push("BARBER");
  coverage.counts.barbers = sortedUnique(input.barbers.map(row => row.id)).length;
}
if (input.reviews !== undefined) {
  sourceState.reviewContent = sortedUnique(input.reviews.map(row =>
    JSON.stringify([row.id, row.salonId, row.userId, row.rating, row.comment, new Date(row.createdAt).toISOString()]),
  ));
  coverage.categories.push("REVIEW");
  coverage.counts.reviews = sortedUnique(input.reviews.map(row => row.id)).length;
}
if (input.salonMedia !== undefined) {
  sourceState.salonMediaContent = sortedUnique(input.salonMedia.map(row =>
    JSON.stringify([row.id, row.salonId, row.kind, row.url, new Date(row.createdAt).toISOString()]),
  ));
  coverage.categories.push("SALON_MEDIA");
  coverage.counts.salonMedia = sortedUnique(input.salonMedia.map(row => row.id)).length;
}
if (input.services !== undefined) {
  sourceState.serviceContent = sortedUnique(input.services.map(row =>
    JSON.stringify([row.id, row.salonId, row.name, row.description, row.durationMin, new Prisma.Decimal(row.price).toString(), row.isActive]),
  ));
  coverage.categories.push("SERVICE");
  coverage.counts.services = sortedUnique(input.services.map(row => row.id)).length;
}
if (input.availability !== undefined) {
  sourceState.availabilityContent = sortedUnique(input.availability.map(row =>
    JSON.stringify([row.id, row.salonId, row.barberId, new Date(row.startAt).toISOString(), new Date(row.endAt).toISOString(), row.status]),
  ));
  coverage.categories.push("AVAILABILITY");
  coverage.counts.availability = sortedUnique(input.availability.map(row => row.id)).length;
}
if (input.staffMemberships !== undefined) {
  sourceState.staffMembershipContent = sortedUnique(input.staffMemberships.map(row =>
    JSON.stringify([row.id, row.salonId, row.userId, row.barberId, row.status, row.revokedAt === null ? null : new Date(row.revokedAt).toISOString()]),
  ));
  coverage.categories.push("STAFF_MEMBERSHIP");
  coverage.counts.staffMemberships = sortedUnique(input.staffMemberships.map(row => row.id)).length;
}
if (input.staffPresence !== undefined) {
  sourceState.staffPresenceContent = sortedUnique(input.staffPresence.map(row =>
    JSON.stringify([row.staffMembershipId, row.dutyState, row.generation, new Date(row.changedAt).toISOString(), row.changedByUserId, row.changeSource]),
  ));
  coverage.categories.push("STAFF_PRESENCE");
  coverage.counts.staffPresence = sortedUnique(input.staffPresence.map(row => row.staffMembershipId)).length;
}
if (input.queueEntries !== undefined) {
  sourceState.queueEntryContent = sortedUnique(input.queueEntries.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.id, row.salonId, row.customerId, row.serviceVisitId, row.source, row.status, archiveDate(row.joinedAt), archiveDate(row.calledAt), archiveDate(row.startedAt), archiveDate(row.cancelledAt), archiveDate(row.expiredAt), archiveDate(row.noShowAt), row.version]);
  }));
  coverage.categories.push("QUEUE_ENTRY");
  coverage.counts.queueEntries = sortedUnique(input.queueEntries.map(row => row.id)).length;
}
if (input.loyalty !== undefined) {
  sourceState.loyaltyContent = sortedUnique(input.loyalty.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.id, row.salonId, row.isActive, row.requiredStamps, row.rewardType, row.rewardTitle, row.rewardText, row.description, archiveDate(row.createdAt), ...loyaltyChildren(row)]);
  }));
  coverage.categories.push("LOYALTY");
  coverage.counts.loyalty = sortedUnique(input.loyalty.map(row => row.id)).length;
}
if (input.offers !== undefined) {
  sourceState.offerContent = sortedUnique(input.offers.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.id, row.salonId, row.title, row.description, row.price === null ? null : new Prisma.Decimal(row.price).toString(), row.isActive, row.availableSlots, row.discount === null ? null : new Prisma.Decimal(row.discount).toString(), archiveDate(row.endAt), row.endTime, row.serviceName, archiveDate(row.startAt), row.startTime]);
  }));
  coverage.categories.push("OFFER");
  coverage.counts.offers = sortedUnique(input.offers.map(row => row.id)).length;
}
if (input.analyticsEvents !== undefined) {
  sourceState.analyticsEventContent = sortedUnique(input.analyticsEvents.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.id, row.salonId, row.userId, row.eventType, row.source, canonicalMetadata(row.metadata), archiveDate(row.createdAt)]);
  }));
  coverage.categories.push("ANALYTICS_EVENT");
  coverage.counts.analyticsEvents = sortedUnique(input.analyticsEvents.map(row => row.id)).length;
}
if (input.liveStatus !== undefined) {
  sourceState.liveStatusContent = sortedUnique(input.liveStatus.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.salonId, row.operationalState, archiveDate(row.observedAt), archiveDate(row.expiresAt), row.source]);
  }));
  coverage.categories.push("LIVE_STATUS");
  coverage.counts.liveStatus = sortedUnique(input.liveStatus.map(row => row.salonId)).length;
}
if (input.availabilitySubscriptions !== undefined) {
  sourceState.availabilitySubscriptionContent = sortedUnique(input.availabilitySubscriptions.map(row => {
    if (row.salonId !== input.salonId) throw new Error("Archive record belongs to another salon");
    return JSON.stringify([row.id, row.salonId, row.userId, row.status, row.lastKnownAvailableChairs, archiveDate(row.lastNotifiedAt), archiveDate(row.createdAt)]);
  }));
  coverage.categories.push("AVAILABILITY_SUBSCRIPTION");
  coverage.counts.availabilitySubscriptions = sortedUnique(input.availabilitySubscriptions.map(row => row.id)).length;
}
coverage.emptyHistory = Object.values(coverage.counts).every(count => count === 0);

return {
  archiveVersion: SALON_ARCHIVE_VERSION,
  payloadVersion: SALON_ARCHIVE_PAYLOAD_VERSION,
  coverage,
  sourceState,
};
}
