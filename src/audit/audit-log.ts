import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AppendOnlyWriter {
  append(line: string): Promise<void>;
}

export class FileAppendOnlyWriter implements AppendOnlyWriter {
  constructor(private readonly path: string) {}

  async append(line: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line, { encoding: "utf8", mode: 0o600 });
  }
}

const STANDARD_SENSITIVE_KEYS = [
  "password",
  "authorization",
  "cookie",
  "token",
  "secret",
];

function redact(
  value: unknown,
  sensitiveKeys: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, sensitiveKeys, seen));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    throw new Error("Audit event contains a circular reference");
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sensitiveKeys.has(key.toLowerCase())
      ? "[REDACTED]"
      : redact(entry, sensitiveKeys, seen);
  }
  seen.delete(value);
  return output;
}

export class AuditLog {
  private readonly sensitiveKeys: ReadonlySet<string>;

  constructor(
    private readonly writer: AppendOnlyWriter,
    configuredSensitiveFields: string[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sensitiveKeys = new Set(
      [...STANDARD_SENSITIVE_KEYS, ...configuredSensitiveFields].map((key) =>
        key.toLowerCase(),
      ),
    );
  }

  async write(event: Record<string, unknown>): Promise<void> {
    const safeEvent = redact(
      event,
      this.sensitiveKeys,
      new WeakSet(),
    ) as Record<string, unknown>;
    await this.writer.append(
      `${JSON.stringify({ ...safeEvent, timestamp: this.now().toISOString() })}\n`,
    );
  }
}
