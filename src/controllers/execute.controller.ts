import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { executeReadOnlySelect } from "../services/execute-query.service.js";
import { toErrorResponse } from "../utils/errors.js";

const bodySchema = z.object({
  sql: z.string().min(1, "sql is required").max(200_000),
});

export async function postExecuteController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.error.flatten().fieldErrors.sql?.[0] ?? "Invalid body",
    });
  }

  req.log.info({ sqlPreview: parsed.data.sql.slice(0, 200) }, "Execute SQL request received");

  try {
    const rows = await executeReadOnlySelect(parsed.data.sql);
    req.log.info({ rowCount: rows.length }, "Execute SQL completed");
    return reply.send({ rows });
  } catch (err) {
    const mapped = toErrorResponse(err);
    req.log.error({ err, statusCode: mapped.statusCode }, "Execute SQL failed");
    return reply.status(mapped.statusCode).send(mapped.body);
  }
}
