import fs from "fs";
import path from "path";
import type { ICamundaEnvironment, IEnvironmentRepository } from "../interfaces/environment.js";
import { DEFAULT_BASE_URL, DEFAULT_ENV_COLOR, ENV_FILE_NAME } from "../constants.js";

export class EnvironmentRepository implements IEnvironmentRepository {
  private environments: ICamundaEnvironment[];
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.resolve(baseDir, ENV_FILE_NAME);
    this.environments = this.load();
  }

  findAll(): ICamundaEnvironment[] {
    return [...this.environments];
  }

  findById(id: string): ICamundaEnvironment | undefined {
    return this.environments.find((e) => e.id === id);
  }

  findActive(): ICamundaEnvironment | undefined {
    return this.environments.find((e) => e.isActive) || this.environments[0];
  }

  save(env: ICamundaEnvironment): void {
    const idx = this.environments.findIndex((e) => e.id === env.id);
    if (idx >= 0) {
      this.environments[idx] = env;
    } else {
      this.environments.push(env);
    }
    this.persist();
  }

  saveAll(envs: ICamundaEnvironment[]): void {
    this.environments = envs;
    this.persist();
  }

  delete(id: string): boolean {
    const idx = this.environments.findIndex((e) => e.id === id);
    if (idx === -1) return false;

    const wasActive = this.environments[idx].isActive;
    this.environments.splice(idx, 1);

    if (wasActive && this.environments.length > 0) {
      this.environments[0].isActive = true;
    }

    this.persist();
    return true;
  }

  activate(id: string): ICamundaEnvironment | undefined {
    const target = this.environments.find((e) => e.id === id);
    if (!target) return undefined;

    this.environments.forEach((e) => (e.isActive = e.id === id));
    this.persist();
    return target;
  }

  count(): number {
    return this.environments.length;
  }

  reload(): void {
    this.environments = this.load();
  }

  private load(): ICamundaEnvironment[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        return Array.isArray(data) ? data : [];
      }
    } catch {
      // fall through to bootstrap defaults
    }

    const defaultEnv: ICamundaEnvironment = {
      id: "default",
      name: process.env.CAMUNDA_ENV_NAME || "Default",
      baseUrl: process.env.CAMUNDA_BASE_URL || DEFAULT_BASE_URL,
      username: process.env.CAMUNDA_USERNAME || "",
      password: process.env.CAMUNDA_PASSWORD || "",
      color: DEFAULT_ENV_COLOR,
      isActive: true,
    };
    this.environments = [defaultEnv];
    this.persist();
    return this.environments;
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.environments, null, 2), "utf-8");
  }
}
