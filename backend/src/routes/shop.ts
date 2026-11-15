import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";

const brandSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
}).strict();

const productSchema = z.object({
  brandId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional(),
  retailPrice: z.number().min(0).optional(),
  wholesalePrice: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
}).strict();

const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"]),
}).strict();

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function shopRoutes(app: any) {
  // ==================== BRANDS ====================

  // Public: list active brands
  app.get("/api/v1/brands", async (_request: any, reply: any) => {
    const brands = await prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ brands });
  });

  // Admin: list all brands
  app.get("/api/v1/admin/brands", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
    return reply.send({ brands });
  });

  // Admin: create brand
  app.post("/api/v1/admin/brands", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const body = brandSchema.parse(request.body);
    const slug = body.slug || slugify(body.name);
    const existing = await prisma.brand.findUnique({ where: { slug } });
    if (existing) return reply.code(409).send({ error: "Brand slug already exists" });
    const record = await prisma.brand.create({ data: { ...body, slug } });
    return reply.code(201).send({ brand: record });
  });

  // Admin: update brand
  app.patch("/api/v1/admin/brands/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const { id } = request.params as { id: string };
    const body = brandSchema.partial().parse(request.body);
    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Brand not found" });
    if (body.slug && body.slug !== existing.slug) {
      const dup = await prisma.brand.findUnique({ where: { slug: body.slug } });
      if (dup) return reply.code(409).send({ error: "Brand slug already exists" });
    }
    const record = await prisma.brand.update({ where: { id }, data: body });
    return reply.send({ brand: record });
  });

  // Admin: delete brand
  app.delete("/api/v1/admin/brands/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const { id } = request.params as { id: string };
    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Brand not found" });
    await prisma.brand.delete({ where: { id } });
    return reply.send({ deleted: true });
  });

  // ==================== PRODUCTS ====================

  // Public: list published products
  app.get("/api/v1/products", async (_request: any, reply: any) => {
    const products = await prisma.product.findMany({
      where: { isPublished: true, isActive: true },
      include: { brand: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ products });
  });

  // Admin: list all products
  app.get("/api/v1/admin/products", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const products = await prisma.product.findMany({
      include: { brand: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ products });
  });

  // Admin: create product
  app.post("/api/v1/admin/products", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const body = productSchema.parse(request.body);
    const record = await prisma.product.create({ data: body as any });
    return reply.code(201).send({ product: record });
  });

  // Admin: update product
  app.patch("/api/v1/admin/products/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const { id } = request.params as { id: string };
    const body = productSchema.partial().parse(request.body);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Product not found" });
    const record = await prisma.product.update({ where: { id }, data: body as any });
    return reply.send({ product: record });
  });

  // Admin: delete product
  app.delete("/api/v1/admin/products/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const { id } = request.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Product not found" });
    await prisma.product.delete({ where: { id } });
    return reply.send({ deleted: true });
  });

  // ==================== ORDERS ====================

  // Admin: list all orders
  app.get("/api/v1/admin/orders", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const orders = await prisma.order.findMany({
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ orders });
  });

  // Admin: update order status
  app.patch("/api/v1/admin/orders/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);
    const { id } = request.params as { id: string };
    const body = orderStatusSchema.parse(request.body);
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Order not found" });
    const record = await prisma.order.update({ where: { id }, data: { status: body.status } });
    return reply.send({ order: record });
  });
}
