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

export async function generateNlSqlResponse(input: {
  userQuery: string;
  schemaJson: string;
}): Promise<NaturalQueryResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_ERROR", "OPENAI_API_KEY is not configured", 503);
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const system = buildNlToSqlSystemPrompt();
  const user = buildNlToSqlUserPrompt(input.schemaJson, input.userQuery);

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
  } catch (cause) {
    throw new AppError("OPENAI_ERROR", "Failed to call OpenAI", 502, { cause, expose: true });
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new AppError("OPENAI_ERROR", "OpenAI returned an empty response", 502);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    throw new AppError("OPENAI_ERROR", "OpenAI returned invalid JSON", 502, { cause });
  }

  const parsed = nlJsonSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AppError("OPENAI_ERROR", "OpenAI JSON did not match the expected contract", 502);
  }

  return parsed.data;
}
