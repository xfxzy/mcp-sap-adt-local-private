import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AdtRepositoryReader } from "./adt/repository-reader.js";
import { AdtRuntimeReader } from "./adt/runtime-reader.js";
import { AdtTableReader } from "./adt/table-reader.js";
import { BusinessApiRegistry } from "./business-api/business-api-registry.js";
import { ChangePlanStore } from "./change-plans/change-plan-store.js";
import type { SapSystemConfig } from "./config/types.js";
import { AdtProgramReader } from "./development/program-reader.js";
import { AdtProgramWriter } from "./development/program-writer.js";
import { RateLimiter } from "./http/rate-limiter.js";
import type { RuntimeContext } from "./runtime/context.js";
import { SystemRegistry } from "./systems/system-registry.js";
import { registerBusinessReadTools } from "./tools/business/read-business-tools.js";
import { registerBusinessWriteTools } from "./tools/business/write-business-tools.js";
import { registerProgramTools } from "./tools/development/program-tools.js";
import { registerRepositoryTools } from "./tools/read/repository-tools.js";
import { registerRuntimeTools } from "./tools/read/runtime-tools.js";
import { registerSearchSourceTool } from "./tools/read/search-source.js";
import {
  AdtSystemHealthProbe,
  registerSystemTools,
} from "./tools/read/system-tools.js";
import { registerTableTools } from "./tools/read/table-tools.js";
import { APP_NAME, APP_VERSION } from "./version.js";

export function createMcpServer(context?: RuntimeContext): McpServer {
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION });
  server
    .registerTool("__initialize_tool_handlers__", {}, () => ({ content: [] }))
    .remove();
  if (context) {
    const registry = new SystemRegistry(context.config);
    const rateLimiters = new Map<string, RateLimiter>();
    const rateLimiterFor = (system: SapSystemConfig): RateLimiter => {
      const existing = rateLimiters.get(system.id);
      if (existing) return existing;
      const created = new RateLimiter(system.limits.rateLimitPerMin);
      rateLimiters.set(system.id, created);
      return created;
    };
    registerSystemTools(server, {
      registry,
      probe: new AdtSystemHealthProbe(context.credentialStore, rateLimiterFor),
    });
    const repositoryReader = new AdtRepositoryReader(
      context.credentialStore,
      rateLimiterFor,
    );
    registerRepositoryTools(server, {
      registry,
      reader: repositoryReader,
    });
    registerTableTools(server, {
      registry,
      reader: new AdtTableReader(context.credentialStore, rateLimiterFor),
    });
    registerSearchSourceTool(server, { registry, reader: repositoryReader });
    registerRuntimeTools(server, {
      registry,
      reader: new AdtRuntimeReader(context.credentialStore, rateLimiterFor),
    });
    const programReader = new AdtProgramReader(
      context.credentialStore,
      rateLimiterFor,
    );
    registerProgramTools(server, {
      registry,
      reader: programReader,
      writer: new AdtProgramWriter(context.credentialStore, rateLimiterFor),
      plans: new ChangePlanStore(),
      audit: context.audit,
    });
    if (context.businessApis) {
      registerBusinessReadTools(server, {
        systems: registry,
        apis: new BusinessApiRegistry(context.businessApis, registry),
        credentials: context.credentialStore,
      });
      registerBusinessWriteTools(server, {
        systems: registry,
        apis: new BusinessApiRegistry(context.businessApis, registry),
        credentials: context.credentialStore,
        plans: new ChangePlanStore(),
        audit: context.audit,
      });
    }
  }
  return server;
}

export async function serveMcp(context: RuntimeContext): Promise<void> {
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
