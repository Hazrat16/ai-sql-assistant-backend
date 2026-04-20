import type { FastifyReply, FastifyRequest } from "fastify";
import { fetchPublicSchema } from "../services/schema-introspection.service.js";
import { toErrorResponse } from "../utils/errors.js";

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
