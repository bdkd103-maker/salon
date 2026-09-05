export const MAX_ADMIN_VIP_SLOTS = 5;
export const MAX_AUTO_VIP_SLOTS = 5;

export type PersistedSalonClassification = "REGULAR" | "PREMIUM";
export type PublicSalonClassification = PersistedSalonClassification | "VIP";
export type VipSource = "NONE" | "ADMIN" | "AUTO_RATING";

type SalonLike = {
  id?: string | null;
  name?: string | null;
  classification?: string | null;
  adminVip?: boolean | null;
  isVip?: boolean | null;
  rating?: number | string | null;
  reviewCount?: number | string | null;
  isActive?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function toTimestamp(value?: Date | string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareNames(a?: string | null, b?: string | null) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareAdminVipCandidates(a: SalonLike, b: SalonLike) {
  const createdDelta = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
  if (createdDelta !== 0) return createdDelta;
  const updatedDelta = toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  const nameDelta = compareNames(a.name, b.name);
  if (nameDelta !== 0) return nameDelta;
  return compareNames(a.id, b.id);
}

function compareAutoVipCandidates(a: SalonLike, b: SalonLike) {
  const ratingDelta = Number(b.rating ?? 0) - Number(a.rating ?? 0);
  if (ratingDelta !== 0) return ratingDelta;
  const reviewCountDelta = Number(b.reviewCount ?? 0) - Number(a.reviewCount ?? 0);
  if (reviewCountDelta !== 0) return reviewCountDelta;
  const nameDelta = compareNames(a.name, b.name);
  if (nameDelta !== 0) return nameDelta;
  return compareNames(a.id, b.id);
}

export function normalizeSalonClassification(value?: string | null): PersistedSalonClassification {
  return String(value || "").trim().toUpperCase() === "PREMIUM" ? "PREMIUM" : "REGULAR";
}

export function getManualVipFlag(salon?: SalonLike | null) {
  if (!salon || typeof salon !== "object") return false;
  if (typeof salon.adminVip === "boolean") return salon.adminVip;
  return Boolean(salon.isVip);
}

export function getManualVipSalonIds(list: SalonLike[] = []) {
  return list
    .filter((salon) => salon && salon.isActive !== false && getManualVipFlag(salon))
    .slice()
    .sort(compareAdminVipCandidates)
    .slice(0, MAX_ADMIN_VIP_SLOTS)
    .map((salon) => String(salon.id || ""))
    .filter(Boolean);
}

export function getAutoVipSalonIds(list: SalonLike[] = []) {
  const adminVipIds = new Set(getManualVipSalonIds(list));
  return list
    .filter((salon) => {
      if (!salon || salon.isActive === false) return false;
      const salonId = String(salon.id || "");
      if (!salonId || adminVipIds.has(salonId)) return false;
      return Number(salon.reviewCount ?? 0) > 0 && Number(salon.rating ?? 0) > 0;
    })
    .slice()
    .sort(compareAutoVipCandidates)
    .slice(0, MAX_AUTO_VIP_SLOTS)
    .map((salon) => String(salon.id || ""))
    .filter(Boolean);
}

export function resolveVipSource(salon: SalonLike, options: { adminVipIds?: Set<string>; autoVipIds?: Set<string> } = {}): VipSource {
  const salonId = String(salon?.id || "");
  if (!salonId) return "NONE";
  if (options.adminVipIds?.has(salonId)) return "ADMIN";
  if (options.autoVipIds?.has(salonId)) return "AUTO_RATING";
  return "NONE";
}

export function buildPublicSalonState(salon: SalonLike, options: { adminVipIds?: Set<string>; autoVipIds?: Set<string> } = {}) {
  const baseClassification = normalizeSalonClassification(salon?.classification);
  const vipSource = resolveVipSource(salon, options);
  const isVip = vipSource !== "NONE";
  const classification: PublicSalonClassification = isVip ? "VIP" : baseClassification;
  return {
    baseClassification,
    classification,
    vipSource,
    adminVip: vipSource === "ADMIN",
    isVip,
  };
}
