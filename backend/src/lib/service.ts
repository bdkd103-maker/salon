export type ServiceInput = {
  name?: string | null;
  description?: string | null;
  price?: number | string | null;
  durationMin?: number | string | null;
  isActive?: boolean | null;
};

export function normalizeServiceInput(input: ServiceInput = {}) {
  const name = String(input.name ?? "").trim();
  const priceValue = Number(input.price ?? 0);
  const durationValue = Number(input.durationMin ?? 30);

  return {
    name: name.slice(0, 80) || "Service",
    description: input.description ? String(input.description).trim().slice(0, 240) : null,
    price: Number.isFinite(priceValue) && priceValue >= 0 ? Number(priceValue.toFixed(2)) : 0,
    durationMin: Number.isFinite(durationValue) && durationValue > 0
      ? Math.min(Math.max(Math.round(durationValue), 5), 240)
      : 30,
    isActive: input.isActive !== false,
  };
}
