import type { FastifyInstance } from "fastify";
import { postQueryController } from "../controllers/query.controller.js";
import { postExecuteController } from "../controllers/execute.controller.js";
import { postCompileController } from "../controllers/compile.controller.js";
import { getSchemaController } from "../controllers/schema.controller.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/query", postQueryController);
  app.post("/compile", postCompileController);
  app.post("/execute", postExecuteController);
  app.get("/schema", getSchemaController);
}
