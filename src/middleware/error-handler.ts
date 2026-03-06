import type { Request, Response, NextFunction } from "express";

export interface AppError extends Error {
  statusCode?: number;
  response?: { status?: number; data?: unknown };
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode =
    err.statusCode ||
    (err.response as { status?: number })?.status ||
    500;

  const message =
    (err.response as { data?: { message?: string } })?.data?.message ||
    err.message ||
    "Internal Server Error";

  console.error(`[ERROR] ${statusCode}: ${message}`);

  res.status(statusCode).json({ error: message });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
