import pkg, { type AST } from "node-sql-parser";
import { AppError } from "../utils/errors.js";
import { applyPgQualifiedAliasRewriteToAst } from "./pg-qualified-alias-rewrite.service.js";

const { Parser } = pkg;

type ParserInstance = InstanceType<typeof Parser>;

type AstNode = Record<string, unknown>;

function isObject(v: unknown): v is AstNode {
  return typeof v === "object" && v !== null;
}

function getAstFromParseResult(parsed: unknown): AstNode | AstNode[] {
  if (!isObject(parsed) || !("ast" in parsed)) {
    throw new AppError("INVALID_SQL", "Unable to analyze SQL statement", 400);
  }
  const ast = (parsed as { ast: unknown }).ast;
  if (Array.isArray(ast)) return ast as unknown as AstNode[];
  if (!isObject(ast)) {
    throw new AppError("INVALID_SQL", "Unable to analyze SQL statement", 400);
  }
  return ast;
}

const FORBIDDEN_TOP_LEVEL = new Set([
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "truncate",
  "rename",
  "use",
  "grant",
  "revoke",
  "exec",
  "call",
  "lock",
  "unlock",
  "show",
  "desc",
]);

function assertNoDangerousInto(selectAst: AstNode) {
  const into = selectAst.into;
  if (into && isObject(into)) {
    const position = into.position;
    const expr = into.expr;
    if (position != null || expr != null) {
      throw new AppError(
        "FORBIDDEN_SQL",
        "SELECT … INTO and similar mutating forms are not allowed",
        403,
      );
    }
  }
}

function walkSelectChain(selectAst: AstNode) {
  assertNoDangerousInto(selectAst);

  const withList = selectAst.with;
  if (Array.isArray(withList)) {
    for (const w of withList) {
      if (!isObject(w)) continue;
      const stmt = w.stmt;
      if (isObject(stmt)) {
        validateAstNode(stmt);
      }
    }
  }

  let current: AstNode | null = selectAst;
  while (current) {
    if (current.type !== "select") {
      throw new AppError("FORBIDDEN_SQL", "Only SELECT queries are permitted", 403);
    }
    assertNoDangerousInto(current);
    const nextUnknown: unknown = current._next;
    current = isObject(nextUnknown) ? nextUnknown : null;
  }
}

function validateAstNode(node: AstNode) {
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";

  if (type === "select") {
    walkSelectChain(node);
    return;
  }

  if (FORBIDDEN_TOP_LEVEL.has(type)) {
    throw new AppError("FORBIDDEN_SQL", `Statement type "${type.toUpperCase()}" is not allowed`, 403);
  }

  throw new AppError("FORBIDDEN_SQL", `Statement type "${type || "unknown"}" is not allowed`, 403);
}

const LEADING_LITERAL_BLOCKLIST = [
  /^\s*copy\s+/i,
  /^\s*vacuum\s+/i,
  /^\s*analyze\s+/i,
  /^\s*reindex\s+/i,
  /^\s*cluster\s+/i,
  /^\s*listen\s+/i,
  /^\s*notify\s+/i,
  /^\s*truncate\s+/i,
];

export function normalizeSqlInput(sql: string): string {
  return sql.split("\u0000").join("").trim();
}

export function assertBasicSqlSafety(sql: string) {
  for (const re of LEADING_LITERAL_BLOCKLIST) {
    if (re.test(sql)) {
      throw new AppError("FORBIDDEN_SQL", "This SQL command is not permitted", 403);
    }
  }
}

/**
 * Ensures a single read-only SELECT (including UNION / WITH) suitable for execution.
 */
export function assertExecutableSelect(sql: string) {
  const trimmed = normalizeSqlInput(sql);
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", "SQL query is required", 400);
  }

  assertBasicSqlSafety(trimmed);

  const parser = new Parser();
  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed, { database: "postgresql" });
  } catch (cause) {
    throw new AppError("INVALID_SQL", "Could not parse SQL", 400, { cause, expose: true });
  }

  const astRoot = getAstFromParseResult(parsed);
  if (Array.isArray(astRoot)) {
    if (astRoot.length !== 1) {
      throw new AppError("FORBIDDEN_SQL", "Only a single SQL statement is allowed", 403);
    }
    const only = astRoot[0];
    if (!only) {
      throw new AppError("INVALID_SQL", "Unable to analyze SQL statement", 400);
    }
    validateAstNode(only);
    return finalizeExecutableSql(parser, only, trimmed);
  }

  validateAstNode(astRoot);
  return finalizeExecutableSql(parser, astRoot, trimmed);
}

/** Canonicalize Postgres alias mistakes (tablename.col → alias.col), then re-parse and re-validate. */
function finalizeExecutableSql(parser: ParserInstance, ast: AstNode, trimmedFallback: string): string {
  const changed = applyPgQualifiedAliasRewriteToAst(ast);
  if (!changed) return trimmedFallback;

  let fixed: string;
  try {
    const out = parser.sqlify(ast as unknown as AST, { database: "postgresql" });
    fixed = typeof out === "string" ? out : trimmedFallback;
  } catch (cause) {
    throw new AppError("INVALID_SQL", "Could not serialize SQL after alias rewrite", 400, { cause, expose: true });
  }

  let reparsed: unknown;
  try {
    reparsed = parser.parse(fixed, { database: "postgresql" });
  } catch (cause) {
    throw new AppError("INVALID_SQL", "Rewritten SQL failed to parse", 400, { cause, expose: true });
  }

  const again = getAstFromParseResult(reparsed);
  const single = Array.isArray(again) ? (again.length === 1 ? again[0] : undefined) : again;
  if (!single || Array.isArray(single)) {
    throw new AppError("INVALID_SQL", "Unexpected AST shape after rewrite", 400);
  }
  validateAstNode(single);
  return normalizeSqlInput(fixed);
}

export interface CompileSqlResult {
  valid: true;
  normalizedSql: string;
  statementType: "SELECT";
  readOnly: true;
}

/** Parse + validate user SQL without executing it. */
export function compileUserSql(sql: string): CompileSqlResult {
  const normalizedSql = assertExecutableSelect(sql);
  return {
    valid: true,
    normalizedSql,
    statementType: "SELECT",
    readOnly: true,
  };
}
