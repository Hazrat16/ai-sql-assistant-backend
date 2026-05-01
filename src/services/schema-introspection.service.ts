import { loadEnv } from "../config/env.js";
import { pool } from "../db/pool.js";
import { AppError } from "../utils/errors.js";

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

export async function fetchPublicSchema(): Promise<SchemaPayload> {
  if (loadEnv().STUB_DATABASE) {
    return stubPublicSchema();
  }

  const client = await pool.connect();
  try {
    const res = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
    }>(
      `
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
      `,
    );

    const byTable = new Map<string, SchemaColumn[]>();
    for (const row of res.rows) {
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
  } catch (cause) {
    throw new AppError("DATABASE_ERROR", "Failed to read database schema", 502, { cause, expose: true });
  } finally {
    client.release();
  }
}
