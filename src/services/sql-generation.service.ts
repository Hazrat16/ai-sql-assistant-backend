import { createHash } from "node:crypto";
import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import type { NaturalQueryResponse } from "../types/api.js";
import { fetchPublicSchema } from "./schema-introspection.service.js";
import { generateNlSqlResponse } from "./ai.service.js";
import { assertExecutableSelect } from "./query-validation.service.js";
import { getNlQueryCache, makeNlQueryCacheKey, setNlQueryCache } from "./query-cache.service.js";
import { logger } from "../utils/logger.js";

const env = loadEnv();

function fingerprintSchema(schemaJson: string): string {
  return createHash("sha256").update(schemaJson).digest("hex");
}

function fallbackResponse(userQuery: string): NaturalQueryResponse {
  return {
    sql: `SELECT id, email, full_name, created_at
FROM users
ORDER BY created_at DESC
LIMIT 50;`,
    explanation:
      "The AI provider could not complete this request. As a safe fallback, this query lists recent users from the public schema so you can still verify connectivity.",
    message: `Fallback activated for: "${userQuery.slice(0, 120)}${userQuery.length > 120 ? "…" : ""}"`,
  };
}

export async function generateSqlForNaturalLanguage(userQuery: string): Promise<NaturalQueryResponse> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "Query text is required", 400);
  }

  const schema = await fetchPublicSchema();
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
    logger.error({ err }, "AI generation failed; using fallback response");
    aiResult = fallbackResponse(trimmed);
  }

  try {
    assertExecutableSelect(aiResult.sql);
  } catch (err) {
    logger.warn({ err, sql: aiResult.sql }, "Model produced non-executable SQL; attempting strict fallback");
    const safe = fallbackResponse(trimmed);
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
