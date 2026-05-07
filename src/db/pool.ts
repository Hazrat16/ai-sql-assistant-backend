import pg from "pg";
import { loadEnv } from "../config/env.js";
import { withChannelBindingFromUri } from "./pg-channel-binding.js";
import { logger } from "../utils/logger.js";

const env = loadEnv();

export const pool = new pg.Pool(
  withChannelBindingFromUri(env.DATABASE_URL, {
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  }),
);

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});

export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
