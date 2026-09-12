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
  };
};

type BuildSalonArchiveInput = {
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
coverage.emptyHistory = Object.values(coverage.counts).every(count => count === 0);

return {
  archiveVersion: SALON_ARCHIVE_VERSION,
  payloadVersion: SALON_ARCHIVE_PAYLOAD_VERSION,
  coverage,
  sourceState,
};
}
