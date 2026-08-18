import type { AuditLog } from "../audit/audit-log.js";
import type { ChangePlanStore } from "../change-plans/change-plan-store.js";
import { SapHttpError } from "../http/errors.js";
import { parseODataMetadata } from "../odata/parse-metadata.js";
import { validateServiceProfile } from "../odata/validate-service-profile.js";
import { requireWriteAccess } from "../policy/access-policy.js";
import type { BusinessApiRegistry } from "./business-api-registry.js";
import {
  type BusinessSessionDependencies,
  withBusinessSession,
} from "./business-session.js";
import type { PreparedBusinessChange } from "./prepare-business-change.js";
import {
  type BusinessVerificationResult,
  verifyBusinessChange,
} from "./verify-business-change.js";

export interface ApplyBusinessChangeRequest {
  planId: string;
  approveWrite: boolean;
}

export interface AppliedBusinessChange extends BusinessVerificationResult {
  planId: string;
  operation: PreparedBusinessChange["operation"];
}

export interface ApplyBusinessChangeDependencies
  extends BusinessSessionDependencies {
  apis: BusinessApiRegistry;
  plans: ChangePlanStore;
  audit: Pick<AuditLog, "write">;
}

export async function applyBusinessChange(
  deps: ApplyBusinessChangeDependencies,
  input: ApplyBusinessChangeRequest,
): Promise<AppliedBusinessChange> {
  if (input.approveWrite !== true)
    throw new Error("approveWrite must be true before applying a SAP change");
  const plan = deps.plans.consume<PreparedBusinessChange>(input.planId);
  if (plan.kind !== "business")
    throw new Error(`Change plan ${plan.id} is not a business API plan`);
  const system = deps.systems.requireActive(plan.systemId);
  try {
    requireWriteAccess(system, "business-api", configuredWriteDecision(system));
    const { service, entity } = deps.apis.requireEntity(
      plan.systemId,
      plan.request.apiId,
      plan.request.entitySet,
    );
    const prepared = plan.request;
    if (
      prepared.apiId !== service.id ||
      prepared.entitySet !== entity.entitySet
    )
      throw new Error("Business change plan target binding is invalid");
    let expectedForVerify: Record<string, unknown> = { ...prepared.payload };
    await withBusinessSession(deps, plan.systemId, async (session) => {
      const model = parseODataMetadata(
        await session.metadata(service.serviceRoot),
      );
      validateServiceProfile(service, model);
      const type =
        model.entityTypes[model.entitySets[entity.entitySet].entityType];
      if (prepared.operation !== "create") {
        const current = await session.getEntity({
          serviceRoot: service.serviceRoot,
          entitySet: entity.entitySet,
          keys: prepared.keys,
          keyTypes: type.properties,
          keyOrder: entity.keys,
        });
        if (plan.expectedEtag && current.etag !== plan.expectedEtag)
          throw Object.assign(
            new Error("STALE_CHANGE_PLAN: ETag changed since prepare"),
            { code: "STALE_CHANGE_PLAN" },
          );
        if (
          typeof current.data !== "object" ||
          current.data === null ||
          Array.isArray(current.data)
        )
          throw new Error("SAP entity response is not an object");
        for (const diff of prepared.diff)
          if (
            JSON.stringify(
              (current.data as Record<string, unknown>)[diff.field],
            ) !== JSON.stringify(diff.before)
          )
            throw Object.assign(
              new Error("STALE_CHANGE_PLAN: field changed since prepare"),
              { code: "STALE_CHANGE_PLAN" },
            );
        expectedForVerify = Object.fromEntries(
          entity.verifyFields.map((field) => [
            field,
            Object.hasOwn(prepared.payload, field)
              ? prepared.payload[field]
              : (current.data as Record<string, unknown>)[field],
          ]),
        );
        if (prepared.operation === "update") {
          try {
            await session.patchEntity({
              serviceRoot: service.serviceRoot,
              entitySet: entity.entitySet,
              keys: prepared.keys,
              keyTypes: type.properties,
              keyOrder: entity.keys,
              payload: prepared.payload,
              etag: plan.expectedEtag,
            });
          } catch (error) {
            throw mapConcurrencyError(error);
          }
        } else {
          const actionName = prepared.operation.slice("action:".length);
          try {
            await session.action(
              service.serviceRoot,
              actionName,
              prepared.payload,
            );
          } catch (error) {
            throw mapConcurrencyError(error);
          }
        }
      } else {
        await session.createEntity(
          service.serviceRoot,
          entity.entitySet,
          prepared.payload,
        );
      }
    });
    const verified = await verifyBusinessChange(deps, {
      systemId: plan.systemId,
      apiId: prepared.apiId,
      entitySet: prepared.entitySet,
      keys: prepared.keys,
      expected: expectedForVerify,
      expectedFields: entity.verifyFields,
    });
    await deps.audit.write({
      event: "business_api_change",
      status: "success",
      planId: plan.id,
      systemId: plan.systemId,
      apiId: prepared.apiId,
      entitySet: prepared.entitySet,
      keys: prepared.keys,
      diff: prepared.diff.map((diff) => ({
        field: diff.field,
        before: entity.sensitiveFields.includes(diff.field)
          ? "[REDACTED]"
          : diff.before,
        after: entity.sensitiveFields.includes(diff.field)
          ? "[REDACTED]"
          : diff.after,
      })),
    });
    return { ...verified, planId: plan.id, operation: prepared.operation };
  } catch (error) {
    await deps.audit.write({
      event: "business_api_change",
      status: "failed",
      planId: plan.id,
      systemId: plan.systemId,
      apiId: plan.request.apiId,
      entitySet: plan.request.entitySet,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function mapConcurrencyError(error: unknown): unknown {
  if (error instanceof SapHttpError && error.status === 412) {
    return Object.assign(
      new Error("STALE_CHANGE_PLAN: SAP rejected the prepared ETag"),
      { code: "STALE_CHANGE_PLAN" },
    );
  }
  return error;
}

function configuredWriteDecision(
  system: Parameters<typeof requireWriteAccess>[0],
) {
  if (system.tls.mode === "insecure")
    return {
      allowed: true,
      writeAllowed: false,
      reason: "Insecure TLS mode is read-only",
    };
  return { allowed: true, writeAllowed: true };
}
