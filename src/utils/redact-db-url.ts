/** Safe for logs — strips password from postgres URLs when parsable. */
export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[unparsable-database-url]";
  }
}
