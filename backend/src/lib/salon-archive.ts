export const SALON_ARCHIVE_VERSION = 1;
export const SALON_ARCHIVE_PAYLOAD_VERSION = 1;

export type SalonArchiveSourceState = {
  salonId: string;
  bookingIds: string[];
  serviceVisitIds: string[];
  salonBoostIds: string[];
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
  };

  return {
    archiveVersion: SALON_ARCHIVE_VERSION,
    payloadVersion: SALON_ARCHIVE_PAYLOAD_VERSION,
    coverage,
    sourceState,
  };
}