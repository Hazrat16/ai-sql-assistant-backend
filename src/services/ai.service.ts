import OpenAI from "openai";
import { z } from "zod";
import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { buildNlToSqlSystemPrompt, buildNlToSqlUserPrompt } from "../prompts/nl-to-sql.prompt.js";
import type { NaturalQueryResponse } from "../types/api.js";

const env = loadEnv();

const nlJsonSchema = z.object({
  sql: z.string().min(1),
  explanation: z.string().min(1),
  message: z.string().optional(),
});

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fencedFull = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(trimmed);
  if (fencedFull?.[1]) return fencedFull[1].trim();
  const fencedAny = /```(?:json)?\s*([\s\S]*?)```/im.exec(trimmed);
  if (fencedAny?.[1]) return fencedAny[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function tryParseJsonContent(raw: string): { value: unknown } | undefined {
  const trimmed = raw.trim();
  try {
    return { value: JSON.parse(trimmed) as unknown };
  } catch {
    /* continue */
  }
  try {
    return { value: JSON.parse(extractJsonObject(trimmed)) as unknown };
  } catch {
    return undefined;
  }
}

/** Ollama often ignores \"JSON only\"; recover ```sql fences when JSON parsing fails. */
function tryParseFromSqlFence(raw: string): NaturalQueryResponse | null {
  const match = /```(?:sql|postgresql|postgres)?\s*([\s\S]*?)```/i.exec(raw);
  if (!match?.[1]) return null;
  let sql = match[1].trim();
  if (!sql) return null;
  if (!sql.endsWith(";")) sql = `${sql};`;
  return {
    sql,
    explanation:
      "Parsed SQL from a markdown code block in the model reply (expected strict JSON). Configure the model to emit raw JSON only for best results.",
    message: "Recovered from markdown SQL fence",
  };
}

function parseNaturalQueryResponseFromLlm(raw: string): NaturalQueryResponse {
  const boxed = tryParseJsonContent(raw);
  if (boxed !== undefined) {
    const parsed = nlJsonSchema.safeParse(boxed.value);
    if (parsed.success) return parsed.data;
  }

  const fromFence = tryParseFromSqlFence(raw);
  if (fromFence) return fromFence;

  throw new AppError(
    "OPENAI_ERROR",
    "LLM reply was not valid JSON with sql and explanation (see logs). Ollama models often need strict JSON-only output.",
    502,
    { expose: true },
  );
}

function resolveLlmAuth(): { apiKey: string; baseURL?: string } {
  const baseURL = env.OPENAI_BASE_URL;
  const apiKey = env.OPENAI_API_KEY ?? (baseURL ? "ollama" : undefined);
  if (!apiKey) {
    throw new AppError(
      "OPENAI_ERROR",
      "No LLM configured: set OPENAI_API_KEY for OpenAI, or OPENAI_BASE_URL for a free local Ollama server (see .env.example).",
      503,
    );
  }
  return { apiKey, baseURL };
}

export async function generateNlSqlResponse(input: {
  userQuery: string;
  schemaJson: string;
}): Promise<NaturalQueryResponse> {
  const { apiKey, baseURL } = resolveLlmAuth();

  const client = new OpenAI({
    apiKey,
    baseURL: baseURL ?? undefined,
  });

  const system = buildNlToSqlSystemPrompt();
  const user = buildNlToSqlUserPrompt(input.schemaJson, input.userQuery);

  const payload = {
    model: env.OPENAI_MODEL,
    temperature: 0.15,
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    ...(env.OPENAI_RESPONSE_FORMAT === "json_object"
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };

  let completion;
  try {
    completion = await client.chat.completions.create(payload);
  } catch (cause) {
    throw new AppError("OPENAI_ERROR", "Failed to call LLM provider", 502, { cause, expose: true });
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new AppError("OPENAI_ERROR", "LLM returned an empty response", 502);
  }

  return parseNaturalQueryResponseFromLlm(raw);
}
