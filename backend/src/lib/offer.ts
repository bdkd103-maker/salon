export type OfferInput = {
  title?: string | null;
  description?: string | null;
  price?: number | string | null;
  discount?: number | string | null;
  serviceName?: string | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  startTime?: string | null;
  endTime?: string | null;
  availableSlots?: number | string | null;
  isActive?: boolean | null;
};

export function normalizeOfferInput(input: OfferInput = {}) {
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const priceValue = Number(input.price ?? 0);
  const discountValue = Number(input.discount ?? 0);
  const availableSlotsValue = Number(input.availableSlots ?? 0);

  const normalizeDate = (value: string | Date | null | undefined) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  return {
    title: title.slice(0, 120) || "Last Minute Offer",
    description: description ? description.slice(0, 500) : null,
    price: Number.isFinite(priceValue) && priceValue >= 0 ? Number(priceValue.toFixed(2)) : 0,
    discount: Number.isFinite(discountValue) && discountValue >= 0 ? Number(discountValue.toFixed(2)) : 0,
    serviceName: String(input.serviceName ?? "").trim().slice(0, 80) || null,
    startAt: normalizeDate(input.startAt),
    endAt: normalizeDate(input.endAt),
    startTime: String(input.startTime ?? "").trim().slice(0, 16) || null,
    endTime: String(input.endTime ?? "").trim().slice(0, 16) || null,
    availableSlots: Number.isFinite(availableSlotsValue) && availableSlotsValue >= 0 ? Math.round(availableSlotsValue) : 0,
    isActive: input.isActive !== false,
  };
}
