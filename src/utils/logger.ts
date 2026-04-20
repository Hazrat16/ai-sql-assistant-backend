import pino, { type LoggerOptions } from "pino";
import { loadEnv } from "../config/env.js";

const env = loadEnv();

/** Options object for Fastify `logger` (Fastify 5 does not accept a raw Pino instance there). */
export function getPinoOptions(): LoggerOptions {
  return {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          }
        : undefined,
  };
}

/** Standalone Pino logger for scripts (e.g. migrations) outside Fastify. */
export const logger = pino(getPinoOptions());

export function createRequestLogger(reqId: string) {
  return logger.child({ reqId });
}
