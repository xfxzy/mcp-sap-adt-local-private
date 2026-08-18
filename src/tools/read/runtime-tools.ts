import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeReader } from "../../adt/runtime-reader.js";
import type { SapSystemConfig } from "../../config/types.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export const RUNTIME_TOOL_NAMES = [
  "list_dumps",
  "read_dump_detail",
  "read_system_messages",
  "read_http_log",
  "list_transports",
] as const;

export interface RuntimeToolDependencies {
  registry: SystemRegistry;
  reader: RuntimeReader;
}

const timestamp = z
  .string()
  .regex(/^\d{14}$/)
  .optional();

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

function feedParams(input: {
  user?: string;
  from?: string;
  to?: string;
  maxResults?: number;
}) {
  return {
    ...(input.user ? { user: input.user } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    maxResults: input.maxResults ?? 100,
  };
}

export function registerRuntimeTools(
  server: McpServer,
  dependencies: RuntimeToolDependencies,
): void {
  server.registerTool(
    "list_dumps",
    {
      description: "List ABAP runtime dumps through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        user: z.string().min(1).optional(),
        from: timestamp,
        to: timestamp,
        maxResults: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, ...filters }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const result = await dependencies.reader.listDumps(
        system,
        feedParams(filters),
      );
      return toolResult({
        systemId: system.id,
        count: result.items.length,
        items: result.items,
      });
    },
  );

  server.registerTool(
    "read_dump_detail",
    {
      description: "Read one ABAP runtime dump detail through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        dumpId: z
          .string()
          .min(1)
          .regex(/^[^/\\]+$/),
        view: z.enum(["default", "summary", "formatted"]).default("formatted"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, dumpId, view }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const detail = await dependencies.reader.readDumpDetail(system, {
        dumpId,
        view,
      });
      return toolResult({ systemId: system.id, ...detail });
    },
  );

  server.registerTool(
    "read_system_messages",
    {
      description: "Read SAP SM02 system messages through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        user: z.string().min(1).optional(),
        from: timestamp,
        to: timestamp,
        maxResults: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, ...filters }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const result = await dependencies.reader.readSystemMessages(
        system,
        feedParams(filters),
      );
      return toolResult({
        systemId: system.id,
        count: result.items.length,
        items: result.items,
      });
    },
  );

  server.registerTool(
    "read_http_log",
    {
      description: "Read SAP Gateway HTTP error log entries through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        user: z.string().min(1).optional(),
        from: timestamp,
        to: timestamp,
        maxResults: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, ...filters }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const result = await dependencies.reader.readHttpLog(
        system,
        feedParams(filters),
      );
      return toolResult({
        systemId: system.id,
        count: result.items.length,
        items: result.items,
      });
    },
  );

  server.registerTool(
    "list_transports",
    {
      description: "List SAP CTS transport requests through ADT",
      inputSchema: z.object({
        systemId: z.string().min(1),
        user: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
        dateRange: z.string().min(1).optional(),
        targetSystem: z.string().min(1).optional(),
        requestType: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({
      systemId,
      user,
      status,
      dateRange,
      targetSystem,
      requestType,
    }) => {
      const system = prepareSystem(dependencies.registry, systemId);
      const result = await dependencies.reader.listTransports(system, {
        user: user ?? system.auth.username,
        ...(status ? { status } : {}),
        ...(dateRange ? { dateRange } : {}),
        ...(targetSystem ? { targetSystem } : {}),
        ...(requestType ? { requestType } : {}),
      });
      return toolResult({
        systemId: system.id,
        count: result.items.length,
        items: result.items,
      });
    },
  );
}
