import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envFileDir = dirname(fileURLToPath(import.meta.url));
/** Backend package root (contains package.json), whether running from src/ or dist/ */
const packageRoot = resolve(envFileDir, "../..");

for (const file of [".env", ".env.local"]) {
  const path = resolve(packageRoot, file);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}
/** Also support running tools with cwd outside the package */
loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z
    .preprocess((val: unknown) => {
      if (val === undefined || val === null) return undefined;
      if (typeof val !== "string") return undefined;
      const s = val.trim();
      return s.length ? s : undefined;
    }, z.string().min(1).optional()),
  /** OpenAI-compatible API root (e.g. Ollama: http://localhost:11434/v1). Omit for api.openai.com */
  OPENAI_BASE_URL: z
    .preprocess((val: unknown) => {
      if (val === undefined || val === null) return undefined;
      if (typeof val !== "string") return undefined;
      const s = val.trim().replace(/\/$/, "");
      return s.length ? s : undefined;
    }, z.string().min(1).optional()),
  /**
   * json_object: pass response_format (works on OpenAI; some local servers reject it).
   * none: rely on prompt only; parser tolerates fenced JSON.
   */
  OPENAI_RESPONSE_FORMAT: z.enum(["json_object", "none"]).default("json_object"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ALLOW_UPDATE_IN_AI_GENERATION: z
    .preprocess((val: unknown) => {
      if (val === undefined || val === null || val === "") return "false";
      if (typeof val === "boolean") return val ? "true" : "false";
      if (typeof val === "string") return val.toLowerCase();
      return "false";
    }, z.enum(["true", "false"]))
    .transform((v) => v === "true"),
  QUERY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    const hint =
      Array.isArray(msg.DATABASE_URL) && msg.DATABASE_URL.length
        ? " Hint: copy .env.example to .env in ai-sql-assistant-backend and set DATABASE_URL (e.g. postgres://postgres:postgres@localhost:5432/ai_sql_assistant if using docker compose)."
        : "";
    throw new Error(`Invalid environment configuration: ${JSON.stringify(msg)}.${hint}`);
  }
  cached = parsed.data;
  return cached;
}
