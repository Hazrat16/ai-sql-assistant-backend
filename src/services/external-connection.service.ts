import pg, { type ClientBase, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { loadEnv, type Env } from "../config/env.js";
import { withChannelBindingFromUri, type PgDriverConfig } from "../db/pg-channel-binding.js";
import { AppError } from "../utils/errors.js";
import { applyExternalPostgresDnsResolution } from "../utils/external-postgres-dns.js";
import { extractPostgresConnectionString } from "../utils/postgres-connection-string.js";

const MAX_DATABASE_URL_LENGTH = 8192;

/** Users sometimes paste an entire curl command (or JSON) into databaseUrl by mistake. */
function looksLikeShellOrHttpPayload(s: string): boolean {
  const t = s.trim();
  if (/^\s*curl\s+/i.test(t)) return true;
  if (/\b--data-raw\b/i.test(s)) return true;
  if (/\bcurl\s+['"]?https?:\/\//i.test(s)) return true;
  if (/\bSec-Fetch-Dest:\s/i.test(s)) return true;
  return false;
}

export function assertExternalDatabaseAllowed(): void {
  const env = loadEnv();
  if (!env.ALLOW_EXTERNAL_DATABASE_URL) {
    throw new AppError(
      "BAD_REQUEST",
      "Connecting to arbitrary database URLs is disabled (ALLOW_EXTERNAL_DATABASE_URL=false)",
      403,
    );
  }
}

export function validatePostgresConnectionString(urlStr: string): string {
  if (looksLikeShellOrHttpPayload(urlStr)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "databaseUrl must be only your PostgreSQL connection string (postgresql://...). Do not paste curl commands, headers, or JSON bodies into this field.",
      400,
    );
  }
  const trimmed = extractPostgresConnectionString(urlStr);
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "databaseUrl is required", 400);
  }
  if (trimmed.length > MAX_DATABASE_URL_LENGTH) {
    throw new AppError("VALIDATION_ERROR", "databaseUrl is too long", 400);
  }
  const proto = trimmed.split(":", 2)[0]?.toLowerCase() ?? "";
  if (proto !== "postgres" && proto !== "postgresql") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only postgres:// or postgresql:// connection strings are supported (paste the URI only, or ensure it includes postgresql://)",
      400,
    );
  }
  return trimmed;
}

function resolveExternalDnsFamily(env: Env): "auto" | "ipv4" | "ipv6" | "hostname" {
  const raw = (env as Record<string, unknown>)["DB_EXTERNAL_POSTGRES_DNS_FAMILY"];
  if (raw === "ipv4" || raw === "ipv6" || raw === "hostname") return raw;
  return "auto";
}

async function resolveExternalClientConfig(base: PgDriverConfig, env: Env): Promise<ClientConfig> {
  const dnsFamily = resolveExternalDnsFamily(env);
  return (await applyExternalPostgresDnsResolution(base, dnsFamily)) as ClientConfig;
}

/**
 * Runs `fn` with a single dedicated client (no pool) so connect/teardown matches one-shot CLI tools.
 */
export async function withEphemeralPgConnection<T>(
  connectionString: string,
  fn: (client: ClientBase) => Promise<T>,
): Promise<T> {
  const validated = validatePostgresConnectionString(connectionString);
  const env: Env = loadEnv();
  const fromUri: ClientConfig = parseIntoClientConfig(validated);
  const { connectionString: redundantUriField, ...parsedRest } = fromUri;
  void redundantUriField;
  const merged = withChannelBindingFromUri(validated, {
    ...parsedRest,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  });
  const config: ClientConfig = await resolveExternalClientConfig(merged, env);
  const client = new pg.Client(config);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
