/**
 * Express Error Handling Middleware — Presentation layer.
 *
 * Centralizes error response formatting. Eliminates duplicate try/catch blocks.
 * SRP: Sole responsibility is mapping errors to HTTP responses.
 */

import type { Request, Response, NextFunction } from "express";

export interface AppError extends Error {
  statusCode?: number;
  response?: { status?: number; data?: unknown };
}

/**
 * Global error handler — catches unhandled errors from route handlers.
 */
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

/**
 * Wraps an async route handler to automatically catch and forward errors.
 * Eliminates the need for try/catch in every route.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
