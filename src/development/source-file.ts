import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import {
  type ValidatedProgramSource,
  validateProgramSource,
} from "./program-request.js";

export interface LocalProgramSource extends ValidatedProgramSource {
  sourcePath: string;
}

export function readLocalProgramSource(
  programName: string,
  sourcePath: string,
  maxBytes: number,
): LocalProgramSource {
  if (!sourcePath || sourcePath.trim() !== sourcePath) {
    throw new Error("Source path must be an exact non-empty local path");
  }
  if (sourcePath.split(/[\\/]+/).includes("..")) {
    throw new Error("Source path traversal is not allowed");
  }
  const bytes = readFileSync(sourcePath);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Source exceeds the ${maxBytes}-byte limit`);
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Source file must be valid UTF-8");
  }

  return {
    ...validateProgramSource(programName, source, maxBytes),
    sourcePath,
  };
}
