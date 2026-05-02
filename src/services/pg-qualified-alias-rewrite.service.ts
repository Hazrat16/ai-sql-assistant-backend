import pkg, { type AST } from "node-sql-parser";

const { Parser } = pkg;

type AstNode = Record<string, unknown>;

function isObj(v: unknown): v is AstNode {
  return typeof v === "object" && v !== null;
}

function getAstRoot(parsed: unknown): AstNode | null {
  if (!isObj(parsed) || !("ast" in parsed)) return null;
  const ast = (parsed as { ast: unknown }).ast;
  if (Array.isArray(ast)) {
    const only = ast[0];
    return isObj(only) ? only : null;
  }
  return isObj(ast) ? ast : null;
}

/** Same-table duplicate aliases (self-join): drop table so we never guess wrong alias */
function addTableAlias(scope: Map<string, string>, table: string, alias: string): Map<string, string> {
  const next = new Map(scope);
  const prev = next.get(table);
  if (prev !== undefined && prev !== alias) next.delete(table);
  else next.set(table, alias);
  return next;
}

function rewriteExpr(node: unknown, scope: Map<string, string>, changed: { flag: boolean }): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) rewriteExpr(item, scope, changed);
    return;
  }
  if (!isObj(node)) return;

  const n = node as AstNode;

  if (n.type === "column_ref") {
    if (typeof n.table === "string") {
      const alias = scope.get(n.table);
      if (alias && alias !== n.table) {
        n.table = alias;
        changed.flag = true;
      }
    }
    rewriteExpr(n.column, scope, changed);
    return;
  }

  if (n.type === "select") {
    rewriteSelectAst(n, scope, changed);
    return;
  }

  for (const key of Object.keys(n)) {
    if (key === "_next") continue;
    rewriteExpr(n[key], scope, changed);
  }
}

/**
 * PostgreSQL rejects tablename.col after FROM tablename alias — column_ref.table must use only alias.
 * Walk each SELECT scope (respecting JOIN order for ON clauses) and rewrite offenders.
 */
function rewriteSelectAst(sel: AstNode, outerScope: Map<string, string>, changed: { flag: boolean }): void {
  if (!isObj(sel) || sel.type !== "select") return;

  if (Array.isArray(sel.with)) {
    for (const w of sel.with) {
      if (isObj(w) && isObj(w.stmt) && w.stmt.type === "select") {
        rewriteSelectAst(w.stmt as AstNode, outerScope, changed);
      }
    }
  }

  let scope = new Map(outerScope);

  if (Array.isArray(sel.from)) {
    for (const raw of sel.from) {
      if (!isObj(raw)) continue;
      const entry = raw as AstNode;

      const nested = entry.expr;
      if (isObj(nested) && nested.type === "select") {
        rewriteSelectAst(nested as AstNode, scope, changed);
      }

      if (entry.on) rewriteExpr(entry.on, scope, changed);

      if (typeof entry.table === "string" && typeof entry.as === "string" && entry.as.length > 0) {
        scope = addTableAlias(scope, entry.table, entry.as);
      }
    }
  }

  rewriteExpr(sel.where, scope, changed);
  rewriteExpr(sel.having, scope, changed);
  rewriteExpr(sel.groupby, scope, changed);
  rewriteExpr(sel.orderby, scope, changed);
  rewriteExpr(sel.limit, scope, changed);

  if (Array.isArray(sel.columns)) {
    for (const col of sel.columns) rewriteExpr(col, scope, changed);
  }

  const unionNext = sel._next;
  const setOp = sel.set_op;
  if (isObj(unionNext) && typeof setOp === "string") {
    rewriteSelectAst(unionNext as AstNode, outerScope, changed);
  }
}

/**
 * Mutates AST in place: column_ref.table "big_customers" → alias "c" when FROM uses big_customers AS c.
 * Returns whether any column_ref was rewritten.
 */
export function applyPgQualifiedAliasRewriteToAst(astRoot: Record<string, unknown>): boolean {
  const state = { flag: false };
  rewriteSelectAst(astRoot as AstNode, new Map(), state);
  return state.flag;
}

/** Test helper: parse → rewrite AST → sqlify */
export function rewritePgQualifiedAliases(sql: string): { sql: string; changed: boolean } {
  const parser = new Parser();
  let parsed: unknown;
  try {
    parsed = parser.parse(sql, { database: "postgresql" });
  } catch {
    return { sql, changed: false };
  }
  const astRoot = getAstRoot(parsed);
  if (!astRoot) return { sql, changed: false };
  const changed = applyPgQualifiedAliasRewriteToAst(astRoot);
  if (!changed) return { sql, changed: false };
  try {
    const out = parser.sqlify(astRoot as unknown as AST, { database: "postgresql" });
    return { sql: typeof out === "string" ? out : sql, changed: true };
  } catch {
    return { sql, changed: false };
  }
}
