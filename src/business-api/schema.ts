import { z } from "zod";

export type BusinessApiOperation =
  | "read"
  | "create"
  | "update"
  | `action:${string}`;

export interface BusinessApiEntity {
  entitySet: string;
  keys: string[];
  operations: BusinessApiOperation[];
  mutableFields: string[];
  immutableFields: string[];
  sensitiveFields: string[];
  verifyFields: string[];
}

export interface BusinessApiService {
  id: string;
  serviceRoot: string;
  entities: BusinessApiEntity[];
}

export interface BusinessApiProfile {
  services: BusinessApiService[];
}

export interface BusinessApisConfig {
  version: 1;
  profiles: Record<string, BusinessApiProfile>;
}

export type BusinessApiConfig = BusinessApisConfig;

const identifierSchema = z
  .string()
  .trim()
  .min(1, "identifier must not be empty")
  .refine((value) => !value.includes("*"), "wildcard fields are not allowed")
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "identifier must be a SAP field name");

const profileIdSchema = z
  .string()
  .min(1, "profile id must not be empty")
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "profile id contains invalid characters");

const serviceIdSchema = z
  .string()
  .trim()
  .min(1, "service id must not be empty")
  .regex(/^[A-Z0-9_]+$/, "service id must contain only A-Z, 0-9, and _");

const serviceRootSchema = z
  .string()
  .trim()
  .refine(
    (value) => /^\/sap\/opu\/odata\/sap\/[A-Z0-9_]+\/$/.test(value),
    "serviceRoot must be a relative OData root matching /sap/opu/odata/sap/[A-Z0-9_]+/ (no host, credentials, traversal, query, or fragment)",
  );

const operationSchema = z
  .string()
  .trim()
  .min(1, "operation must not be empty")
  .refine(
    (value): value is BusinessApiOperation =>
      value === "read" ||
      value === "create" ||
      value === "update" ||
      /^action:[A-Za-z][A-Za-z0-9_]*$/.test(value),
    "unknown operation; only read, create, update, or action:<Name> are allowed (generic DELETE is not allowed)",
  );

const fieldsSchema = z.array(identifierSchema);

const entitySchema = z
  .object({
    entitySet: identifierSchema.refine(
      (value) => !value.includes("*"),
      "entitySet wildcard is not allowed",
    ),
    keys: fieldsSchema.min(1, "entity must declare at least one key"),
    operations: z
      .array(operationSchema)
      .min(1, "entity must declare at least one operation"),
    mutableFields: fieldsSchema,
    immutableFields: fieldsSchema,
    sensitiveFields: fieldsSchema,
    verifyFields: fieldsSchema.min(
      1,
      "entity must declare at least one verify field",
    ),
  })
  .strict()
  .superRefine((entity, context) => {
    const checkDuplicates = (fields: string[], fieldName: string) => {
      const seen = new Set<string>();
      for (const [index, field] of fields.entries()) {
        if (seen.has(field)) {
          context.addIssue({
            code: "custom",
            path: [fieldName, index],
            message: `Duplicate field: ${field}`,
          });
        }
        seen.add(field);
      }
    };

    checkDuplicates(entity.keys, "keys");
    checkDuplicates(entity.mutableFields, "mutableFields");
    checkDuplicates(entity.immutableFields, "immutableFields");
    checkDuplicates(entity.sensitiveFields, "sensitiveFields");
    checkDuplicates(entity.verifyFields, "verifyFields");

    const immutable = new Set(entity.immutableFields);
    for (const [index, field] of entity.mutableFields.entries()) {
      if (immutable.has(field)) {
        context.addIssue({
          code: "custom",
          path: ["mutableFields", index],
          message: `Field policy overlap: ${field} is both mutable and immutable`,
        });
      }
    }

    for (const [index, key] of entity.keys.entries()) {
      if (!immutable.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["keys", index],
          message: `Key field must be listed as immutable: ${key}`,
        });
      }
      if (entity.mutableFields.includes(key)) {
        context.addIssue({
          code: "custom",
          path: ["mutableFields"],
          message: `Key field cannot be mutable: ${key}`,
        });
      }
    }
  });

const serviceSchema = z
  .object({
    id: serviceIdSchema,
    serviceRoot: serviceRootSchema,
    entities: z
      .array(entitySchema)
      .min(1, "service must declare at least one entity"),
  })
  .strict();

const profileSchema = z
  .object({
    services: z
      .array(serviceSchema)
      .min(1, "profile must declare at least one service"),
  })
  .strict()
  .superRefine((profile, context) => {
    const seenServices = new Set<string>();
    for (const [serviceIndex, service] of profile.services.entries()) {
      if (seenServices.has(service.id)) {
        context.addIssue({
          code: "custom",
          path: ["services", serviceIndex, "id"],
          message: `Duplicate service id: ${service.id}`,
        });
      }
      seenServices.add(service.id);

      const seenEntities = new Set<string>();
      for (const [entityIndex, entity] of service.entities.entries()) {
        if (seenEntities.has(entity.entitySet)) {
          context.addIssue({
            code: "custom",
            path: [
              "services",
              serviceIndex,
              "entities",
              entityIndex,
              "entitySet",
            ],
            message: `Duplicate entity id: ${entity.entitySet}`,
          });
        }
        seenEntities.add(entity.entitySet);
      }
    }
  });

const businessApisSchema = z
  .object({
    version: z.literal(1),
    profiles: z
      .record(profileIdSchema, profileSchema)
      .refine(
        (profiles) => Object.keys(profiles).length > 0,
        "at least one business API profile is required",
      ),
  })
  .strict();

export function parseBusinessApis(input: unknown): BusinessApisConfig {
  validateProfileKeys(input);
  return businessApisSchema.parse(input) as BusinessApisConfig;
}

function validateProfileKeys(input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return;
  }

  const profiles = (input as Record<string, unknown>).profiles;
  if (
    profiles === null ||
    typeof profiles !== "object" ||
    Array.isArray(profiles)
  ) {
    return;
  }

  const seen = new Map<string, string>();
  for (const profileId of Object.keys(profiles)) {
    if (profileId !== profileId.trim()) {
      throw new Error(
        `Profile id must not be whitespace-padded: ${JSON.stringify(profileId)}`,
      );
    }

    const normalizedId = profileId.toLowerCase();
    const existingId = seen.get(normalizedId);
    if (existingId) {
      throw new Error(
        `Duplicate profile id after normalization: ${existingId} and ${profileId}`,
      );
    }
    seen.set(normalizedId, profileId);
  }
}
