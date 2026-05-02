import pg from "pg";
import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const MAX_DATABASE_URL_LENGTH = 8192;

export function assertExternalDatabaseAllowed(): void {
  const env = loadEnv();
  if (!env.ALLOW_EXTERNAL_DATABASE_URL) {
    throw new AppError(
      "BAD_REQUEST",
      "Connecting to arbitrary database URLs is disabled (ALLOW_EXTERNAL_DATABASE_URL=false)",
      403,
    );
  }
}

export function validatePostgresConnectionString(urlStr: string): string {
  const trimmed = urlStr.trim();
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "databaseUrl is required", 400);
  }
  if (trimmed.length > MAX_DATABASE_URL_LENGTH) {
    throw new AppError("VALIDATION_ERROR", "databaseUrl is too long", 400);
  }
  const proto = trimmed.split(":", 2)[0]?.toLowerCase() ?? "";
  if (proto !== "postgres" && proto !== "postgresql") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only postgres:// or postgresql:// connection strings are supported",
      400,
    );
  }
  return trimmed;
}

/**
 * Runs `fn` with a single short-lived pooled connection, then closes the pool.
 */
export async function withEphemeralPgConnection<T>(
  connectionString: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const validated = validatePostgresConnectionString(connectionString);
  const env = loadEnv();
  const pool = new pg.Pool({
    connectionString: validated,
    max: 1,
    connectionTimeoutMillis: Math.min(15_000, env.DB_STATEMENT_TIMEOUT_MS),
    idleTimeoutMillis: 1000,
  });
  try {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}
