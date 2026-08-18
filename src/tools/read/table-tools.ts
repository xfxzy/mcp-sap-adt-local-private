import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TableReader } from "../../adt/table-reader.js";
import type { SapSystemConfig } from "../../config/types.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import { validateReadQuery } from "../../sql/validate-read-query.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export const TABLE_TOOL_NAMES = ["read_table_structure", "read_table"] as const;

const LARGE_TABLES = [
  "ACDOCA",
  "BSEG",
  "BKPF",
  "MARA",
  "MARC",
  "MATDOC",
  "MSEG",
] as const;

export interface TableToolDependencies {
  registry: SystemRegistry;
  reader: TableReader;
}

function toolResult(structuredContent: Record<string, unknown>) {
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

export function registerTableTools(
  server: McpServer,
  dependencies: TableToolDependencies,
): void {
  server.registerTool(
    "read_table_structure",
    {
      description: "Read SAP DDIC table structure through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        tableName: z.string().regex(/^[A-Za-z0-9_/$]+$/),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, tableName }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const structure = await dependencies.reader.readStructure(
        system,
        tableName.toUpperCase(),
      );
      return toolResult({ systemId: system.id, ...structure });
    },
  );

  server.registerTool(
    "read_table",
    {
      description:
        "Execute one guarded OpenSQL SELECT through ADT Data Preview",
      inputSchema: z.object({
        systemId: z.string().min(1),
        sql: z.string().min(1),
        maxRows: z.number().int().min(1).max(500).default(500),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, sql, maxRows }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const validated = validateReadQuery(sql, maxRows, {
        largeTables: [...LARGE_TABLES],
      });
      const data = await dependencies.reader.readQuery(
        system,
        validated.sql,
        validated.rowLimit,
      );
      return toolResult({
        systemId: system.id,
        sql: validated.sql,
        rowLimit: validated.rowLimit,
        columns: data.columns,
        rows: data.rows,
        count: data.rows.length,
      });
    },
  );
}
