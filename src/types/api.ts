export type SqlRow = Record<string, unknown>;

export interface NaturalQueryRequest {
  query: string;
}

export interface NaturalQueryResponse {
  sql: string;
  explanation: string;
  message?: string;
}

export interface ExecuteQueryRequest {
  sql: string;
}

export interface ExecuteQueryResponse {
  rows: SqlRow[];
}

export interface CompileQueryRequest {
  sql: string;
}

export interface CompileQueryResponse {
  valid: true;
  normalizedSql: string;
  statementType: "SELECT";
  readOnly: true;
}
