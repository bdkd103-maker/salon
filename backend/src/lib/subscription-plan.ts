export type SubscriptionPlan = "FREE" | "SMART" | "PREMIUM" | "PRO";

export type SubscriptionStatus = "ACTIVE" | "TRIAL" | "PAST_DUE" | "CANCELLED" | "EXPIRED";

export const SUBSCRIPTION_PLAN_ORDER: SubscriptionPlan[] = ["FREE", "SMART", "PREMIUM", "PRO"];

export function normalizeSubscriptionPlan(value?: string | null): SubscriptionPlan {
  const normalized = String(value ?? "FREE").trim().toUpperCase();

  if (normalized === "SMART") return "SMART";
  if (normalized === "PRO") return "PRO";
  if (normalized === "PREMIUM") return "PREMIUM";
  return "FREE";
}

export function getSubscriptionMeta(plan?: string | null) {
  const normalized = normalizeSubscriptionPlan(plan);

  const plans: Record<SubscriptionPlan, { label: string; monthlyPrice: number | null; features: string[] }> = {
    FREE: {
      label: "Free",
      monthlyPrice: 0,
      features: ["Basic profile", "Standard salon listing", "Manual availability updates"],
    },
    SMART: {
      label: "Smart",
      monthlyPrice: null,
      features: ["Live Salon Status", "Staff Frei/Busy", "Walk-ins", "Live Wait", "Smart Status"],
    },
    PRO: {
      label: "Pro",
      monthlyPrice: 19,
      features: ["Everything in Premium", "Owner Live Operations", "Smart Alerts", "Advanced reports and analytics"],
    },
    PREMIUM: {
      label: "Premium",
      monthlyPrice: 49,
      features: ["Everything in Smart", "Expanded Queue and Station capabilities"],
    },
  };

  return plans[normalized];
}
