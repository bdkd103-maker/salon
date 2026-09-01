export function calculateProfileCompletion(salon: any = {}) {
  const checks = [
    { key: "name", label: "Salon name", condition: Boolean(String(salon?.name || "").trim()) },
    { key: "description", label: "Description", condition: Boolean(String(salon?.description || "").trim()) },
    { key: "address", label: "Address", condition: Boolean(String(salon?.address || "").trim()) },
    { key: "phone", label: "Phone", condition: Boolean(String(salon?.phone || "").trim()) },
    { key: "openingHours", label: "Opening hours", condition: Boolean(salon?.openingTime) && Boolean(salon?.closingTime) },
    { key: "services", label: "Services", condition: Array.isArray(salon?.services) ? salon.services.length > 0 : false },
    { key: "prices", label: "Prices", condition: Array.isArray(salon?.services) ? salon.services.some((service: any) => Number(service?.price ?? 0) > 0) : false },
    { key: "website", label: "Website / social links", condition: Boolean(String(salon?.website || "").trim()) || (Array.isArray(salon?.socialLinks) ? salon.socialLinks.some((link: any) => Boolean(String(link || "").trim())) : false) },
    { key: "categories", label: "Categories", condition: Array.isArray(salon?.categories) ? salon.categories.some((item: any) => Boolean(String(item || "").trim())) : Boolean(String(salon?.category || "").trim()) },
    { key: "photos", label: "Photos", condition: Boolean(String(salon?.image || "").trim()) || Boolean(String(salon?.photo || "").trim()) || Boolean(String(salon?.cover || "").trim()) || (Array.isArray(salon?.media) ? salon.media.length > 0 : false) },
  ];

  const filledCount = checks.filter((check) => check.condition).length;
  const completion = Math.min(100, Math.max(0, Math.round((filledCount / checks.length) * 100)));
  const missing = checks
    .filter((check) => !check.condition)
    .map((check) => check.key === "openingHours" ? "Öffnungszeiten hinzufügen" : check.key === "photos" ? "Fotos hinzufügen" : check.label);

  return {
    completion,
    total: checks.length,
    filled: filledCount,
    missing,
  };
}
