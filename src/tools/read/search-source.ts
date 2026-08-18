import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RepositoryReader } from "../../adt/repository-reader.js";
import type { SapSystemConfig } from "../../config/types.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export interface SearchSourceParams {
  pattern: string;
  query: string;
  objectType: string;
  maxObjects: number;
  maxResults: number;
}

export interface SourceMatch {
  objectName: string;
  objectType: string;
  lineNumber: number;
  line: string;
}

export interface SearchSourceResult {
  pattern: string;
  query: string;
  objectType: string;
  objectsScanned: number;
  matches: SourceMatch[];
  truncated: boolean;
}

export class SearchSourceError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REGEX",
  ) {
    super(message);
  }
}

export async function searchSource(
  reader: RepositoryReader,
  system: SapSystemConfig,
  params: SearchSourceParams,
): Promise<SearchSourceResult> {
  let expression: RegExp;
  try {
    expression = new RegExp(params.pattern, "i");
  } catch (error) {
    throw new SearchSourceError(
      `Invalid source search regular expression: ${(error as Error).message}`,
      "INVALID_REGEX",
    );
  }

  const requestedObjectType = params.objectType.trim().toUpperCase();
  const objects = (
    await reader.search(system, {
      query: params.query,
      ...(requestedObjectType === "ANY"
        ? {}
        : { objectType: params.objectType }),
      maxResults: params.maxObjects,
    })
  ).slice(0, params.maxObjects);
  const matches: SourceMatch[] = [];
  let objectsScanned = 0;

  for (const object of objects) {
    const source = await reader.readSource(system, {
      objectType: object.type,
      objectName: object.name,
      version: "active",
    });
    objectsScanned += 1;
    const lines = source.source.split(/\r?\n/);
    if (lines.length > system.limits.maxSourceLines) {
      throw new Error(
        `Source ${object.name} exceeds configured limit of ${system.limits.maxSourceLines} lines`,
      );
    }
    for (const [index, line] of lines.entries()) {
      if (!expression.test(line)) continue;
      matches.push({
        objectName: object.name,
        objectType: object.type,
        lineNumber: index + 1,
        line,
      });
      if (matches.length >= params.maxResults) {
        return {
          pattern: params.pattern,
          query: params.query,
          objectType: params.objectType,
          objectsScanned,
          matches,
          truncated: true,
        };
      }
    }
  }

  return {
    pattern: params.pattern,
    query: params.query,
    objectType: params.objectType,
    objectsScanned,
    matches,
    truncated: objects.length >= params.maxObjects,
  };
}

export interface SearchSourceToolDependencies {
  registry: SystemRegistry;
  reader: RepositoryReader;
}

function toolResult(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

export function registerSearchSourceTool(
  server: McpServer,
  dependencies: SearchSourceToolDependencies,
): void {
  server.registerTool(
    "search_source",
    {
      description: "Search active SAP repository source with a bounded regex",
      inputSchema: z.object({
        systemId: z.string().min(1),
        pattern: z.string().min(1).max(500),
        query: z.string().min(1).max(200).default("*"),
        objectType: z.string().min(1).default("ANY"),
        maxObjects: z.number().int().min(1).max(100).default(20),
        maxResults: z.number().int().min(1).max(500).default(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, ...params }) => {
      const system = dependencies.registry.requireActive(systemId);
      requireReadAccess(system);
      const result = await searchSource(dependencies.reader, system, params);
      return toolResult({ systemId: system.id, ...result });
    },
  );
}
