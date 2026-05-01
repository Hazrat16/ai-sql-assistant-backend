import { pool } from "../db/pool.js";
import { loadEnv } from "../config/env.js";
import { assertExecutableSelect } from "./query-validation.service.js";
import { AppError } from "../utils/errors.js";
import type { SqlRow } from "../types/api.js";

export async function executeReadOnlySelect(sql: string): Promise<SqlRow[]> {
  const env = loadEnv();
  const safeSql = assertExecutableSelect(sql);
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
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${Math.max(1, Number(env.DB_STATEMENT_TIMEOUT_MS))}ms`,
    ]);
    await client.query("SET TRANSACTION READ ONLY");
    const result = await client.query<SqlRow>(safeSql);
    await client.query("COMMIT");
    return result.rows;
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
