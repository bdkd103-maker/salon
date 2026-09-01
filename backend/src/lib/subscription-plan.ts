export type SubscriptionPlan = "FREE" | "PRO" | "PREMIUM";

export type SubscriptionStatus = "ACTIVE" | "TRIAL" | "PAST_DUE" | "CANCELLED" | "EXPIRED";

export const SUBSCRIPTION_PLAN_ORDER: SubscriptionPlan[] = ["FREE", "PRO", "PREMIUM"];

export function normalizeSubscriptionPlan(value?: string | null): SubscriptionPlan {
  const normalized = String(value ?? "FREE").trim().toUpperCase();

  if (normalized === "PRO") return "PRO";
  if (normalized === "PREMIUM") return "PREMIUM";
  return "FREE";
}

export function getSubscriptionMeta(plan?: string | null) {
  const normalized = normalizeSubscriptionPlan(plan);

  const plans: Record<SubscriptionPlan, { label: string; monthlyPrice: number; features: string[] }> = {
    FREE: {
      label: "Free",
      monthlyPrice: 0,
      features: ["Basic profile", "Standard salon listing", "Manual availability updates"],
    },
    PRO: {
      label: "Pro",
      monthlyPrice: 19,
      features: ["Priority display", "Advanced availability tools", "Stempelkarte support", "Performance insights"],
    },
    PREMIUM: {
      label: "Premium",
      monthlyPrice: 49,
      features: ["Everything in Pro", "Boost placements", "Premium badge and promotion", "Priority support"],
    },
  };

  return plans[normalized];
}
