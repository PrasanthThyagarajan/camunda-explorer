/**
 * Config Routes — Presentation layer.
 *
 * Exposes read-only configuration information to the frontend.
 * SRP: Sole responsibility is configuration queries.
 */

import { Router } from "express";
import type { EnvironmentService } from "../services/environment.service.js";

export function createConfigRoutes(envService: EnvironmentService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const active = envService.getActive();
    res.json({
      camundaBaseUrl: active?.baseUrl || "",
      hasAuth: !!active?.username,
      envName: active?.name || "None",
      envColor: active?.color || "#64748b",
    });
  });

  return router;
}
