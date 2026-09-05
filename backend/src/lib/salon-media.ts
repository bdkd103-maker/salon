import { z } from "zod";

const MAX_SALON_IMAGE_LENGTH = 4_000_000;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i;
const REMOTE_URL_PATTERN = /^https?:\/\//i;
const RELATIVE_URL_PATTERN = /^(?:\/|\.\/|\.\.\/)/;

function isValidSalonImageUrl(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  if (IMAGE_DATA_URL_PATTERN.test(normalized)) return true;
  if (REMOTE_URL_PATTERN.test(normalized)) return true;
  if (RELATIVE_URL_PATTERN.test(normalized)) return true;
  return false;
}

export const salonImageUrlSchema = z
  .union([z.string().trim().max(MAX_SALON_IMAGE_LENGTH), z.literal(""), z.null()])
  .optional()
  .refine((value) => value === undefined || isValidSalonImageUrl(String(value || "")), {
    message: "Invalid salon image URL",
  });

export function normalizeSalonImageUrl(value?: string | null) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function serializeSalonMedia(media: any) {
  return {
    id: media.id,
    salonId: media.salonId,
    kind: media.kind,
    url: media.url,
    createdAt: media.createdAt,
  };
}

export async function syncSalonPrimaryImage(tx: any, salonId: string, rawImageUrl?: string | null) {
  if (rawImageUrl === undefined) return;

  const imageUrl = normalizeSalonImageUrl(rawImageUrl);
  await tx.salonMedia.deleteMany({
    where: {
      salonId,
      kind: "image",
    },
  });

  if (!imageUrl) return;

  await tx.salonMedia.create({
    data: {
      salonId,
      kind: "image",
      url: imageUrl,
    },
  });
}
