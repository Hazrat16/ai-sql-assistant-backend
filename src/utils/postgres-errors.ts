import { AppError } from "./errors.js";

function formatNodeConnectivityHint(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as NodeJS.ErrnoException & { reason?: string };
  const code = e.code;
  if (code === "ETIMEDOUT") {
    return "Connection timed out (ETIMEDOUT). Check host/port, firewall, VPN, and that PostgreSQL accepts TCP from this machine.";
  }
  if (code === "ECONNREFUSED") {
    return "Connection refused (ECONNREFUSED). Nothing is listening on that address, or PostgreSQL is not running.";
  }
  if (code === "ENOTFOUND") {
    return "Host not found (ENOTFOUND). Check the hostname in the connection string.";
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "Network unreachable. Check routing and VPN.";
  }
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return `TLS certificate verification failed (${code}). For managed Postgres (e.g. Neon), use sslmode=require in the URI; avoid corporate SSL interception or set a custom CA if required.`;
  }
  if (typeof e.reason === "string" && /certificate|TLS|SSL/i.test(e.reason)) {
    return `TLS error: ${e.reason}`;
  }
  return "";
}

function walkErrorTree(err: unknown, out: unknown[], seen: WeakSet<object>): void {
  if (err === null || err === undefined) return;
  if (typeof err !== "object") {
    out.push(err);
    return;
  }
  if (seen.has(err as object)) return;
  seen.add(err as object);
  out.push(err);
  if (err instanceof AggregateError && Array.isArray(err.errors)) {
    for (const sub of err.errors) {
      walkErrorTree(sub, out, seen);
    }
  }
  if (err instanceof Error && "cause" in err && (err as Error & { cause?: unknown }).cause !== undefined) {
    walkErrorTree((err as Error & { cause?: unknown }).cause, out, seen);
  }
}

function allErrorParts(cause: unknown): unknown[] {
  const out: unknown[] = [];
  walkErrorTree(cause, out, new WeakSet());
  return out;
}

/** pg-pool often throws AggregateError with an empty .message; pull errno hints from nested errors. */
function formatPostgresConnectivityDetail(cause: unknown): string {
  const hints = new Set<string>();
  for (const part of allErrorParts(cause)) {
    const h = formatNodeConnectivityHint(part);
    if (h) hints.add(h);
  }
  return [...hints].join(" ");
}

/** Postgres SQLSTATE / driver hints (subset useful for connect/schema). */
function formatPgProtocolDetailSingle(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const c = cause as { code?: unknown; message?: unknown };
  if (typeof c.code !== "string") return "";
  const msg = typeof c.message === "string" ? c.message.trim() : "";
  switch (c.code) {
    case "28P01":
      return "Authentication failed (invalid password or role).";
    case "3D000":
      return "Database does not exist.";
    case "28000":
      return msg || "Authorization failed.";
    default:
      if (/^[0-9A-Z]{5}$/.test(c.code) && msg) {
        return msg;
      }
      return "";
  }
}

function formatPgProtocolDetail(cause: unknown): string {
  for (const part of allErrorParts(cause)) {
    const p = formatPgProtocolDetailSingle(part);
    if (p) return p;
  }
  return "";
}

function firstNonEmptyMessage(cause: unknown): string {
  for (const part of allErrorParts(cause)) {
    if (part instanceof Error) {
      const m = part.message.trim();
      if (m && !/^aggregateerror$/i.test(m)) {
        return m;
      }
    }
  }
  return "";
}

/**
 * Map connect/query failures from `pg` into a client-facing DATABASE_ERROR (502).
 * Use for /execute, /schema/connect, and other DB paths.
 */
export function wrapPostgresDatabaseError(cause: unknown, defaultLabel: string): AppError {
  if (cause instanceof AppError) return cause;
  const connectivity = formatPostgresConnectivityDetail(cause);
  const protocol = formatPgProtocolDetail(cause);
  const msg = firstNonEmptyMessage(cause) || (cause instanceof Error ? cause.message.trim() : String(cause).trim());
  const detail =
    connectivity ||
    protocol ||
    (msg && !/^aggregateerror$/i.test(msg) ? msg : "") ||
    "No additional details (see server logs).";
  return new AppError("DATABASE_ERROR", `${defaultLabel}: ${detail}`, 502, { cause, expose: true });
}
