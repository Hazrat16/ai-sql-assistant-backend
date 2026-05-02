import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { loadEnv } from "../config/env.js";
import { assertExecutableSelect } from "./query-validation.service.js";
import { AppError } from "../utils/errors.js";
import type { SqlRow } from "../types/api.js";
import { assertExternalDatabaseAllowed, withEphemeralPgConnection } from "./external-connection.service.js";

async function executeReadOnlyWithClient(
  client: PoolClient,
  safeSql: string,
  timeoutMs: number,
): Promise<SqlRow[]> {
  await client.query("BEGIN");
  await client.query("SELECT set_config('statement_timeout', $1, true)", [`${Math.max(1, timeoutMs)}ms`]);
  await client.query("SET TRANSACTION READ ONLY");
  const result = await client.query<SqlRow>(safeSql);
  await client.query("COMMIT");
  return result.rows;
}

export type ExecuteSqlOptions = {
  databaseUrl?: string;
};

export async function executeReadOnlySelect(sql: string, options?: ExecuteSqlOptions): Promise<SqlRow[]> {
  const env = loadEnv();
  const safeSql = assertExecutableSelect(sql);
  const timeoutMs = Math.max(1, Number(env.DB_STATEMENT_TIMEOUT_MS));
  const dbUrl = options?.databaseUrl?.trim();

  if (dbUrl) {
    assertExternalDatabaseAllowed();
    try {
      return await withEphemeralPgConnection(dbUrl, async (client) => {
        try {
          return await executeReadOnlyWithClient(client, safeSql, timeoutMs);
        } catch (cause) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
          if (cause instanceof AppError) throw cause;
          throw new AppError("DATABASE_ERROR", "Failed to execute SQL on external database", 502, {
            cause,
            expose: true,
          });
        }
      });
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError("DATABASE_ERROR", "Failed to execute SQL on external database", 502, {
        cause,
        expose: true,
      });
    }
  }

  if (env.STUB_DATABASE) {
    return [
      {
        _stub: true,
        _hint: "STUB_DATABASE is enabled — start Postgres and run without this flag to execute against a real database.",
        _sql_preview: safeSql.slice(0, 200),
      },
    ];
  }

  const client = await pool.connect();
  try {
    return await executeReadOnlyWithClient(client, safeSql, timeoutMs);
  } catch (cause) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    if (cause instanceof AppError) throw cause;
    throw new AppError("DATABASE_ERROR", "Failed to execute SQL", 502, { cause, expose: true });
  } finally {
    client.release();
  }
}
