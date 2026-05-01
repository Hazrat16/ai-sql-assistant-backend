import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { checkDbConnection } from "./db/pool.js";
import { logger } from "./utils/logger.js";

const env = loadEnv();

async function main() {
  if (env.STUB_DATABASE) {
    logger.warn(
      "STUB_DATABASE is on — Postgres is not used; /schema and /execute are mocked. For a real DB: `docker compose up -d` then `npm run dev` with STUB_DATABASE=false.",
    );
  } else {
    await checkDbConnection();
    logger.info("Database connection verified");
  }

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST }, "HTTP server listening");
}

main().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
