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
  };
};

type BuildSalonArchiveInput = {
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
coverage.emptyHistory = Object.values(coverage.counts).every(count => count === 0);

return {
  archiveVersion: SALON_ARCHIVE_VERSION,
  payloadVersion: SALON_ARCHIVE_PAYLOAD_VERSION,
  coverage,
  sourceState,
};
}
