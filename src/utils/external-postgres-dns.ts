import dns from "node:dns/promises";
import type { ConnectionOptions } from "tls";
import type { PgDriverConfig } from "../db/pg-channel-binding.js";

export type ExternalPostgresDnsFamilyMode = "auto" | "ipv4" | "ipv6" | "hostname";

function dnsFamilyToUse(host: string, mode: ExternalPostgresDnsFamilyMode): 0 | 4 | 6 {
  if (mode === "ipv4") return 4;
  if (mode === "ipv6") return 6;
  if (mode === "hostname") return 0;
  /* auto: Neon often resolves to IPv6 first; broken IPv6 routes yield ENETUNREACH / ETIMEDOUT. */
  if (/\.neon\.tech$/i.test(host)) return 4;
  return 0;
}

function mergeTlsServername(ssl: PgDriverConfig["ssl"], servername: string): ConnectionOptions | boolean | undefined {
  if (ssl === false || ssl === undefined) {
    return { servername };
  }
  if (ssl === true) {
    return { servername };
  }
  if (typeof ssl === "string") {
    return { servername };
  }
  return { ...ssl, servername };
}

/**
 * Resolve hostname to a concrete IP so Node connects via IPv4 (or IPv6) explicitly, and set TLS SNI
 * to the original hostname (required when connecting to Neon/AWS by IP).
 */
export async function applyExternalPostgresDnsResolution(
  config: PgDriverConfig,
  mode: ExternalPostgresDnsFamilyMode,
): Promise<PgDriverConfig> {
  const host = config.host;
  if (!host || host.startsWith("/")) {
    return config;
  }

  const family = dnsFamilyToUse(host, mode);
  if (family === 0) {
    return config;
  }

  try {
    const { address } = await dns.lookup(host, { family });
    const servername = host;
    const next: PgDriverConfig = {
      ...config,
      host: address,
      ssl: mergeTlsServername(config.ssl, servername),
    };
    delete next.connectionString;
    return next;
  } catch {
    return config;
  }
}
