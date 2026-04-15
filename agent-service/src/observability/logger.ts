const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof LEVEL_PRIORITY;

function normalizeLevel(level: string): LogLevel {
  const normalized = level.toLowerCase();
  if (normalized in LEVEL_PRIORITY) {
    return normalized as LogLevel;
  }

  return "info";
}

export class Logger {
  private readonly minLevel: LogLevel;

  constructor(
    private readonly scope: string,
    minLevel: LogLevel | string = "info",
  ) {
    this.minLevel = normalizeLevel(minLevel);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(meta ?? {}),
    };

    console.log(JSON.stringify(payload));
  }
}
