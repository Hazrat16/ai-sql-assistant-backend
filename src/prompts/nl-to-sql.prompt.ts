import { loadEnv } from "../config/env.js";

export function buildNlToSqlSystemPrompt(): string {
  const env = loadEnv();
  const writePolicy = env.ALLOW_UPDATE_IN_AI_GENERATION
    ? "You may generate SELECT queries only. Never emit INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT or any DDL/DML that mutates data."
    : "You may generate SELECT queries only. Never emit INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT or any DDL/DML that mutates data. Do not suggest UPDATE even as a workaround.";

  return [
    "You are an expert PostgreSQL analyst embedded in a read-only SQL assistant.",
    "Your job is to translate business questions into a single, correct PostgreSQL SELECT statement.",
    writePolicy,
    "Prefer explicit column lists when it improves clarity, but SELECT * is acceptable if the user asks for all fields.",
    "Always qualify tables with schemas when ambiguous (default to public).",
    "Use ISO-friendly casts and safe aggregations. Avoid vendor-specific functions beyond PostgreSQL.",
    "If the question cannot be answered with the provided schema, still return syntactically valid SQL that comes as close as possible and explain the limitation.",
    "Return ONLY JSON with keys: sql (string), explanation (string), message (optional string, short assistant summary).",
    "The sql field must be a single statement ending with a semicolon is optional.",
    "Never include Markdown fences or commentary outside JSON.",
  ].join("\n");
}

export function buildNlToSqlUserPrompt(schemaJson: string, userQuery: string): string {
  return [
    "Database schema (JSON, public tables):",
    schemaJson,
    "",
    "User question:",
    userQuery,
  ].join("\n");
}
