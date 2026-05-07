import { extractPostgresConnectionString } from "./postgres-connection-string.js";

/** Safe for logs — strips password from postgres URLs (WHATWG URL often fails on libpq strings). */
export function redactDatabaseUrl(url: string): string {
  const normalized = extractPostgresConnectionString(url);
  try {
    const u = new URL(normalized);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    const redacted = normalized.replace(
      /^(postgres(?:ql)?:\/\/)([^/?#]+):([^@]+)@/i,
      (_, proto: string, user: string) => `${proto}${user}:***@`,
    );
    if (redacted !== normalized) {
      return redacted;
    }
    return "[unparsable-database-url]";
  }
}
