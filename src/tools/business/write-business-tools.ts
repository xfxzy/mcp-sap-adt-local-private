import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditLog } from "../../audit/audit-log.js";
import { applyBusinessChange } from "../../business-api/apply-business-change.js";
import type { BusinessApiRegistry } from "../../business-api/business-api-registry.js";
import type { BusinessMutationOperation } from "../../business-api/prepare-business-change.js";
import { prepareBusinessChange } from "../../business-api/prepare-business-change.js";
import { verifyBusinessChange } from "../../business-api/verify-business-change.js";
import type { ChangePlanStore } from "../../change-plans/change-plan-store.js";
import type { CredentialStore } from "../../credentials/credential-store.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export const BUSINESS_WRITE_TOOL_NAMES = [
  "prepare_business_change",
  "apply_business_change",
  "verify_business_change",
] as const;

interface Deps {
  systems: SystemRegistry;
  apis: BusinessApiRegistry;
  credentials: CredentialStore;
  plans: ChangePlanStore;
  audit: Pick<AuditLog, "write">;
}
function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

const mutationOperationSchema = z
  .union([
    z.enum(["create", "update"]),
    z.string().regex(/^action:[A-Za-z][A-Za-z0-9_]*$/),
  ])
  .transform((value) => value as BusinessMutationOperation);

export function registerBusinessWriteTools(
  server: McpServer,
  deps: Deps,
): void {
  server.registerTool(
    "prepare_business_change",
    {
      description:
        "Prepare an expiring typed SAP business API change plan without writing",
      inputSchema: z.object({
        systemId: z.string().min(1),
        apiId: z.string().min(1),
        entitySet: z.string().min(1),
        operation: mutationOperationSchema,
        keys: z.record(z.string(), z.unknown()),
        changes: z.record(z.string(), z.unknown()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => result(await prepareBusinessChange(deps, input)),
  );
  server.registerTool(
    "apply_business_change",
    {
      description:
        "Apply exactly one separately approved business API change plan and verify it",
      inputSchema: z.object({
        planId: z.string().uuid(),
        approveWrite: z.literal(true),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => result(await applyBusinessChange(deps, input)),
  );
  server.registerTool(
    "verify_business_change",
    {
      description:
        "Independently read back and verify an allowlisted business API change",
      inputSchema: z.object({
        systemId: z.string().min(1),
        apiId: z.string().min(1),
        entitySet: z.string().min(1),
        keys: z.record(z.string(), z.unknown()),
        expected: z.record(z.string(), z.unknown()),
        expectedFields: z.array(z.string().min(1)).min(1),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => result(await verifyBusinessChange(deps, input)),
  );
}
