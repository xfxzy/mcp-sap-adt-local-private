import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { parseSystemsConfig } from "./schema.js";
import type { SystemsConfig } from "./types.js";

export async function loadSystemsConfig(path: string): Promise<SystemsConfig> {
  const source = await readFile(path, "utf8");
  return parseSystemsConfig(parse(source));
}
