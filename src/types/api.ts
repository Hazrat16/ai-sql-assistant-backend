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
