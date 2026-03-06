type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: string): void {
  if (level in LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, msg: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return `${prefix} ${msg} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${msg}`;
}

export const logger = {
  debug(msg: string, data?: unknown): void {
    if (shouldLog("debug")) {
      process.stderr.write(formatMessage("debug", msg, data) + "\n");
    }
  },
  info(msg: string, data?: unknown): void {
    if (shouldLog("info")) {
      process.stderr.write(formatMessage("info", msg, data) + "\n");
    }
  },
  warn(msg: string, data?: unknown): void {
    if (shouldLog("warn")) {
      process.stderr.write(formatMessage("warn", msg, data) + "\n");
    }
  },
  error(msg: string, data?: unknown): void {
    if (shouldLog("error")) {
      process.stderr.write(formatMessage("error", msg, data) + "\n");
    }
  },
};
