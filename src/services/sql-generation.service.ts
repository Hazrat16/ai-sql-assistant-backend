import { createHash } from "node:crypto";
import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import type { NaturalQueryResponse } from "../types/api.js";
import { fetchPublicSchema, type SchemaPayload, type SchemaTable } from "./schema-introspection.service.js";
import { generateNlSqlResponse } from "./ai.service.js";
import { assertExecutableSelect } from "./query-validation.service.js";
import { getNlQueryCache, makeNlQueryCacheKey, setNlQueryCache } from "./query-cache.service.js";
import { logger } from "../utils/logger.js";

const env = loadEnv();

function fingerprintSchema(schemaJson: string): string {
  return createHash("sha256").update(schemaJson).digest("hex");
}

function pickTable(userQuery: string, schema: SchemaPayload): SchemaTable | null {
  if (!schema.tables.length) return null;
  const q = userQuery.toLowerCase();
  const exact = schema.tables.find((t) => q.includes(t.name.toLowerCase()));
  if (exact) return exact;

  const singularMatch = schema.tables.find((t) => {
    const table = t.name.toLowerCase();
    return table.endsWith("s") && q.includes(table.slice(0, -1));
  });
  if (singularMatch) return singularMatch;

  return schema.tables[0];
}

function pickColumns(table: SchemaTable): string[] {
  const preferred = ["id", "email", "name", "full_name", "title", "status", "created_at", "updated_at"];
  const available = new Set(table.columns.map((c) => c.name));
  const picked = preferred.filter((col) => available.has(col));
  if (picked.length) return picked;
  return table.columns.slice(0, 6).map((c) => c.name);
}

function pickOrderColumn(table: SchemaTable): string | null {
  const preferred = ["created_at", "updated_at", "id"];
  const available = new Set(table.columns.map((c) => c.name));
  return preferred.find((col) => available.has(col)) ?? null;
}

function hasTable(schema: SchemaPayload, tableName: string): boolean {
  return schema.tables.some((t) => t.name === tableName);
}

function buildTopCustomersBySpendingQuery(schema: SchemaPayload, limit: number): string | null {
  if (hasTable(schema, "big_customers") && hasTable(schema, "big_orders")) {
    return `SELECT
  c.id,
  c.full_name,
  c.email,
  SUM(o.total_cents)::bigint AS total_spent_cents
FROM big_customers c
JOIN big_orders o ON o.customer_id = c.id
GROUP BY c.id, c.full_name, c.email
ORDER BY total_spent_cents DESC
LIMIT ${limit};`;
  }

  if (hasTable(schema, "users") && hasTable(schema, "orders")) {
    return `SELECT
  u.id,
  u.full_name,
  u.email,
  SUM(o.total_cents)::bigint AS total_spent_cents
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.full_name, u.email
ORDER BY total_spent_cents DESC
LIMIT ${limit};`;
  }

  return null;
}

function fallbackResponse(userQuery: string, schema: SchemaPayload): NaturalQueryResponse {
  const table = pickTable(userQuery, schema);
  if (!table) {
    return {
      sql: "SELECT 1 AS ok;",
      explanation:
        "No tables were found in the public schema, so this query is a minimal connectivity check.",
      message: "Offline SQL mode: database responded, but no public tables are available.",
    };
  }

  const q = userQuery.toLowerCase();
  const limitFromPrompt = /\b(\d{1,3})\b/.exec(q)?.[1];
  const limit = Math.min(Math.max(Number(limitFromPrompt ?? "50"), 1), 200);
  const orderCol = pickOrderColumn(table);
  const wantsCount = /\b(count|how many|number of)\b/.test(q);
  const wantsSpendingLeaderboard =
    /\b(top|highest|most)\b/.test(q) &&
    /\b(customer|customers|user|users)\b/.test(q) &&
    /\b(spending|spent|revenue|sales|total spending)\b/.test(q);
  const isGreeting = /\b(hi|hello|hey)\b/.test(q) && q.length < 20;

  if (wantsSpendingLeaderboard) {
    const spendingSql = buildTopCustomersBySpendingQuery(schema, limit);
    if (spendingSql) {
      return {
        sql: spendingSql,
        explanation:
          "Offline SQL mode detected a customer spending leaderboard request and generated a join + aggregate query.",
        message: "Generated from schema using local fallback mode.",
      };
    }
  }

  if (wantsCount) {
    return {
      sql: `SELECT COUNT(*)::bigint AS total
FROM ${table.name};`,
      explanation: `Offline SQL mode generated a safe count query for table "${table.name}" without using any paid AI provider.`,
      message: "Generated from schema using local fallback mode.",
    };
  }

  const columns = pickColumns(table).join(", ");
  const orderClause = orderCol ? `\nORDER BY ${orderCol} DESC` : "";
  const sql = `SELECT ${columns}
FROM ${table.name}${orderClause}
LIMIT ${limit};`;

  return {
    sql,
    explanation:
      `Offline SQL mode generated a schema-aware SELECT for "${table.name}" so you can continue without an OpenAI key.`,
    message: isGreeting
      ? 'You can ask things like "show recent users" or "count orders". Generated a safe sample query for now.'
      : `Generated from schema in offline mode for: "${userQuery.slice(0, 120)}${userQuery.length > 120 ? "..." : ""}"`,
  };
}

export type GenerateSqlOptions = {
  databaseUrl?: string;
};

export async function generateSqlForNaturalLanguage(
  userQuery: string,
  options?: GenerateSqlOptions,
): Promise<NaturalQueryResponse> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "Query text is required", 400);
  }

  const schema = await fetchPublicSchema(
    options?.databaseUrl?.trim() ? { databaseUrl: options.databaseUrl.trim() } : undefined,
  );
  const schemaJson = JSON.stringify(schema);
  const fp = fingerprintSchema(schemaJson);
  const cacheKey = makeNlQueryCacheKey(trimmed, fp);
  const ttlMs = env.QUERY_CACHE_TTL_SECONDS * 1000;
  const cached = getNlQueryCache(cacheKey);
  if (cached) {
    logger.debug({ cacheKey }, "NL query cache hit");
    return cached;
  }

  let aiResult: NaturalQueryResponse;
  try {
    aiResult = await generateNlSqlResponse({ userQuery: trimmed, schemaJson });
  } catch (err) {
    if (err instanceof AppError && err.code === "OPENAI_ERROR") {
      throw err;
    }
    logger.error({ err }, "AI generation failed; using offline fallback");
    aiResult = fallbackResponse(trimmed, schema);
  }

  try {
    assertExecutableSelect(aiResult.sql);
  } catch (err) {
    logger.warn({ err, sql: aiResult.sql }, "Model produced non-executable SQL; attempting strict fallback");
    const safe = fallbackResponse(trimmed, schema);
    assertExecutableSelect(safe.sql);
    aiResult = {
      ...safe,
      explanation: `${safe.explanation}\n\nOriginal model explanation (for debugging): ${aiResult.explanation}`,
      message: aiResult.message,
    };
  }

  setNlQueryCache(cacheKey, ttlMs, aiResult);
  return aiResult;
}
