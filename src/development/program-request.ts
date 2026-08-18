import { createHash } from "node:crypto";

export interface ValidatedProgramSource {
  programName: string;
  source: string;
  sha256: string;
  byteLength: number;
  lineCount: number;
}

export function normalizeProgramSource(source: string): string {
  return source.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export function hashProgramSource(source: string): string {
  return createHash("sha256")
    .update(normalizeProgramSource(source), "utf8")
    .digest("hex");
}

export function validateProgramName(
  programName: string,
  objectNamePatterns: string[],
): string {
  const normalized = programName.trim().toUpperCase();
  if (!/^[ZY][A-Z0-9_]{0,39}$/.test(normalized)) {
    throw new Error(
      "Program name must be a safe Z or Y executable program name",
    );
  }
  if (!objectNamePatterns.some((pattern) => matchesGlob(normalized, pattern))) {
    throw new Error(
      "Program name does not match a configured object name pattern",
    );
  }
  return normalized;
}

export function validateProgramSource(
  requestedProgramName: string,
  source: string,
  maxBytes: number,
): ValidatedProgramSource {
  const programName = validateProgramName(requestedProgramName, ["Z*", "Y*"]);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Maximum source bytes must be a positive integer");
  }

  const bytes = Buffer.from(source, "utf8");
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Source exceeds the ${maxBytes}-byte limit`);
  }

  const declaration = firstProgramDeclaration(source);
  if (!declaration) {
    throw new Error(
      "The first non-comment ABAP statement must be REPORT or PROGRAM",
    );
  }
  if (declaration !== programName) {
    throw new Error(
      "Declared ABAP program name must match the requested program name",
    );
  }

  return {
    programName,
    source,
    sha256: hashProgramSource(source),
    byteLength: bytes.byteLength,
    lineCount: source.split(/\r?\n/).length,
  };
}

function matchesGlob(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().toUpperCase();
  if (!normalizedPattern) return false;
  const expression = normalizedPattern
    .split("")
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return /[A-Z0-9_]/.test(character) ? character : `\\${character}`;
    })
    .join("");
  return new RegExp(`^${expression}$`).test(value);
}

function firstProgramDeclaration(source: string): string | undefined {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  const firstStatement = lines.find((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 && !trimmed.startsWith("*") && !trimmed.startsWith('"')
    );
  });
  if (!firstStatement) return undefined;

  const declaration = firstStatement.match(
    /^\s*(?:REPORT|PROGRAM)\s+([A-Za-z0-9_]+)\s*\./i,
  );
  return declaration?.[1]?.toUpperCase();
}
