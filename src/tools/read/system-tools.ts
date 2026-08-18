import { performance } from "node:perf_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { AdtConnectionAdapter } from "../../adt/adt-connection-adapter.js";
import type { SapSystemConfig } from "../../config/types.js";
import type { CredentialStore } from "../../credentials/credential-store.js";
import { SapHttpError } from "../../http/errors.js";
import { RateLimiter } from "../../http/rate-limiter.js";
import { SapHttpSession } from "../../http/sap-http-session.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import type { SystemRegistry } from "../../systems/system-registry.js";
import { createSapDispatcher } from "../../tls/create-dispatcher.js";

export const SYSTEM_TOOL_NAMES = [
  "list_systems",
  "set_active_systems",
  "sap_system_info",
] as const;

export interface SystemHealthResult {
  reachable: true;
  latencyMs: number;
  discoveryEndpointCount: number;
  systemInformationAvailable: boolean;
  system: {
    systemID?: string;
    userName?: string;
    client?: string;
    language?: string;
    userFullName?: string;
  };
}

export interface SystemHealthProbe {
  inspect(system: SapSystemConfig): Promise<SystemHealthResult>;
}

export type SystemRateLimiterFactory = (system: SapSystemConfig) => RateLimiter;

function countHrefs(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countHrefs(item), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  return Object.entries(value).reduce(
    (count, [key, item]) =>
      count + (key.toLowerCase() === "@_href" ? 1 : countHrefs(item)),
    0,
  );
}

function parseSystemInformation(source: unknown): SystemHealthResult["system"] {
  const parsed =
    typeof source === "string" ? (JSON.parse(source) as unknown) : source;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SAP system information response is invalid");
  }
  const result: SystemHealthResult["system"] = {};
  for (const key of [
    "systemID",
    "userName",
    "client",
    "language",
    "userFullName",
  ] as const) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new Error(`SAP system information field ${key} is invalid`);
      }
      result[key] = value;
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error("SAP system information response is empty");
  }
  return result;
}

export class AdtSystemHealthProbe implements SystemHealthProbe {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: SystemRateLimiterFactory = (system) =>
      new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  private rateLimiter(system: SapSystemConfig): RateLimiter {
    const existing = this.rateLimiters.get(system.id);
    if (existing) return existing;
    const created = this.createRateLimiter(system);
    this.rateLimiters.set(system.id, created);
    return created;
  }

  async inspect(system: SapSystemConfig): Promise<SystemHealthResult> {
    const password = await this.credentials.get(system.auth.credentialRef);
    if (!password) {
      throw new Error(
        `Credential is not configured for SAP system ${system.id}`,
      );
    }
    const dispatcher = createSapDispatcher(system);
    const connection = new AdtConnectionAdapter(
      new SapHttpSession({
        system,
        dispatcher,
        getPassword: async () => password,
        rateLimiter: this.rateLimiter(system),
      }),
    );
    const startedAt = performance.now();
    try {
      const discovery = await connection.makeAdtRequest<string>({
        url: "/sap/bc/adt/discovery",
        method: "GET",
        timeout: system.limits.requestTimeoutMs,
        headers: { Accept: "application/atomsvc+xml" },
      });
      const parsedDiscovery = new XMLParser({
        ignoreAttributes: false,
      }).parse(discovery.data) as unknown;
      const discoveryEndpointCount = countHrefs(parsedDiscovery);
      if (
        typeof parsedDiscovery !== "object" ||
        parsedDiscovery === null ||
        discoveryEndpointCount === 0
      ) {
        throw new Error("SAP ADT discovery response is invalid or empty");
      }
      let systemInformationAvailable = true;
      let systemInformation: SystemHealthResult["system"];
      try {
        const information = await connection.makeAdtRequest<string>({
          url: "/sap/bc/adt/core/http/systeminformation",
          method: "GET",
          timeout: system.limits.requestTimeoutMs,
          headers: {
            Accept:
              "application/vnd.sap.adt.core.http.systeminformation.v1+json",
          },
        });
        systemInformation = parseSystemInformation(information.data);
      } catch (error) {
        if (!(error instanceof SapHttpError) || error.status !== 404)
          throw error;
        const coreDiscovery = await connection.makeAdtRequest<string>({
          url: "/sap/bc/adt/core/discovery",
          method: "GET",
          timeout: system.limits.requestTimeoutMs,
          headers: { Accept: "application/atomsvc+xml" },
        });
        const parsedCoreDiscovery = new XMLParser({
          ignoreAttributes: false,
        }).parse(coreDiscovery.data) as unknown;
        if (
          typeof parsedCoreDiscovery !== "object" ||
          parsedCoreDiscovery === null
        ) {
          throw new Error("SAP ADT core discovery response is invalid");
        }
        systemInformationAvailable = false;
        systemInformation = {
          userName: system.auth.username,
          client: system.connection.client,
          language: system.connection.language,
        };
      }
      return {
        reachable: true,
        latencyMs: Math.round(performance.now() - startedAt),
        discoveryEndpointCount,
        systemInformationAvailable,
        system: systemInformation,
      };
    } finally {
      await dispatcher.close();
    }
  }
}

export interface SystemToolDependencies {
  registry: SystemRegistry;
  probe: SystemHealthProbe;
}

function toolResult(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

export function registerSystemTools(
  server: McpServer,
  dependencies: SystemToolDependencies,
): void {
  server.registerTool(
    "list_systems",
    {
      description: "List configured SAP systems without network access",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const systems = dependencies.registry.list().map((system) => ({
        id: system.id,
        label: system.label,
        kind: system.kind,
        environment: system.environment,
        active: dependencies.registry.isActive(system.id),
        tlsMode: system.tls.mode,
        access: system.access,
      }));
      return toolResult({ count: systems.length, systems });
    },
  );

  server.registerTool(
    "set_active_systems",
    {
      description: "Set the configured SAP systems available to network tools",
      inputSchema: z.object({ systemIds: z.array(z.string()) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ systemIds }) => {
      const activeSystemIds = dependencies.registry.setActive(systemIds);
      return toolResult({ activeSystemIds });
    },
  );

  server.registerTool(
    "sap_system_info",
    {
      description: "Authenticate and read ADT discovery and system information",
      inputSchema: z.object({ systemId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId }) => {
      const system = dependencies.registry.requireActive(systemId);
      requireReadAccess(system);
      const health = await dependencies.probe.inspect(system);
      return toolResult({ systemId: system.id, ...health });
    },
  );
}
