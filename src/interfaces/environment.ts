export interface ICamundaEnvironment {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  color: string;
  isActive: boolean;
}

export interface ICamundaEnvironmentSafe extends Omit<ICamundaEnvironment, "password"> {
  password: string;     // masked
  hasPassword: boolean;
}

export interface ICreateEnvironmentDto {
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  color?: string;
}

export interface IUpdateEnvironmentDto {
  name?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  color?: string;
}

export interface ITestConnectionDto {
  baseUrl: string;
  username?: string;
  password?: string;
}

export interface ITestConnectionResult {
  success: boolean;
  engines?: unknown[];
  status?: number;
  message?: string;
}

export interface IEnvironmentRepository {
  findAll(): ICamundaEnvironment[];
  findById(id: string): ICamundaEnvironment | undefined;
  findActive(): ICamundaEnvironment | undefined;
  save(env: ICamundaEnvironment): void;
  saveAll(envs: ICamundaEnvironment[]): void;
  delete(id: string): boolean;
}
