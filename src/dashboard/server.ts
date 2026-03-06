import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

import { DEFAULT_DASHBOARD_PORT, JSON_BODY_LIMIT } from "../constants.js";
import { EnvironmentRepository } from "../repositories/environment.repository.js";
import { EnvironmentService } from "../services/environment.service.js";
import { IncidentService } from "../services/incident.service.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createEnvironmentRoutes } from "../routes/environment.routes.js";
import { createActionsRoutes } from "../routes/actions.routes.js";
import { createProxyRoutes } from "../routes/proxy.routes.js";
import { createConfigRoutes } from "../routes/config.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const envRepository = new EnvironmentRepository(projectRoot);
const envService = new EnvironmentService(envRepository);
const incidentService = new IncidentService();

const app = express();
app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

const publicDir = path.resolve(projectRoot, "public");
app.use(express.static(publicDir));

app.use("/environments", createEnvironmentRoutes(envService));
app.use("/actions", createActionsRoutes(envService, incidentService));
app.use("/config", createConfigRoutes(envService));
app.use("/api", createProxyRoutes(envService));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use(errorHandler);

const PORT = parseInt(process.env.DASHBOARD_PORT || String(DEFAULT_DASHBOARD_PORT), 10);
const active = envService.getActive();

app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         Camunda Explorer  v1.0.0                        ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Dashboard UI  : http://localhost:${PORT}                  ║`);
  console.log(`║  Environments  : ${envService.count()} configured${" ".repeat(26 - envService.count().toString().length)}║`);
  console.log(`║  Active        : ${(active?.name || "None").padEnd(39)}║`);
  console.log(`║  Engine URL    : ${(active?.baseUrl || "—").padEnd(39)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
});
