import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";

const MAX_LEGAL_FIELD_LENGTH = 100_000;

function sanitizeLegalHtml(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.slice(0, MAX_LEGAL_FIELD_LENGTH);
}

const IMPRINT_FIELDS = [
  "imprintOwnerName", "imprintCompanyName", "imprintStreet", "imprintCity",
  "imprintCountry", "imprintEmail", "imprintPhone", "imprintRepresentative", "imprintRegister"
] as const;

export async function legalRoutes(app: any) {
  app.get("/api/v1/legal", async (_request: any, reply: any) => {
    let record = await prisma.legalContent.findFirst();
    if (!record) {
      record = await prisma.legalContent.create({ data: {} });
    }
    return reply.send({
      impressum: record.impressum,
      datenschutz: record.datenschutz,
      agb: record.agb,
    });
  });

  app.get("/api/v1/admin/legal", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    let record = await prisma.legalContent.findFirst();
    if (!record) {
      record = await prisma.legalContent.create({ data: {} });
    }
    return reply.send({
      id: record.id,
      impressum: record.impressum,
      datenschutz: record.datenschutz,
      agb: record.agb,
      imprintOwnerName: record.imprintOwnerName,
      imprintCompanyName: record.imprintCompanyName,
      imprintStreet: record.imprintStreet,
      imprintCity: record.imprintCity,
      imprintCountry: record.imprintCountry,
      imprintEmail: record.imprintEmail,
      imprintPhone: record.imprintPhone,
      imprintRepresentative: record.imprintRepresentative,
      imprintRegister: record.imprintRegister,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  });

  app.patch("/api/v1/admin/legal", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const body = request.body ?? {};
    const patch: Record<string, string> = {};

    if (body.impressum !== undefined) patch.impressum = sanitizeLegalHtml(body.impressum);
    if (body.datenschutz !== undefined) patch.datenschutz = sanitizeLegalHtml(body.datenschutz);
    if (body.agb !== undefined) patch.agb = sanitizeLegalHtml(body.agb);

    for (const field of IMPRINT_FIELDS) {
      if (body[field] !== undefined) patch[field] = String(body[field] || "").slice(0, 500);
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: "No valid fields provided" });
    }

    let record = await prisma.legalContent.findFirst();
    if (!record) {
      record = await prisma.legalContent.create({ data: patch });
    } else {
      record = await prisma.legalContent.update({
        where: { id: record.id },
        data: patch,
      });
    }

    return reply.send({
      id: record.id,
      impressum: record.impressum,
      datenschutz: record.datenschutz,
      agb: record.agb,
      imprintOwnerName: record.imprintOwnerName,
      imprintCompanyName: record.imprintCompanyName,
      imprintStreet: record.imprintStreet,
      imprintCity: record.imprintCity,
      imprintCountry: record.imprintCountry,
      imprintEmail: record.imprintEmail,
      imprintPhone: record.imprintPhone,
      imprintRepresentative: record.imprintRepresentative,
      imprintRegister: record.imprintRegister,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  });
}
