import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateSqlForNaturalLanguage } from "../services/sql-generation.service.js";
import { toErrorResponse } from "../utils/errors.js";

const bodySchema = z.object({
  query: z.string().min(1, "query is required").max(8000),
});

export async function postQueryController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.error.flatten().fieldErrors.query?.[0] ?? "Invalid body",
    });
  }

  req.log.info({ query: parsed.data.query }, "NL → SQL request received");

  try {
    const result = await generateSqlForNaturalLanguage(parsed.data.query);
    req.log.info(
      { sqlPreview: result.sql.slice(0, 200), explanationLen: result.explanation.length },
      "NL → SQL response ready",
    );
    return reply.send(result);
  } catch (err) {
    const mapped = toErrorResponse(err);
    req.log.error({ err, statusCode: mapped.statusCode }, "NL → SQL failed");
    return reply.status(mapped.statusCode).send(mapped.body);
  }
}
