import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { checkDbConnection } from "./db/pool.js";
import { logger } from "./utils/logger.js";

const env = loadEnv();

async function main() {
  await checkDbConnection();
  logger.info("Database connection verified");

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST }, "HTTP server listening");
}

main().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
