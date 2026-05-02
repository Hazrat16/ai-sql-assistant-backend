import type { FastifyInstance } from "fastify";
import { loadEnv } from "../config/env.js";
import { postQueryController } from "../controllers/query.controller.js";
import { postExecuteController } from "../controllers/execute.controller.js";
import { postCompileController } from "../controllers/compile.controller.js";
import { getSchemaController, postSchemaConnectController } from "../controllers/schema.controller.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const e = loadEnv();
    return {
      status: "ok",
      database: e.STUB_DATABASE ? "stub" : "postgres",
    };
  });

  app.post("/query", postQueryController);
  app.post("/compile", postCompileController);
  app.post("/execute", postExecuteController);
  app.get("/schema", getSchemaController);
  app.post("/schema/connect", postSchemaConnectController);
}
