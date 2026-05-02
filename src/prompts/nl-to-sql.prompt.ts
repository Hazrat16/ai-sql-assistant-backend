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
    "PostgreSQL alias rule (critical): If you write FROM tablename alias (example: FROM big_customers c JOIN big_orders o), every column from that table MUST use ONLY the alias (c.email, o.total_cents). Never mix tablename.column (big_customers.email) together with an alias — PostgreSQL raises \"invalid reference to FROM-clause entry\".",
    "JOIN ON / WHERE / GROUP BY / ORDER BY must use the same aliases you introduced in FROM (e.g. ON o.customer_id = c.id).",
    "Always qualify tables with schemas when ambiguous (default to public).",
    "Use ISO-friendly casts and safe aggregations. Avoid vendor-specific functions beyond PostgreSQL.",
    "If the question cannot be answered with the provided schema, still return syntactically valid SQL that comes as close as possible and explain the limitation.",
    "Return ONLY a single JSON object. No markdown, no prose before or after the JSON, no ``` fences.",
    "Required JSON keys: sql (string), explanation (string). Optional key: message (short assistant summary).",
    "The sql field must be one PostgreSQL SELECT (semicolon optional).",
    "If you output anything other than raw JSON (for example explanatory text or SQL inside markdown), the assistant cannot parse your reply.",
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
