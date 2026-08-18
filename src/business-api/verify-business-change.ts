import { parseODataMetadata } from "../odata/parse-metadata.js";
import { validateServiceProfile } from "../odata/validate-service-profile.js";
import type { BusinessApiRegistry } from "./business-api-registry.js";
import {
  type BusinessSessionDependencies,
  withBusinessSession,
} from "./business-session.js";

export interface VerifyBusinessChangeRequest {
  systemId: string;
  apiId: string;
  entitySet: string;
  keys: Record<string, unknown>;
  expected: Record<string, unknown>;
  expectedFields: string[];
}

export interface BusinessVerificationResult {
  verified: true;
  systemId: string;
  apiId: string;
  entitySet: string;
  keys: Record<string, unknown>;
  fields: string[];
  data: Record<string, unknown>;
  etag?: string;
}

export interface VerifyBusinessChangeDependencies
  extends BusinessSessionDependencies {
  apis: BusinessApiRegistry;
}

export async function verifyBusinessChange(
  deps: VerifyBusinessChangeDependencies,
  request: VerifyBusinessChangeRequest,
): Promise<BusinessVerificationResult> {
  const { service, entity } = deps.apis.requireEntity(
    request.systemId,
    request.apiId,
    request.entitySet,
  );
  const fields = request.expectedFields.length
    ? request.expectedFields
    : entity.verifyFields;
  if (fields.length === 0)
    throw new Error("Business verification requires at least one field");
  if (fields.some((field) => !entity.verifyFields.includes(field)))
    throw new Error("Verification field is not allowlisted");
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
      const current = await session.getEntity({
        serviceRoot: service.serviceRoot,
        entitySet: entity.entitySet,
        keys: request.keys,
        keyTypes: type.properties,
        keyOrder: entity.keys,
        fields,
      });
      if (
        typeof current.data !== "object" ||
        current.data === null ||
        Array.isArray(current.data)
      )
        throw new Error("SAP entity response is not an object");
      const data = current.data as Record<string, unknown>;
      const mismatches = fields.filter(
        (field) =>
          JSON.stringify(data[field]) !==
          JSON.stringify(request.expected[field]),
      );
      if (mismatches.length)
        throw new Error(`WRITE_VERIFICATION_FAILED: ${mismatches.join(",")}`);
      return {
        verified: true,
        systemId: system.id,
        apiId: service.id,
        entitySet: entity.entitySet,
        keys: request.keys,
        fields,
        data,
        etag: current.etag,
      };
    },
  );
}
