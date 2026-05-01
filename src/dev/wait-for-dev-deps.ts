import pg from "pg";
import { loadEnv } from "../config/env.js";

const PG_INTERVAL_MS = 400;
const PG_MAX_MS = 90_000;
const OLLAMA_INTERVAL_MS = 400;
const OLLAMA_MAX_MS = 120_000;

function ollamaRootFromOpenAiBaseUrl(baseUrl: string): string | null {
  const u = baseUrl.trim().replace(/\/$/, "");
  if (!u.includes("11434")) return null;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(u)) return null;
  return u.replace(/\/v1$/i, "");
}

async function waitForPostgres(connectionString: string): Promise<void> {
  const start = Date.now();
  process.stdout.write("Waiting for Postgres …");
  for (;;) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 2500,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      console.log(` ok (${Math.round((Date.now() - start) / 1000)}s)`);
      return;
    } catch {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      if (Date.now() - start > PG_MAX_MS) {
        console.error(
          "\nPostgres did not become ready in time. From ai-sql-assistant-backend run: docker compose up -d",
        );
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, PG_INTERVAL_MS));
      process.stdout.write(".");
    }
  }
}

async function waitForLocalOllama(root: string): Promise<void> {
  const start = Date.now();
  process.stdout.write("Waiting for Ollama …");
  for (;;) {
    try {
      const res = await fetch(`${root}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(` ok (${Math.round((Date.now() - start) / 1000)}s)`);
        return;
      }
    } catch {
      /* retry */
    }
    if (Date.now() - start > OLLAMA_MAX_MS) {
      console.warn(
        "\nOllama did not respond in time; NL→SQL may fail until it is ready (docker compose / ollama serve).",
      );
      return;
    }
    await new Promise((r) => setTimeout(r, OLLAMA_INTERVAL_MS));
    process.stdout.write(".");
  }
}

async function main() {
  const env = loadEnv();
  if (env.STUB_DATABASE) {
    console.log("STUB_DATABASE is set — skipping dependency wait.");
    return;
  }

  await waitForPostgres(env.DATABASE_URL);

  const base = env.OPENAI_BASE_URL;
  const ollamaRoot = base ? ollamaRootFromOpenAiBaseUrl(base) : null;
  if (ollamaRoot) {
    await waitForLocalOllama(ollamaRoot);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
