import { createHash } from "node:crypto";

export function indexByName<T extends { name: string }>(
  items: T[],
): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.name, item]));
}

export function requiredKeys(tool: {
  inputSchema: { required?: string[] };
}): string[] {
  return [...(tool.inputSchema.required ?? [])];
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
