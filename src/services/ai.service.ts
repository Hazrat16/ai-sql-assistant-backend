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
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
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

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    try {
      parsedJson = JSON.parse(extractJsonObject(raw));
    } catch (cause) {
      throw new AppError("OPENAI_ERROR", "LLM returned invalid JSON", 502, { cause });
    }
  }

  const parsed = nlJsonSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AppError("OPENAI_ERROR", "LLM JSON did not match the expected contract", 502);
  }

  return parsed.data;
}
