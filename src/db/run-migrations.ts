import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../db/migrations");

async function main() {
  const env = loadEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const fullPath = join(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    logger.info({ file }, "Applying migration");
    await client.query(sql);
  }

  await client.end();
  logger.info("Migrations completed");
}

main().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
