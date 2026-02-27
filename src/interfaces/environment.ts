/**
 * Interfaces for Environment domain — ISP applied.
 * Consumers depend only on the interface they need.
 */

/** Core environment model */
export interface ICamundaEnvironment {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  color: string;
  isActive: boolean;
}

/** Safe version sent to the UI (no raw password) */
export interface ICamundaEnvironmentSafe extends Omit<ICamundaEnvironment, "password"> {
  password: string;     // masked
  hasPassword: boolean;
}

/** Data required to create a new environment */
export interface ICreateEnvironmentDto {
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  color?: string;
}

/** Data for updating an existing environment */
export interface IUpdateEnvironmentDto {
  name?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  color?: string;
}

/** Connection test request */
export interface ITestConnectionDto {
  baseUrl: string;
  username?: string;
  password?: string;
}

/** Connection test result */
export interface ITestConnectionResult {
  success: boolean;
  engines?: unknown[];
  status?: number;
  message?: string;
}

/** Repository interface — DIP: services depend on abstraction, not file system */
export interface IEnvironmentRepository {
  findAll(): ICamundaEnvironment[];
  findById(id: string): ICamundaEnvironment | undefined;
  findActive(): ICamundaEnvironment | undefined;
  save(env: ICamundaEnvironment): void;
  saveAll(envs: ICamundaEnvironment[]): void;
  delete(id: string): boolean;
}
