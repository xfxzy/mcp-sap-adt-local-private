import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditLog } from "../../audit/audit-log.js";
import type { ChangePlanStore } from "../../change-plans/change-plan-store.js";
import {
  type AppliedProgramChange,
  applyProgramChange,
} from "../../development/apply-program-change.js";
import {
  type PreparedProgramChange,
  prepareProgramChange,
} from "../../development/prepare-program-change.js";
import type { ProgramReader } from "../../development/program-reader.js";
import type { ProgramWriter } from "../../development/program-writer.js";
import {
  type ProgramVerificationResult,
  verifyProgram,
} from "../../development/verify-program.js";
import type { SystemRegistry } from "../../systems/system-registry.js";

export const PROGRAM_TOOL_NAMES = [
  "prepare_z_program_change",
  "apply_z_program_change",
  "verify_z_program",
] as const;

export interface ProgramToolDependencies {
  registry: SystemRegistry;
  reader: ProgramReader;
  writer: ProgramWriter;
  plans: ChangePlanStore;
  audit: Pick<AuditLog, "write">;
}

function toolResult(
  structuredContent:
    | PreparedProgramChange
    | AppliedProgramChange
    | ProgramVerificationResult,
) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent: structuredContent as unknown as Record<string, unknown>,
  };
}

export function registerProgramTools(
  server: McpServer,
  dependencies: ProgramToolDependencies,
): void {
  server.registerTool(
    "prepare_z_program_change",
    {
      description:
        "Prepare an expiring reviewed plan for a Z/Y executable program create or update",
      inputSchema: z.object({
        systemId: z.string().min(1),
        action: z.enum(["create", "update"]),
        programName: z.string().min(1),
        sourcePath: z.string().min(1),
        packageName: z.string().min(1),
        transportRequest: z.string().min(1).optional(),
        description: z.string().min(1).max(60),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      toolResult(
        await prepareProgramChange(
          {
            registry: dependencies.registry,
            reader: dependencies.reader,
            plans: dependencies.plans,
          },
          input,
        ),
      ),
  );

  server.registerTool(
    "apply_z_program_change",
    {
      description:
        "Consume one prepared plan, apply its exact Z/Y program change, activate, and verify",
      inputSchema: z.object({
        planId: z.string().uuid(),
        approveWrite: z.literal(true),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      toolResult(
        await applyProgramChange(
          {
            registry: dependencies.registry,
            reader: dependencies.reader,
            writer: dependencies.writer,
            plans: dependencies.plans,
            audit: dependencies.audit,
          },
          input,
        ),
      ),
  );

  server.registerTool(
    "verify_z_program",
    {
      description:
        "Read and verify an active Z/Y executable program package and source hash",
      inputSchema: z.object({
        systemId: z.string().min(1),
        programName: z.string().min(1),
        packageName: z.string().min(1),
        expectedHash: z
          .string()
          .regex(/^[A-Fa-f0-9]{64}$/)
          .optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) =>
      toolResult(
        await verifyProgram(
          { registry: dependencies.registry, reader: dependencies.reader },
          input,
        ),
      ),
  );
}
