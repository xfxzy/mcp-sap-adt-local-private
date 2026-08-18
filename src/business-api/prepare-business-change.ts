import { randomUUID } from "node:crypto";
import type { ChangePlanStore } from "../change-plans/change-plan-store.js";
import type { ODataProperty } from "../odata/metadata-types.js";
import { formatODataValue } from "../odata/odata-values.js";
import { parseODataMetadata } from "../odata/parse-metadata.js";
import { validateServiceProfile } from "../odata/validate-service-profile.js";
import type { BusinessApiRegistry } from "./business-api-registry.js";
import { type BusinessFieldDiff, buildBusinessDiff } from "./business-diff.js";
import {
  type BusinessSessionDependencies,
  withBusinessSession,
} from "./business-session.js";

export interface PrepareBusinessChangeRequest {
  systemId: string;
  apiId: string;
  entitySet: string;
  operation: BusinessMutationOperation;
  keys: Record<string, unknown>;
  changes: Record<string, unknown>;
}

export interface PreparedBusinessChange {
  planId: string;
  kind: "business";
  systemId: string;
  apiId: string;
  entitySet: string;
  operation: BusinessMutationOperation;
  keys: Record<string, unknown>;
  diff: BusinessFieldDiff[];
  payload: Record<string, unknown>;
  expectedEtag?: string;
  expiresAt: string;
}

export type BusinessMutationOperation =
  | "create"
  | "update"
  | `action:${string}`;

export interface PrepareBusinessChangeDependencies
  extends BusinessSessionDependencies {
  apis: BusinessApiRegistry;
  plans: ChangePlanStore;
}

export function validateBusinessValue(
  field: string,
  value: unknown,
  property: ODataProperty,
): void {
  if (value === null) {
    if (!property.nullable) throw new Error(`Field ${field} is not nullable`);
    return;
  }
  if (property.type === "Edm.String") {
    if (typeof value !== "string")
      throw new Error(`Field ${field} must be a string`);
    if (property.maxLength !== undefined && value.length > property.maxLength)
      throw new Error(`Field ${field} exceeds MaxLength ${property.maxLength}`);
  }
  if (property.type === "Edm.Boolean") {
    if (typeof value !== "boolean")
      throw new Error(`Field ${field} must be boolean`);
    return;
  }
  if (["Edm.Int16", "Edm.Int32", "Edm.Int64"].includes(property.type)) {
    const text = typeof value === "bigint" ? value.toString() : String(value);
    if (!/^-?\d+$/.test(text))
      throw new Error(`Field ${field} is not a valid integer`);
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw new Error(
        `Field ${field} must be a safe integer or integer string`,
      );
    const integer = BigInt(text);
    const [minimum, maximum] =
      property.type === "Edm.Int16"
        ? [-32768n, 32767n]
        : property.type === "Edm.Int32"
          ? [-2147483648n, 2147483647n]
          : [-9223372036854775808n, 9223372036854775807n];
    if (integer < minimum || integer > maximum)
      throw new Error(`Field ${field} is outside the ${property.type} range`);
    return;
  }
  if (property.type === "Edm.Decimal") {
    const text = String(value);
    if (!/^-?\d+(?:\.\d+)?$/.test(text))
      throw new Error(`Field ${field} is not a valid decimal`);
    const unsigned = text.replace(/^-/, "");
    const [integerPart, fraction = ""] = unsigned.split(".");
    const significantInteger = integerPart.replace(/^0+/, "");
    const precision = Math.max(1, significantInteger.length + fraction.length);
    if (property.precision !== undefined && precision > property.precision)
      throw new Error(`Field ${field} exceeds Precision ${property.precision}`);
    if (property.scale !== undefined && fraction.length > property.scale)
      throw new Error(`Field ${field} exceeds Scale ${property.scale}`);
    return;
  }
  if (["Edm.Double", "Edm.Single"].includes(property.type)) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`Field ${field} is not a valid number`);
    return;
  }
  if (property.type === "Edm.Guid") {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new Error(`Field ${field} is not a valid GUID`);
    return;
  }
  if (
    property.type === "Edm.DateTime" ||
    property.type === "Edm.DateTimeOffset"
  ) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) ||
      Number.isNaN(Date.parse(value))
    )
      throw new Error(`Field ${field} is not a valid ${property.type}`);
    return;
  }
  if (property.type !== "Edm.String")
    throw new Error(`Field ${field} uses unsupported type ${property.type}`);
}

function assertOperation(
  entity: { operations: string[] },
  operation: string,
): void {
  if (!entity.operations.includes(operation))
    throw new Error(
      `Operation ${operation} is not allowlisted for this entity`,
    );
}

export async function prepareBusinessChange(
  deps: PrepareBusinessChangeDependencies,
  request: PrepareBusinessChangeRequest,
): Promise<PreparedBusinessChange> {
  const { service, entity } = deps.apis.requireEntity(
    request.systemId,
    request.apiId,
    request.entitySet,
  );
  assertOperation(entity, request.operation);
  const suppliedKeys = Object.keys(request.keys);
  if (
    suppliedKeys.length !== entity.keys.length ||
    suppliedKeys.some((key) => !entity.keys.includes(key))
  )
    throw new Error("Entity keys must exactly match the allowlisted key set");
  if (
    request.operation === "update" &&
    Object.keys(request.changes).length === 0
  )
    throw new Error("Business update must contain at least one field");
  for (const key of entity.keys)
    if (!(key in request.keys)) throw new Error(`Missing entity key: ${key}`);
  for (const field of Object.keys(request.changes)) {
    if (!entity.mutableFields.includes(field))
      throw new Error(`Field is not mutable or allowlisted: ${field}`);
    if (entity.keys.includes(field))
      throw new Error(`Key field cannot be changed: ${field}`);
  }
  return withBusinessSession(
    deps,
    request.systemId,
    async (session, system) => {
      const model = parseODataMetadata(
        await session.metadata(service.serviceRoot),
      );
      validateServiceProfile(service, model);
      const type =
        model.entityTypes[model.entitySets[entity.entitySet].entityType];
      for (const key of entity.keys) {
        validateBusinessValue(key, request.keys[key], type.properties[key]);
        formatODataValue(request.keys[key], type.properties[key].type);
      }
      for (const [field, value] of Object.entries(request.changes))
        validateBusinessValue(field, value, type.properties[field]);
      let before: Record<string, unknown> = {};
      let expectedEtag: string | undefined;
      if (request.operation !== "create") {
        const current = await session.getEntity({
          serviceRoot: service.serviceRoot,
          entitySet: entity.entitySet,
          keys: request.keys,
          keyTypes: type.properties,
          keyOrder: entity.keys,
        });
        if (
          typeof current.data !== "object" ||
          current.data === null ||
          Array.isArray(current.data)
        )
          throw new Error("SAP entity response is not an object");
        before = current.data as Record<string, unknown>;
        expectedEtag = current.etag;
        if (!expectedEtag)
          throw new Error(
            `SAP entity ${entity.entitySet} did not return an ETag`,
          );
      }
      const diff =
        request.operation === "create"
          ? Object.entries(request.changes).map(([field, after]) => ({
              field,
              before: undefined,
              after,
              type: type.properties[field].type,
            }))
          : buildBusinessDiff(before, request.changes, type.properties);
      if (request.operation !== "create" && diff.length === 0)
        throw new Error("Business update does not change any value");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      const payload =
        request.operation === "create"
          ? { ...request.keys, ...request.changes }
          : request.operation === "update"
            ? request.changes
            : { ...request.keys, ...request.changes };
      const knownExpected = { ...before, ...request.keys, ...request.changes };
      const missingVerificationFields = entity.verifyFields.filter(
        (field) => !Object.hasOwn(knownExpected, field),
      );
      if (missingVerificationFields.length)
        throw new Error(
          `Cannot verify fields without expected values: ${missingVerificationFields.join(",")}`,
        );
      const plan: PreparedBusinessChange = {
        planId: randomUUID(),
        kind: "business",
        systemId: system.id,
        apiId: service.id,
        entitySet: entity.entitySet,
        operation: request.operation,
        keys: request.keys,
        diff,
        payload,
        expectedEtag,
        expiresAt,
      };
      deps.plans.put({
        id: plan.planId,
        kind: "business",
        systemId: system.id,
        target: `${service.id}/${entity.entitySet}`,
        createdAt: now.toISOString(),
        expiresAt,
        expectedEtag,
        request: plan,
      });
      return plan;
    },
  );
}
