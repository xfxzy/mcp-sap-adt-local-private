import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { BusinessApisConfig } from "./schema.js";
import { parseBusinessApis } from "./schema.js";

export async function loadBusinessApis(
  path: string | URL,
): Promise<BusinessApisConfig> {
  const source = await readFile(path, "utf8");
  return parseBusinessApis(parse(source));
}
