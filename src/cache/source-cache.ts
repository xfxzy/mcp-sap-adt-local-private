interface SourceEntry {
  source: string;
  lines: string[];
}

export class SourceCache {
  private readonly entries = new Map<string, SourceEntry>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Source cache capacity must be a positive integer");
    }
  }

  put(systemId: string, objectKey: string, source: string): void {
    const key = this.key(systemId, objectKey);
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { source, lines: source.split(/\r?\n/) });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(
    systemId: string,
    objectKey: string,
  ): { source: string; lineCount: number } {
    const entry = this.entries.get(this.key(systemId, objectKey));
    if (!entry) throw new Error("Source is not cached");
    this.entries.delete(this.key(systemId, objectKey));
    this.entries.set(this.key(systemId, objectKey), entry);
    return { source: entry.source, lineCount: entry.lines.length };
  }

  readRange(
    systemId: string,
    objectKey: string,
    fromLine: number,
    toLine: number,
  ): { fromLine: number; toLine: number; lines: string[] } {
    const entry = this.entries.get(this.key(systemId, objectKey));
    if (!entry) throw new Error("Source is not cached");
    if (
      !Number.isInteger(fromLine) ||
      !Number.isInteger(toLine) ||
      fromLine < 1 ||
      toLine < fromLine ||
      toLine > entry.lines.length
    ) {
      throw new Error(
        `Source range must be within 1..${entry.lines.length} and inclusive`,
      );
    }
    this.entries.delete(this.key(systemId, objectKey));
    this.entries.set(this.key(systemId, objectKey), entry);
    return {
      fromLine,
      toLine,
      lines: entry.lines.slice(fromLine - 1, toLine),
    };
  }

  private key(systemId: string, objectKey: string): string {
    return `${systemId}\u0000${objectKey}`;
  }
}
