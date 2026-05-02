import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fetchPublicSchema } from "../services/schema-introspection.service.js";
import { toErrorResponse } from "../utils/errors.js";
import { redactDatabaseUrl } from "../utils/redact-db-url.js";

const connectBodySchema = z.object({
  databaseUrl: z.string().min(1, "databaseUrl is required").max(8192),
});

export async function getSchemaController(req: FastifyRequest, reply: FastifyReply) {
  req.log.info("Schema request received");
  try {
    const schema = await fetchPublicSchema();
    req.log.info({ tableCount: schema.tables.length }, "Schema response ready");
    return reply.send(schema);
  } catch (err) {
    const mapped = toErrorResponse(err);
    req.log.error({ err, statusCode: mapped.statusCode }, "Schema request failed");
    return reply.status(mapped.statusCode).send(mapped.body);
  }
}

export async function postSchemaConnectController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = connectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.error.flatten().fieldErrors.databaseUrl?.[0] ?? "Invalid body",
    });
  }

  req.log.info({ target: redactDatabaseUrl(parsed.data.databaseUrl) }, "Schema connect request");
  try {
    const schema = await fetchPublicSchema({ databaseUrl: parsed.data.databaseUrl });
    req.log.info({ tableCount: schema.tables.length }, "Schema connect ready");
    return reply.send(schema);
  } catch (err) {
    const mapped = toErrorResponse(err);
    req.log.error({ err, statusCode: mapped.statusCode }, "Schema connect failed");
    return reply.status(mapped.statusCode).send(mapped.body);
  }
}
