import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  RepositoryReader,
  RepositorySearchResult,
} from "../../adt/repository-reader.js";
import { SourceCache } from "../../cache/source-cache.js";
import type { SapSystemConfig } from "../../config/types.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export const REPOSITORY_TOOL_NAMES = [
  "search_repository_object",
  "read_source_code",
  "read_source_range",
  "get_object_structure",
  "where_used",
] as const;

export interface RepositoryToolDependencies {
  registry: SystemRegistry;
  reader: RepositoryReader;
  sourceCache?: SourceCache;
}

function result(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function prepareSystem(
  registry: SystemRegistry,
  systemId: string,
): SapSystemConfig {
  const system = registry.requireActive(systemId);
  requireReadAccess(system);
  return system;
}

function objectKey(
  objectType: string,
  objectName: string,
  functionGroup: string | undefined,
  version: "active" | "inactive",
): string {
  return [objectType, functionGroup ?? "", objectName, version]
    .map((value) => value.toUpperCase())
    .join(":");
}

function sourceLines(source: string): string[] {
  return source.split(/\r?\n/);
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return Math.min(500, Math.max(1, value ?? fallback));
}

function searchResult(
  resultItem: RepositorySearchResult,
): RepositorySearchResult {
  return { ...resultItem };
}

export function registerRepositoryTools(
  server: McpServer,
  dependencies: RepositoryToolDependencies,
): void {
  const sourceCache = dependencies.sourceCache ?? new SourceCache(64);

  server.registerTool(
    "search_repository_object",
    {
      description: "Search configured SAP ADT repository objects",
      inputSchema: z.object({
        systemId: z.string().min(1),
        query: z.string().min(1),
        objectType: z.string().min(1).optional(),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, query, objectType, maxResults }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const limit = boundedLimit(maxResults, 100);
      const results = await dependencies.reader.search(system, {
        query,
        objectType,
        maxResults: limit,
      });
      const cappedResults = results.slice(0, limit);
      return result({
        systemId: system.id,
        count: cappedResults.length,
        results: cappedResults.map(searchResult),
      });
    },
  );

  server.registerTool(
    "read_source_code",
    {
      description: "Read active or inactive source code from SAP ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        objectType: z.string().min(1),
        objectName: z.string().min(1),
        functionGroup: z.string().min(1).optional(),
        version: z.enum(["active", "inactive"]).default("active"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, objectType, objectName, functionGroup, version }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const source = await dependencies.reader.readSource(system, {
        objectType,
        objectName,
        functionGroup,
        version,
      });
      const lines = sourceLines(source.source);
      if (lines.length > system.limits.maxSourceLines) {
        throw new Error(
          `Source exceeds configured limit of ${system.limits.maxSourceLines} lines`,
        );
      }
      sourceCache.put(
        system.id,
        objectKey(objectType, objectName, functionGroup, version),
        source.source,
      );
      return result({
        systemId: system.id,
        objectType,
        objectName,
        ...(functionGroup ? { functionGroup } : {}),
        version,
        source: source.source,
        lineCount: lines.length,
        ...(source.uri ? { uri: source.uri } : {}),
      });
    },
  );

  server.registerTool(
    "read_source_range",
    {
      description: "Read an inclusive one-based range of SAP source lines",
      inputSchema: z.object({
        systemId: z.string().min(1),
        objectType: z.string().min(1),
        objectName: z.string().min(1),
        functionGroup: z.string().min(1).optional(),
        fromLine: z.number().int().min(1),
        toLine: z.number().int().min(1),
        version: z.enum(["active", "inactive"]).default("active"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({
      systemId,
      objectType,
      objectName,
      functionGroup,
      fromLine,
      toLine,
      version,
    }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const key = objectKey(objectType, objectName, functionGroup, version);
      let cached: { source: string; lineCount: number } | undefined;
      try {
        cached = sourceCache.get(system.id, key);
      } catch {
        const source = await dependencies.reader.readSource(system, {
          objectType,
          objectName,
          functionGroup,
          version,
        });
        const lines = sourceLines(source.source);
        if (lines.length > system.limits.maxSourceLines) {
          throw new Error(
            `Source exceeds configured limit of ${system.limits.maxSourceLines} lines`,
          );
        }
        sourceCache.put(system.id, key, source.source);
        cached = { source: source.source, lineCount: lines.length };
      }
      const range = sourceCache.readRange(system.id, key, fromLine, toLine);
      return result({
        systemId: system.id,
        objectType,
        objectName,
        ...(functionGroup ? { functionGroup } : {}),
        version,
        lineCount: cached.lineCount,
        ...range,
      });
    },
  );

  server.registerTool(
    "get_object_structure",
    {
      description: "Read a structured SAP ADT repository object tree",
      inputSchema: z.object({
        systemId: z.string().min(1),
        objectType: z.string().min(1),
        objectName: z.string().min(1),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, objectType, objectName }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const structure = await dependencies.reader.getObjectStructure(
        system,
        objectType,
        objectName,
      );
      return result({
        systemId: system.id,
        objectType,
        objectName,
        structure: structure.structure,
        ...(structure.uri ? { uri: structure.uri } : {}),
      });
    },
  );

  server.registerTool(
    "where_used",
    {
      description: "Read SAP ADT where-used references",
      inputSchema: z.object({
        systemId: z.string().min(1),
        objectType: z.string().min(1),
        objectName: z.string().min(1),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, objectType, objectName, maxResults }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const limit = boundedLimit(maxResults, 100);
      const whereUsed = await dependencies.reader.whereUsed(system, {
        objectType,
        objectName,
        maxResults: limit,
      });
      const references = whereUsed.references.slice(0, limit);
      return result({
        systemId: system.id,
        objectType,
        objectName,
        count: references.length,
        references: references.map(searchResult),
      });
    },
  );
}
