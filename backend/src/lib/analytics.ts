export type AnalyticsEventType =
  | "profile_view"
  | "search_impression"
  | "phone_click"
  | "route_click"
  | "booking_click"
  | "favorite_click"
  | "loyalty_view"
  | "offer_view"
  | "boost_impression"
  | "new_customer"
  | "referral_click"
  | "referral_new_customer";

export type AnalyticsEvent = {
  id?: string;
  salonId?: string | null;
  userId?: string | null;
  eventType: AnalyticsEventType;
  source?: string;
  metadata?: Record<string, any>;
  createdAt?: string | Date;
};

export function getRangeStart(rangeDays: number) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (rangeDays - 1));
  return start;
}

export function getPreviousRangeStart(rangeDays: number) {
  const currentStart = getRangeStart(rangeDays);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - rangeDays);
  return previousStart;
}

export function normalizeEventType(eventType: string | null | undefined): AnalyticsEventType {
  const normalized = String(eventType || "").trim().toLowerCase().replace(/[_\-\s]+/g, "_");
  const aliasMap: Record<string, AnalyticsEventType> = {
    profile_view: "profile_view",
    profile: "profile_view",
    profile_views: "profile_view",
    search_impression: "search_impression",
    search_impressions: "search_impression",
    search: "search_impression",
    phone_click: "phone_click",
    phone_clicks: "phone_click",
    phone: "phone_click",
    route_click: "route_click",
    route_clicks: "route_click",
    route: "route_click",
    booking_click: "booking_click",
    booking_clicks: "booking_click",
    booking: "booking_click",
    favorite_click: "favorite_click",
    favorite_clicks: "favorite_click",
    favorite: "favorite_click",
    loyalty_view: "loyalty_view",
    loyalty_views: "loyalty_view",
    loyalty: "loyalty_view",
    stempel_usage: "loyalty_view",
    stempel: "loyalty_view",
    offer_view: "offer_view",
    offer_views: "offer_view",
    offer: "offer_view",
    boost_impression: "boost_impression",
    boost_impressions: "boost_impression",
    boost: "boost_impression",
    boost_view: "boost_impression",
    boost_views: "boost_impression",
    new_customer: "new_customer",
    new_customers: "new_customer",
    customer: "new_customer",
    referral_click: "referral_click",
    referral_clicks: "referral_click",
    referral: "referral_click",
    referral_new_customer: "referral_new_customer",
    referral_new_customers: "referral_new_customer",
    referral_customer: "referral_new_customer",
    referral_customers: "referral_new_customer",
    referral_conversion: "referral_new_customer",
    referral_conversions: "referral_new_customer",
    new_customer_via_referral: "referral_new_customer",
    new_customer_through_referral: "referral_new_customer",
    referral_new_customer_by_referral: "referral_new_customer",
  };

  const allowed: AnalyticsEventType[] = [
    "profile_view",
    "search_impression",
    "phone_click",
    "route_click",
    "booking_click",
    "favorite_click",
    "loyalty_view",
    "offer_view",
    "boost_impression",
    "new_customer",
    "referral_click",
    "referral_new_customer",
  ];

  return aliasMap[normalized] ?? (allowed.includes(normalized as AnalyticsEventType) ? (normalized as AnalyticsEventType) : "profile_view");
}

export function buildDateRangeSummary(items: Array<{ createdAt?: string | Date | null }> = [], rangeDays = 7) {
  const currentStart = getRangeStart(rangeDays);
  const previousStart = getPreviousRangeStart(rangeDays);
  const previousEnd = new Date(currentStart);
  previousEnd.setTime(previousEnd.getTime() - 1);

  const currentItems = items.filter((item) => {
    const date = new Date(item.createdAt ?? Date.now());
    return !Number.isNaN(date.getTime()) && date >= currentStart;
  });

  const previousItems = items.filter((item) => {
    const date = new Date(item.createdAt ?? Date.now());
    return !Number.isNaN(date.getTime()) && date >= previousStart && date <= previousEnd;
  });

  const current = currentItems.length;
  const previous = previousItems.length;
  const delta = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;

  return { current, previous, delta };
}

export function buildAnalyticsSummary(events: AnalyticsEvent[] = [], rangeDays = 7) {
  const currentStart = getRangeStart(rangeDays);
  const previousStart = getPreviousRangeStart(rangeDays);
  const previousEnd = new Date(currentStart);
  previousEnd.setTime(previousEnd.getTime() - 1);

  const currentEvents = events.filter((event) => {
    const date = new Date(event.createdAt ?? Date.now());
    return date >= currentStart;
  });

  const previousEvents = events.filter((event) => {
    const date = new Date(event.createdAt ?? Date.now());
    return date >= previousStart && date <= previousEnd;
  });

  const countByType = (list: AnalyticsEvent[]) => {
    const counts = new Map<string, number>();
    for (const event of list) {
      const key = normalizeEventType(event.eventType as string);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const currentCounts = countByType(currentEvents);
  const previousCounts = countByType(previousEvents);

  const metricNames = [
    "profile_view",
    "search_impression",
    "phone_click",
    "route_click",
    "booking_click",
    "favorite_click",
    "loyalty_view",
    "offer_view",
    "boost_impression",
    "new_customer",
    "referral_click",
    "referral_new_customer",
  ] as const;

  const metrics = Object.fromEntries(metricNames.map((key) => {
    const currentValue = currentCounts.get(key) ?? 0;
    const previousValue = previousCounts.get(key) ?? 0;
    const delta = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : ((currentValue - previousValue) / previousValue) * 100;
    return [key, {
      current: currentValue,
      previous: previousValue,
      delta,
    }];
  })) as Record<string, { current: number; previous: number; delta: number }>;

  const totalCurrent = metricNames.reduce((sum, key) => sum + (metrics[key]?.current ?? 0), 0);
  const totalPrevious = metricNames.reduce((sum, key) => sum + (metrics[key]?.previous ?? 0), 0);
  const totalDelta = totalPrevious === 0 ? (totalCurrent > 0 ? 100 : 0) : ((totalCurrent - totalPrevious) / totalPrevious) * 100;

  return {
    rangeDays,
    totals: {
      current: totalCurrent,
      previous: totalPrevious,
      delta: totalDelta,
    },
    metrics,
  };
}

export function formatDeltaText(delta: number) {
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${Math.round(delta)}%`;
}
