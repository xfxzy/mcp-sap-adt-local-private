import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BusinessApiRegistry } from "../../business-api/business-api-registry.js";
import type { CredentialStore } from "../../credentials/credential-store.js";
import { ODataSession } from "../../odata/odata-session.js";
import { parseODataMetadata } from "../../odata/parse-metadata.js";
import { validateServiceProfile } from "../../odata/validate-service-profile.js";
import { requireReadAccess } from "../../policy/access-policy.js";
import type { SystemRegistry } from "../../systems/system-registry.js";
import { createSapDispatcher } from "../../tls/create-dispatcher.js";

export const BUSINESS_READ_TOOL_NAMES = [
  "list_business_apis",
  "inspect_business_api",
  "read_business_entity",
] as const;

export interface BusinessReadToolDependencies {
  systems: SystemRegistry;
  apis: BusinessApiRegistry;
  credentials: CredentialStore;
}

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

async function withSession<T>(
  deps: BusinessReadToolDependencies,
  systemId: string,
  fn: (
    session: ODataSession,
    rootSystem: ReturnType<SystemRegistry["requireActive"]>,
  ) => Promise<T>,
): Promise<T> {
  const system = deps.systems.requireActive(systemId);
  requireReadAccess(system);
  const password = await deps.credentials.get(system.auth.credentialRef);
  if (!password)
    throw new Error(`Credential is not configured for SAP system ${system.id}`);
  const dispatcher = createSapDispatcher(system);
  try {
    return await fn(
      ODataSession.create({
        system,
        getPassword: async () => password,
        dispatcher,
      }),
      system,
    );
  } finally {
    await dispatcher.close();
  }
}

export function registerBusinessReadTools(
  server: McpServer,
  deps: BusinessReadToolDependencies,
): void {
  server.registerTool(
    "list_business_apis",
    {
      description:
        "List explicitly allowlisted SAP OData APIs for an active system",
      inputSchema: z.object({ systemId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ systemId }) => {
      const entries = deps.apis
        .list(systemId)
        .map(({ profileId, service }) => ({
          profileId,
          id: service.id,
          serviceRoot: service.serviceRoot,
          entities: service.entities.map((entity) => ({
            entitySet: entity.entitySet,
            keys: entity.keys,
            operations: entity.operations,
          })),
        }));
      return result({ systemId: systemId.trim().toUpperCase(), apis: entries });
    },
  );

  server.registerTool(
    "inspect_business_api",
    {
      description:
        "Read and validate live OData V2 metadata for an allowlisted API",
      inputSchema: z.object({
        systemId: z.string().min(1),
        apiId: z.string().min(1),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, apiId }) => {
      const service = deps.apis.requireService(systemId, apiId);
      return result(
        await withSession(deps, systemId, async (session) => {
          const model = parseODataMetadata(
            await session.metadata(service.serviceRoot),
          );
          validateServiceProfile(service, model);
          return {
            systemId: systemId.trim().toUpperCase(),
            apiId: service.id,
            serviceRoot: service.serviceRoot,
            entitySets: service.entities.map((entity) => ({
              entitySet: entity.entitySet,
              keys: entity.keys,
              properties: Object.values(
                model.entityTypes[model.entitySets[entity.entitySet].entityType]
                  .properties,
              ),
              operations: entity.operations,
            })),
          };
        }),
      );
    },
  );

  server.registerTool(
    "read_business_entity",
    {
      description: "Read one allowlisted SAP OData entity by typed keys",
      inputSchema: z.object({
        systemId: z.string().min(1),
        apiId: z.string().min(1),
        entitySet: z.string().min(1),
        keys: z.record(z.string(), z.unknown()),
        fields: z.array(z.string().min(1)).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ systemId, apiId, entitySet, keys, fields }) => {
      const { service, entity } = deps.apis.requireEntity(
        systemId,
        apiId,
        entitySet,
      );
      if (
        fields?.some(
          (field) =>
            !entity.verifyFields.includes(field) &&
            !entity.mutableFields.includes(field) &&
            !entity.immutableFields.includes(field) &&
            !entity.sensitiveFields.includes(field),
        )
      )
        throw new Error("Requested field is not allowlisted");
      return result(
        await withSession(deps, systemId, async (session) => {
          const model = parseODataMetadata(
            await session.metadata(service.serviceRoot),
          );
          validateServiceProfile(service, model);
          const type =
            model.entityTypes[model.entitySets[entity.entitySet].entityType];
          const response = await session.getEntity({
            serviceRoot: service.serviceRoot,
            entitySet: entity.entitySet,
            keys,
            keyTypes: type.properties,
            keyOrder: entity.keys,
            fields,
          });
          return {
            systemId: systemId.trim().toUpperCase(),
            apiId: service.id,
            entitySet: entity.entitySet,
            keys,
            data: response.data,
            etag: response.etag,
            verifyFields: entity.verifyFields,
          };
        }),
      );
    },
  );
}
