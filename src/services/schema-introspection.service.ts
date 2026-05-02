import type { PoolClient } from "pg";
import { loadEnv } from "../config/env.js";
import { pool } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { assertExternalDatabaseAllowed, withEphemeralPgConnection } from "./external-connection.service.js";

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaPayload {
  tables: SchemaTable[];
}

const INTROSPECTION_SQL = `
  SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable
  FROM information_schema.columns AS c
  JOIN information_schema.tables AS t
    ON t.table_schema = c.table_schema
   AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position;
`;

function rowsToPayload(
  rows: { table_name: string; column_name: string; data_type: string; is_nullable: "YES" | "NO" }[],
): SchemaPayload {
  const byTable = new Map<string, SchemaColumn[]>();
  for (const row of rows) {
    const cols = byTable.get(row.table_name) ?? [];
    cols.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
    });
    byTable.set(row.table_name, cols);
  }

  const tables: SchemaTable[] = [...byTable.entries()].map(([name, columns]) => ({
    name,
    columns,
  }));

  return { tables };
}

async function introspectWithClient(client: PoolClient): Promise<SchemaPayload> {
  const res = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
  }>(INTROSPECTION_SQL);
  return rowsToPayload(res.rows);
}

function stubPublicSchema(): SchemaPayload {
  return {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "integer", nullable: false },
          { name: "full_name", type: "text", nullable: true },
          { name: "email", type: "text", nullable: true },
          { name: "status", type: "text", nullable: true },
          { name: "created_at", type: "timestamptz", nullable: true },
          { name: "updated_at", type: "timestamptz", nullable: true },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "id", type: "integer", nullable: false },
          { name: "user_id", type: "integer", nullable: false },
          { name: "total_cents", type: "bigint", nullable: false },
          { name: "created_at", type: "timestamptz", nullable: true },
        ],
      },
    ],
  };
}

export type FetchSchemaOptions = {
  /** When set, introspect this database instead of the app pool (stub mode ignored). */
  databaseUrl?: string;
};

export async function fetchPublicSchema(options?: FetchSchemaOptions): Promise<SchemaPayload> {
  const url = options?.databaseUrl?.trim();

  if (url) {
    assertExternalDatabaseAllowed();
    try {
      return await withEphemeralPgConnection(url, (client) => introspectWithClient(client));
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError("DATABASE_ERROR", "Failed to read external database schema", 502, {
        cause,
        expose: true,
      });
    }
  }

  const env = loadEnv();
  if (env.STUB_DATABASE) {
    return stubPublicSchema();
  }

  const client = await pool.connect();
  try {
    return await introspectWithClient(client);
  } catch (cause) {
    throw new AppError("DATABASE_ERROR", "Failed to read database schema", 502, { cause, expose: true });
  } finally {
    client.release();
  }
}
