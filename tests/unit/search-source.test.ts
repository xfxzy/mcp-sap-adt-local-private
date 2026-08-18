import { describe, expect, it, vi } from "vitest";
import type {
  RepositoryReader,
  RepositorySearchResult,
} from "../../src/adt/repository-reader.js";
import type { SapSystemConfig } from "../../src/config/types.js";
import { searchSource } from "../../src/tools/read/search-source.js";

const system: SapSystemConfig = {
  id: "SAH",
  label: "SAH Client 400",
  kind: "s4hana-op",
  environment: "non-production",
  connection: {
    protocol: "https",
    host: "sap.example.com",
    port: 44300,
    client: "400",
    language: "1",
    serverTimezone: "Asia/Shanghai",
  },
  auth: { type: "basic", username: "DEMO_USER", credentialRef: "SAH" },
  tls: {
    mode: "pinned",
    fingerprintSha256: "AA".repeat(32),
    allowExpired: true,
  },
  access: {
    read: true,
    adtDevelopmentWrite: true,
    businessApiWrite: true,
  },
  development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
  businessApis: { enabledProfiles: [] },
  limits: {
    requestTimeoutMs: 30000,
    rateLimitPerMin: 60,
    maxSourceLines: 5000,
  },
};

function repository(sources: string[]): RepositoryReader {
  const objects: RepositorySearchResult[] = sources.map((_source, index) => ({
    name: `ZTEST${index + 1}`,
    type: "PROG/P",
    uri: `/sap/bc/adt/programs/programs/ztest${index + 1}`,
  }));
  return {
    search: vi.fn(async (_system, params) =>
      objects.slice(0, params.maxResults),
    ),
    readSource: vi.fn(async (_system, params) => {
      const index = Number(params.objectName.replace("ZTEST", "")) - 1;
      return { source: sources[index] };
    }),
    getObjectStructure: vi.fn(),
    whereUsed: vi.fn(),
  };
}

describe("searchSource", () => {
  it("stops after maxObjects and returns exact one-based line numbers", async () => {
    const reader = repository([
      "REPORT ztest1.\nCALL FUNCTION 'BAPI_ONE'.",
      "REPORT ztest2.\nno match",
      "REPORT ztest3.\nbapi_two( ).",
      "BAPI_NOT_SCANNED",
    ]);

    const result = await searchSource(reader, system, {
      pattern: "BAPI",
      query: "Z*",
      objectType: "ANY",
      maxObjects: 3,
      maxResults: 10,
    });

    expect(result.objectsScanned).toBe(3);
    expect(result.matches).toEqual([
      {
        objectName: "ZTEST1",
        objectType: "PROG/P",
        lineNumber: 2,
        line: "CALL FUNCTION 'BAPI_ONE'.",
      },
      {
        objectName: "ZTEST3",
        objectType: "PROG/P",
        lineNumber: 2,
        line: "bapi_two( ).",
      },
    ]);
    expect(result.truncated).toBe(true);
    expect(reader.readSource).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when maxResults is reached", async () => {
    const reader = repository([
      "BAPI_ONE\nBAPI_TWO\nBAPI_THREE",
      "BAPI_NOT_SCANNED",
    ]);

    const result = await searchSource(reader, system, {
      pattern: "BAPI",
      query: "Z*",
      objectType: "PROG/P",
      maxObjects: 10,
      maxResults: 2,
    });

    expect(result.objectsScanned).toBe(1);
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(reader.readSource).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid regular expressions with INVALID_REGEX", async () => {
    const reader = repository(["source"]);
    await expect(
      searchSource(reader, system, {
        pattern: "[",
        query: "Z*",
        objectType: "ANY",
        maxObjects: 10,
        maxResults: 10,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REGEX" });
    expect(reader.search).not.toHaveBeenCalled();
  });
});
