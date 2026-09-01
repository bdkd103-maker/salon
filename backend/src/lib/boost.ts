export type BoostDuration = 7 | 14;
export type BoostStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";

export function normalizeBoostDuration(value?: string | number | null): BoostDuration {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 14 ? 14 : 7;
  }

  if (typeof value === "string") {
    const match = value.trim().toLowerCase().match(/(7|14)\s*(day|days|d|day\s*\(?s?\)?)?/i);
    if (match) {
      return Number(match[1]) === 14 ? 14 : 7;
    }
  }

  return 7;
}

export function normalizeBoostStatus(value?: string | null): BoostStatus {
  const normalized = String(value ?? "ACTIVE").trim().toUpperCase();

  if (normalized === "EXPIRED") return "EXPIRED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return "ACTIVE";
}

export function getBoostMeta(durationDays?: string | number | null) {
  const duration = normalizeBoostDuration(durationDays);

  const options: Record<BoostDuration, { label: string; price: number; durationDays: number; features: string[] }> = {
    7: {
      label: "7 Days",
      price: 19,
      durationDays: 7,
      features: ["Featured placement in the top list", "Visible premium badge", "Slightly earlier discovery"],
    },
    14: {
      label: "14 Days",
      price: 39,
      durationDays: 14,
      features: ["Featured placement in the top list", "Extended visibility for two weeks", "Priority appearance in search results"],
    },
  };

  return options[duration];
}

export function isBoostActive(boost: { status?: string | null; startsAt?: Date | string | null; endsAt?: Date | string | null }) {
  const status = normalizeBoostStatus(boost?.status ?? "ACTIVE");
  if (status !== "ACTIVE") return false;

  const startsAt = boost?.startsAt ? new Date(boost.startsAt) : null;
  const endsAt = boost?.endsAt ? new Date(boost.endsAt) : null;

  const hasValidWindow = startsAt && !Number.isNaN(startsAt.getTime()) && endsAt && !Number.isNaN(endsAt.getTime());
  if (!hasValidWindow) return true;

  const now = Date.now();
  return now >= startsAt.getTime() && now <= endsAt.getTime();
}
