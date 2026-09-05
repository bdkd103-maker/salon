export type AdminDashboardInput = {
  users?: Array<{ id?: string; role?: string | null; status?: string | null; deletedAt?: Date | string | null }>;
  salons?: Array<{ id?: string; isActive?: boolean | null; isVip?: boolean | null; adminVip?: boolean | null; classification?: string | null; status?: string | null; createdAt?: Date | string | null; ownerId?: string | null }>;
  barbers?: Array<{ id?: string; isActive?: boolean | null }>;
  availabilitySlots?: Array<{ id?: string; status?: string | null }>;
  bookings?: Array<{ id?: string; status?: string | null; startAt?: Date | string | null }>;
  subscriptions?: Array<{ id?: string; status?: string | null; plan?: string | null; startDate?: Date | string | null; renewalDate?: Date | string | null; createdAt?: Date | string | null; monthlyPrice?: number | string | null }>;
  reviews?: Array<{ id?: string }>;
  offers?: Array<{ id?: string; isActive?: boolean | null }>;
  analyticsEvents?: Array<{ eventType?: string | null }>;
  notifications?: Array<{ id?: string; isRead?: boolean | null }>;
  boosts?: Array<{ id?: string; status?: string | null }>;
  loyaltyCards?: Array<{
    id?: string;
    salonId?: string | null;
    isActive?: boolean | null;
    requiredStamps?: number | null;
    customers?: Array<{
      id?: string | null;
      customerId?: string | null;
      currentStamps?: number | null;
      lastStampedAt?: Date | string | null;
      customer?: { fullName?: string | null; email?: string | null } | null;
    }>;
    stamps?: Array<{ id?: string; isValid?: boolean | null; stampAt?: Date | string | null }>;
  }>;
};

export function summarizeAdminDashboard(input: AdminDashboardInput = {}) {
  const users = Array.isArray(input.users) ? input.users : [];
  const salons = Array.isArray(input.salons) ? input.salons : [];
  const barbers = Array.isArray(input.barbers) ? input.barbers : [];
  const availabilitySlots = Array.isArray(input.availabilitySlots) ? input.availabilitySlots : [];
  const bookings = Array.isArray(input.bookings) ? input.bookings : [];
  const subscriptions = Array.isArray(input.subscriptions) ? input.subscriptions : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const offers = Array.isArray(input.offers) ? input.offers : [];
  const analyticsEvents = Array.isArray(input.analyticsEvents) ? input.analyticsEvents : [];
  const notifications = Array.isArray(input.notifications) ? input.notifications : [];
  const boosts = Array.isArray(input.boosts) ? input.boosts : [];
  const loyaltyCards = Array.isArray(input.loyaltyCards) ? input.loyaltyCards : [];

  const totalUsers = users.filter((user) => user?.status !== "DELETED").length;
  const totalSalons = salons.length;
  const activeSalons = salons.filter((salon) => salon?.isActive !== false).length;
  const premiumSalons = salons.filter((salon) => String(salon?.classification ?? "").toUpperCase() === "PREMIUM").length;
  const manualVipSalons = salons.filter((salon) => Boolean(salon?.adminVip ?? salon?.isVip)).length;
  const totalBarbers = barbers.length;
  const activeBarbers = barbers.filter((barber) => barber?.isActive !== false).length;
  const totalAvailabilitySlots = availabilitySlots.length;
  const availableSlots = availabilitySlots.filter((slot) => String(slot?.status ?? "").toUpperCase() === "AVAILABLE").length;
  const bookedSlots = availabilitySlots.filter((slot) => String(slot?.status ?? "").toUpperCase() === "BOOKED").length;
  const blockedSlots = availabilitySlots.filter((slot) => String(slot?.status ?? "").toUpperCase() === "BLOCKED").length;
  const totalBookings = bookings.length;
  const pendingBookings = bookings.filter((booking) => String(booking?.status ?? "").toUpperCase() === "PENDING").length;
  const totalReviews = reviews.length;
  const totalOffers = offers.length;
  const activeOffers = offers.filter((offer) => offer?.isActive !== false).length;
  const totalFavorites = analyticsEvents.filter((event) => String(event?.eventType ?? "").toLowerCase() === "favorite_click").length;
  const totalSubscribers = subscriptions.length;
  const activeSubscriptions = subscriptions.filter((subscription) => String(subscription?.status ?? "").toUpperCase() === "ACTIVE").length;
  const cancelledSubscriptions = subscriptions.filter((subscription) => String(subscription?.status ?? "").toUpperCase() === "CANCELLED").length;
  const expiredSubscriptions = subscriptions.filter((subscription) => String(subscription?.status ?? "").toUpperCase() === "EXPIRED").length;
  const newSubscriptions = subscriptions.filter((subscription) => {
    const rawDate = subscription?.startDate ?? subscription?.createdAt;
    if (!rawDate) return false;
    const date = new Date(rawDate as string | number | Date);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() <= 1000 * 60 * 60 * 24 * 30;
  }).length;
  const planCounts = {
    FREE: subscriptions.filter((subscription) => String(subscription?.plan ?? "FREE").toUpperCase() === "FREE").length,
    PRO: subscriptions.filter((subscription) => String(subscription?.plan ?? "FREE").toUpperCase() === "PRO").length,
    PREMIUM: subscriptions.filter((subscription) => String(subscription?.plan ?? "FREE").toUpperCase() === "PREMIUM").length,
  };
  const activeMonthlyPrice = subscriptions
    .filter((subscription) => String(subscription?.status ?? "").toUpperCase() === "ACTIVE")
    .reduce((sum, subscription) => sum + (Number(subscription?.monthlyPrice ?? 0) || 0), 0);
  const dailyRevenue = activeMonthlyPrice > 0 ? Number((activeMonthlyPrice / 30).toFixed(2)) : null;
  const weeklyRevenue = activeMonthlyPrice > 0 ? Number((activeMonthlyPrice / 4.33).toFixed(2)) : null;
  const monthlyRevenue = activeMonthlyPrice > 0 ? Number(activeMonthlyPrice.toFixed(2)) : null;
  const mrr = activeMonthlyPrice > 0 ? Number(activeMonthlyPrice.toFixed(2)) : null;
  const totalNotifications = notifications.length;
  const totalBoosts = boosts.length;
  const activeBoosts = boosts.filter((boost) => String(boost?.status ?? "").toUpperCase() === "ACTIVE").length;
  const totalLoyaltyCards = loyaltyCards.length;
  const activeLoyaltyCards = loyaltyCards.filter((card) => card?.isActive !== false).length;
  const loyaltySalonsUsing = new Set(loyaltyCards.filter((card) => card?.salonId).map((card) => card.salonId)).size;
  const totalLoyaltyStamps = loyaltyCards.reduce((sum, card) => {
    const stamps = Array.isArray(card?.stamps) ? card.stamps.filter((stamp) => stamp?.isValid !== false) : [];
    return sum + stamps.length;
  }, 0);
  const completedRewards = loyaltyCards.reduce((sum, card) => {
    const threshold = Number(card?.requiredStamps ?? 0) || 0;
    if (!threshold) return sum;
    const readyCustomers = Array.isArray(card?.customers)
      ? card.customers.filter((customer) => Number(customer?.currentStamps ?? 0) >= threshold).length
      : 0;
    return sum + readyCustomers;
  }, 0);
  const dayMs = 1000 * 60 * 60 * 24;
  const weekMs = dayMs * 7;
  const monthMs = dayMs * 30;
  const now = Date.now();
  const loyaltyUsageDaily = loyaltyCards.reduce((sum, card) => {
    const stamps = Array.isArray(card?.stamps) ? card.stamps : [];
    return sum + stamps.filter((stamp) => {
      const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
      return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= dayMs;
    }).length;
  }, 0);
  const loyaltyUsageWeekly = loyaltyCards.reduce((sum, card) => {
    const stamps = Array.isArray(card?.stamps) ? card.stamps : [];
    return sum + stamps.filter((stamp) => {
      const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
      return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= weekMs;
    }).length;
  }, 0);
  const loyaltyUsageMonthly = loyaltyCards.reduce((sum, card) => {
    const stamps = Array.isArray(card?.stamps) ? card.stamps : [];
    return sum + stamps.filter((stamp) => {
      const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
      return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= monthMs;
    }).length;
  }, 0);

  return {
    totalUsers,
    totalSalons,
    activeSalons,
    premiumSalons,
    manualVipSalons,
    totalBarbers,
    activeBarbers,
    totalAvailabilitySlots,
    availableSlots,
    bookedSlots,
    blockedSlots,
    totalBookings,
    pendingBookings,
    totalReviews,
    totalOffers,
    activeOffers,
    totalFavorites,
    totalSubscribers,
    activeSubscriptions,
    cancelledSubscriptions,
    expiredSubscriptions,
    newSubscriptions,
    planCounts,
    activeMonthlyPrice,
    dailyRevenue,
    weeklyRevenue,
    monthlyRevenue,
    mrr,
    totalNotifications,
    totalBoosts,
    activeBoosts,
    totalLoyaltyCards,
    activeLoyaltyCards,
    loyaltySalonsUsing,
    totalLoyaltyStamps,
    completedRewards,
    loyaltyUsageDaily,
    loyaltyUsageWeekly,
    loyaltyUsageMonthly,
  };
}
