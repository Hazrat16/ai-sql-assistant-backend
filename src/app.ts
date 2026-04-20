import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { loadEnv } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";
import { getPinoOptions } from "./utils/logger.js";
import { AppError, toErrorResponse } from "./utils/errors.js";

const env = loadEnv();

export async function buildApp() {
  const app = Fastify({
    logger: getPinoOptions(),
    genReqId: () => randomUUID(),
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
  });

  await app.register(helmet, { global: true });

  const origins = env.CORS_ORIGIN.split(",").map((s) => s.trim());
  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  await registerRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled error");
    if (error instanceof AppError) {
      const mapped = toErrorResponse(error);
      return reply.status(mapped.statusCode).send(mapped.body);
    }
    const mapped = toErrorResponse(error);
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  return app;
}
