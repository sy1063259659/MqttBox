export class Logger {
  constructor(private readonly scope: string) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("INFO", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("WARN", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("ERROR", message, meta);
  }

  private log(level: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${timestamp} [${level}] [${this.scope}] ${message}${suffix}`);
  }
}
