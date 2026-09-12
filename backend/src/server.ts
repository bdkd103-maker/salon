import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import dotenv from "dotenv";

import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { bookingRoutes } from "./routes/bookings.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { deviceTokenRoutes } from "./routes/device-tokens.js";
import { loyaltyRoutes } from "./routes/loyalty.js";
import { privacyRoutes } from "./routes/privacy.js";
import { salonRoutes } from "./routes/salons.js";
import { queueRoutes } from "./routes/queue.js";
dotenv.config();

const allowedLocalOrigins = new Set([
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
]);

const codespacesFrontendOriginPattern = /^https:\/\/(?:8000-[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*-8000)\.(?:preview\.app\.github\.dev|app\.github\.dev|githubpreview\.dev)$/i;

function resolveCorsOrigin(origin?: string) {
  if (!origin) return true;
  if (allowedLocalOrigins.has(origin)) return origin;

  return codespacesFrontendOriginPattern.test(origin)
    ? origin
    : false;
}

async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, resolveCorsOrigin(origin));
    },
    credentials: true,
  });

  await app.register(helmet, {
    // Allow the Codespaces frontend and backend subdomains to share API responses.
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });

  app.setErrorHandler((error: any, request: any, reply: any) => {
    const statusCode = Number(error?.statusCode ?? 500);
    const isServerFailure = statusCode >= 500;
    const safeMessage =
      statusCode === 400 ? "Invalid request data." :
      statusCode === 401 ? "Unauthorized." :
      statusCode === 403 ? "Forbidden." :
      statusCode === 404 ? "Resource not found." :
      statusCode === 409 ? "Conflict detected." :
      statusCode >= 500 ? "The server is temporarily unavailable. Please try again later." :
      "Request failed.";

    app.log[isServerFailure ? "error" : "warn"]({
      method: request.method,
      url: request.url,
      statusCode,
      errorName: error?.name,
      requestId: request.id,
      userAgent: request.headers["user-agent"] ? "present" : "missing",
    }, isServerFailure ? "Unhandled server error" : "Request validation or auth error");

    reply.code(statusCode).send({ error: safeMessage });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/v1/ping", async () => ({ message: "pong" }));

  await authRoutes(app);
  await salonRoutes(app);
  await queueRoutes(app);
  await bookingRoutes(app);
  await deviceTokenRoutes(app);
  await loyaltyRoutes(app);
  await privacyRoutes(app);
  await dashboardRoutes(app);
  await analyticsRoutes(app);

  return app;
}

const start = async () => {
  const app = await buildServer();

  try {
    await app.listen({
      port: Number(process.env.PORT || 4000),
      host: "0.0.0.0",
    });

    console.log("API server started");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
