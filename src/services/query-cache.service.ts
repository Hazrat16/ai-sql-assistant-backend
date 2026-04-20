import { createHash } from "node:crypto";
import type { NaturalQueryResponse } from "../types/api.js";

interface CacheEntry {
  value: NaturalQueryResponse;
  expiresAt: number;
}

const memory = new Map<string, CacheEntry>();

export function makeNlQueryCacheKey(userQuery: string, schemaFingerprint: string): string {
  return createHash("sha256").update(`${userQuery}\n---\n${schemaFingerprint}`).digest("hex");
}

export function getNlQueryCache(key: string, now = Date.now()): NaturalQueryResponse | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

export function setNlQueryCache(key: string, ttlMs: number, value: NaturalQueryResponse, now = Date.now()) {
  if (ttlMs <= 0) return;
  memory.set(key, { value, expiresAt: now + ttlMs });
}
