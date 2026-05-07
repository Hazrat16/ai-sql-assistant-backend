/**
 * Users often paste labels, newlines, or quotes around Neon URLs. WHATWG `URL` also rejects many
 * valid libpq strings (e.g. certain password characters), so we only use this for extraction.
 */
export function extractPostgresConnectionString(raw: string): string {
  let s = raw.replace(/^\uFEFF/, "").trim();
  if (!s) return s;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  const lower = s.toLowerCase();
  const idxPql = lower.indexOf("postgresql://");
  const idxPg = lower.indexOf("postgres://");
  let from = 0;
  if (idxPql !== -1 && (idxPg === -1 || idxPql <= idxPg)) {
    from = idxPql;
  } else if (idxPg !== -1) {
    from = idxPg;
  }
  s = (from > 0 ? s.slice(from) : s).trim();
  const token = s.match(/^(postgres(?:ql)?:\/\/\S+)/i);
  if (token) {
    return token[1];
  }
  return s;
}
