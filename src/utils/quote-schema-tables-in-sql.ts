import type { SchemaPayload } from "../services/schema-introspection.service.js";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pgQuoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * LLMs often emit `FROM Drop` instead of `FROM "Drop"`. Unquoted `Drop`/`Order`/… are keywords and break the parser.
 * Quote bare occurrences of known public table names (case-insensitive match, schema-correct case in output).
 */
export function quoteBareSchemaTableNames(sql: string, schema: SchemaPayload): string {
  const names = [...new Set(schema.tables.map((t) => t.name).filter((n) => n.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let out = sql;
  for (const name of names) {
    const n = escapeRe(name);
    const quoted = pgQuoteIdent(name);
    const fromJoinComma: [string, string][] = [
      [`(\\bFROM\\s+)${n}\\b`, `$1${quoted}`],
      [`(\\bJOIN\\s+)${n}\\b`, `$1${quoted}`],
      [`(,\\s*)${n}\\b`, `$1${quoted}`],
    ];
    for (const [pattern, replacement] of fromJoinComma) {
      out = out.replace(new RegExp(pattern, "gi"), replacement);
    }
  }
  /* tablename.col — unquoted `Drop.totalUnits` parses as keyword DROP; skip if already `"Drop".` */
  for (const name of names) {
    const n = escapeRe(name);
    const quotedPrefix = `${pgQuoteIdent(name)}.`;
    out = out.replace(new RegExp(`(?<!")\\b${n}\\.`, "gi"), quotedPrefix);
  }
  return out;
}
