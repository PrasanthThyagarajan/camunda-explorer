/**
 * API Proxy Routes — Presentation layer.
 *
 * Forwards /api/* requests to the active Camunda REST API.
 * SRP: Sole responsibility is proxying HTTP requests.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import type { EnvironmentService } from "../services/environment.service.js";

export function createProxyRoutes(envService: EnvironmentService): Router {
  const router = Router();

  router.use(async (req: Request, res: Response, _next: NextFunction) => {
    const activeEnv = envService.getActive();
    if (!activeEnv) {
      return res.status(503).json({
        error: "No active environment configured. Go to Settings → Environments.",
      });
    }

    const client = buildCamundaClient(activeEnv);
    const camundaPath = req.originalUrl.replace(/^\/api/, "");
    const hasBody = ["POST", "PUT", "PATCH"].includes(req.method);
    const reqData = hasBody ? req.body : undefined;

    if (hasBody) {
      console.log(`[PROXY] ${req.method} ${activeEnv.baseUrl}${camundaPath}`);
      console.log(`[PROXY] Body: ${JSON.stringify(reqData, null, 2)}`);
    }

    try {
      const response = await client({
        method: req.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        url: camundaPath,
        data: reqData,
        headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        responseType: camundaPath.includes("/stacktrace") ? "text" : "json",
      });
      res.status(response.status).send(response.data);
    } catch (error: unknown) {
      const err = error as {
        response?: { status: number; data: unknown };
        message: string;
      };
      if (err.response) {
        console.error(`[PROXY] Error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
        res.status(err.response.status).json(err.response.data);
      } else {
        console.error(`[PROXY] Connection error: ${err.message}`);
        res.status(502).json({
          error: "Cannot connect to Camunda engine",
          message: err.message,
          camundaUrl: activeEnv.baseUrl,
        });
      }
    }
  });

  return router;
}
