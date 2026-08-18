import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateProgramName,
  validateProgramSource,
} from "../../src/development/program-request.js";
import { readLocalProgramSource } from "../../src/development/source-file.js";

describe("program request validation", () => {
  it.each([
    "SAPMSSY1",
    "CL_TEST",
    "ZR-BAD",
    "",
  ])("rejects unsafe program name %s", (name) => {
    expect(() => validateProgramName(name, ["Z*", "Y*"])).toThrow();
  });

  it("normalizes an allowed program name to uppercase", () => {
    expect(validateProgramName("zr_mcp_adt_local_smoke", ["Z*", "Y*"])).toBe(
      "ZR_MCP_ADT_LOCAL_SMOKE",
    );
  });

  it("accepts a bounded executable Z report", () => {
    const result = validateProgramSource(
      "ZR_MCP_ADT_LOCAL_SMOKE",
      "  \n* generated locally\n\" another comment\n  REPORT zr_mcp_adt_local_smoke.\nWRITE / 'OK'.",
      200_000,
    );

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.programName).toBe("ZR_MCP_ADT_LOCAL_SMOKE");
  });

  it("hashes LF and CRLF program sources identically", () => {
    const lf = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\nWRITE / 'OK'.\n",
      200_000,
    );
    const crlf = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\r\nWRITE / 'OK'.\r\n",
      200_000,
    );

    expect(crlf.sha256).toBe(lf.sha256);
  });

  it("hashes an SAP-stripped final line ending identically", () => {
    const local = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\nWRITE / 'OK'.\n",
      200_000,
    );
    const sap = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\nWRITE / 'OK'.",
      200_000,
    );

    expect(sap.sha256).toBe(local.sha256);
  });

  it("does not discard an extra trailing blank line from source hashing", () => {
    const oneFinalLineEnding = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\nWRITE / 'OK'.\n",
      200_000,
    );
    const extraBlankLine = validateProgramSource(
      "ZR_EOL",
      "REPORT zr_eol.\nWRITE / 'OK'.\n\n",
      200_000,
    );

    expect(extraBlankLine.sha256).not.toBe(oneFinalLineEnding.sha256);
  });

  it("rejects a report declaration for a different program", () => {
    expect(() =>
      validateProgramSource("ZR_EXPECTED", "REPORT zr_actual.", 200_000),
    ).toThrow(/match/i);
  });

  it("rejects empty and malformed source", () => {
    expect(() =>
      validateProgramSource("ZR_TEST", "* only a comment", 100),
    ).toThrow(/statement|empty/i);
    expect(() =>
      validateProgramSource("ZR_TEST", "WRITE / 'not a program'.", 100),
    ).toThrow(/REPORT|PROGRAM/i);
  });

  it("reads UTF-8 from the exact supplied local path and preserves its metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "mcp-adt-source-"));
    const sourcePath = join(directory, "ZR_EXACT.abap");
    const source = "REPORT zr_exact.\nWRITE / 'OK'.";
    writeFileSync(sourcePath, source, "utf8");

    try {
      const result = readLocalProgramSource("ZR_EXACT", sourcePath, 200_000);

      expect(result.sourcePath).toBe(sourcePath);
      expect(result.source).toBe(source);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects source files above the configured byte cap", () => {
    const directory = mkdtempSync(join(tmpdir(), "mcp-adt-source-"));
    const sourcePath = join(directory, "ZR_LIMIT.abap");
    writeFileSync(sourcePath, "REPORT zr_limit.\nWRITE / 'TOO LONG'.", "utf8");

    try {
      expect(() => readLocalProgramSource("ZR_LIMIT", sourcePath, 8)).toThrow(
        /byte/i,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects path traversal before reading the source file", () => {
    const directory = mkdtempSync(join(tmpdir(), "mcp-adt-source-"));
    const nestedDirectory = join(directory, "nested");
    const sourcePath = `${nestedDirectory}${sep}..${sep}ZR_TRAVERSAL.abap`;
    mkdirSync(nestedDirectory);
    writeFileSync(
      join(directory, "ZR_TRAVERSAL.abap"),
      "REPORT zr_traversal.",
      "utf8",
    );

    try {
      expect(() =>
        readLocalProgramSource("ZR_TRAVERSAL", sourcePath, 200_000),
      ).toThrow(/traversal/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
