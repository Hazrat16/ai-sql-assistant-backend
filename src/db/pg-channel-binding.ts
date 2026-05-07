import type { PoolConfig } from "pg";

/** PoolConfig extends ClientConfig; use this for Pool and Client so extra pool keys type-check. */
export type PgDriverConfig = PoolConfig & { enableChannelBinding?: boolean };

/**
 * libpq `channel_binding=require|prefer` in the URI is not applied automatically by node-postgres.
 * Neon expects SCRAM channel binding; we also enable it for `*.neon.tech` when the query param was dropped.
 */
export function withChannelBindingFromUri(connectionString: string, config: PgDriverConfig): PgDriverConfig {
  const needs =
    /[?&]channel_binding=(require|prefer)\b/i.test(connectionString) || /\.neon\.tech\b/i.test(connectionString);
  if (!needs) {
    return config;
  }
  return { ...config, enableChannelBinding: true };
}
