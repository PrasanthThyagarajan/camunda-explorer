import { Router } from "express";
import type { EnvironmentService } from "../services/environment.service.js";
import { asyncHandler } from "../middleware/error-handler.js";

export function createEnvironmentRoutes(envService: EnvironmentService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(envService.getAll());
  });

  router.get("/active", (_req, res) => {
    const active = envService.getActiveInfo();
    if (!active) return res.status(404).json({ error: "No environments configured" });
    res.json(active);
  });

  router.post("/", (req, res) => {
    const { name, baseUrl } = req.body;
    if (!name || !baseUrl) {
      return res.status(400).json({ error: "name and baseUrl are required" });
    }
    const created = envService.create(req.body);
    res.status(201).json(created);
  });

  router.put("/:id", (req, res) => {
    const updated = envService.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Environment not found" });
    res.json(updated);
  });

  router.put("/:id/activate", (req, res) => {
    const result = envService.activate(req.params.id);
    if (!result) return res.status(404).json({ error: "Environment not found" });
    console.log(`[ENV] Switched to: ${result.name}`);
    res.json({ message: `Switched to ${result.name}`, id: result.id });
  });

  router.delete("/:id", (req, res) => {
    const deleted = envService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Environment not found" });
    res.json({ message: "Deleted" });
  });

  router.post(
    "/test",
    asyncHandler(async (req, res) => {
      const { baseUrl, username, password } = req.body;
      if (!baseUrl) return res.status(400).json({ error: "baseUrl is required" });
      const result = await envService.testConnection(baseUrl, username, password);
      res.json(result);
    })
  );

  return router;
}
