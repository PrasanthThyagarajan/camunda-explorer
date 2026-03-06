import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import type { EnvironmentService } from "../services/environment.service.js";
import { MODIFICATION_REQUEST_TIMEOUT } from "../constants.js";

const HEAVY_PATH_PATTERNS = [
  "/modification",
  "/batch-retry",
  "/batch-modify",
  "/batch-resolve",
];

function isHeavyOperation(method: string, path: string): boolean {
  if (method !== "POST" && method !== "PUT") return false;
  return HEAVY_PATH_PATTERNS.some((p) => path.includes(p));
}

function isTimeoutError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err.code === "ECONNABORTED" || (err.message ?? "").includes("timeout");
}

export function createProxyRoutes(envService: EnvironmentService): Router {
  const router = Router();

  router.use(async (req: Request, res: Response, _next: NextFunction) => {
    const activeEnv = envService.getActive();
    if (!activeEnv) {
      return res.status(503).json({
        error: "No active environment configured. Go to Settings → Environments.",
      });
    }

    const camundaPath = req.originalUrl.replace(/^\/api/, "");
    const heavy = isHeavyOperation(req.method, camundaPath);
    const client = buildCamundaClient(activeEnv, heavy ? MODIFICATION_REQUEST_TIMEOUT : undefined);
    const hasBody = ["POST", "PUT", "PATCH"].includes(req.method);
    const reqData = hasBody ? req.body : undefined;

    if (hasBody) {
      console.log(`[PROXY] ${req.method} ${activeEnv.baseUrl}${camundaPath}${heavy ? " (extended timeout)" : ""}`);
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
      } else if (isTimeoutError(error)) {
        console.error(`[PROXY] Timeout: ${req.method} ${camundaPath} — engine did not respond in time`);
        res.status(504).json({
          error: "Request timed out",
          message: `The Camunda engine did not respond within the time limit. The operation may have completed on the server — check the instance state before retrying.`,
          camundaUrl: activeEnv.baseUrl,
        });
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
