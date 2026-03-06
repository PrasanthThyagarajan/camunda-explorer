import type {
  ICamundaEnvironment,
  ICamundaEnvironmentSafe,
  ICreateEnvironmentDto,
  IUpdateEnvironmentDto,
  ITestConnectionResult,
} from "../interfaces/environment.js";
import type { EnvironmentRepository } from "../repositories/environment.repository.js";
import { buildTestClient } from "./camunda-client.factory.js";
import { DEFAULT_ENV_COLOR, PASSWORD_MASK } from "../constants.js";

export class EnvironmentService {
  constructor(private readonly repo: EnvironmentRepository) {}

  getAll(): ICamundaEnvironmentSafe[] {
    return this.repo.findAll().map((e) => this.toSafe(e));
  }

  getActive(): ICamundaEnvironment | undefined {
    return this.repo.findActive();
  }

  getActiveInfo(): {
    id: string;
    name: string;
    baseUrl: string;
    username: string;
    color: string;
    hasPassword: boolean;
  } | null {
    const active = this.repo.findActive();
    if (!active) return null;
    return {
      id: active.id,
      name: active.name,
      baseUrl: active.baseUrl,
      username: active.username,
      color: active.color,
      hasPassword: !!active.password,
    };
  }

  count(): number {
    return this.repo.count();
  }

  create(dto: ICreateEnvironmentDto): ICamundaEnvironmentSafe {
    const id =
      dto.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
      "-" +
      Date.now().toString(36);

    const newEnv: ICamundaEnvironment = {
      id,
      name: dto.name,
      baseUrl: dto.baseUrl.replace(/\/+$/, ""),
      username: dto.username || "",
      password: dto.password || "",
      color: dto.color || DEFAULT_ENV_COLOR,
      isActive: this.repo.count() === 0,
    };

    this.repo.save(newEnv);
    return this.toSafe(newEnv);
  }

  update(id: string, dto: IUpdateEnvironmentDto): ICamundaEnvironmentSafe | null {
    const env = this.repo.findById(id);
    if (!env) return null;

    if (dto.name) env.name = dto.name;
    if (dto.baseUrl) env.baseUrl = dto.baseUrl.replace(/\/+$/, "");
    if (dto.username !== undefined) env.username = dto.username;
    if (dto.password && dto.password !== PASSWORD_MASK) env.password = dto.password;
    if (dto.color) env.color = dto.color;

    this.repo.save(env);
    return this.toSafe(env);
  }

  activate(id: string): { name: string; id: string } | null {
    const target = this.repo.findById(id);
    if (!target) return null;

    const allEnvs = this.repo.findAll();
    allEnvs.forEach((e) => (e.isActive = e.id === id));
    this.repo.saveAll(allEnvs);

    return { name: target.name, id: target.id };
  }

  delete(id: string): boolean {
    return this.repo.delete(id);
  }

  async testConnection(
    baseUrl: string,
    username?: string,
    password?: string
  ): Promise<ITestConnectionResult> {
    try {
      const client = buildTestClient(baseUrl, username, password);
      const r = await client.get("/engine");
      return { success: true, engines: r.data };
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message || "Unknown error";
      return {
        success: false,
        status,
        message: status === 401 ? "Authentication failed — check credentials" : msg,
      };
    }
  }

  private toSafe(env: ICamundaEnvironment): ICamundaEnvironmentSafe {
    return {
      ...env,
      password: env.password ? PASSWORD_MASK : "",
      hasPassword: !!env.password,
    };
  }
}
