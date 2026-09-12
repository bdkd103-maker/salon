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
};

export type SalonArchiveCoverage = {
  categories: string[];
  emptyHistory: boolean;
  counts: {
    bookings: number;
    serviceVisits: number;
    salonBoosts: number;
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

return {
  archiveVersion: SALON_ARCHIVE_VERSION,
  payloadVersion: SALON_ARCHIVE_PAYLOAD_VERSION,
  coverage,
  sourceState,
};
}
