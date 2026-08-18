import type { BusinessApiService } from "../business-api/schema.js";
import type { ODataServiceModel } from "./metadata-types.js";

export function validateServiceProfile(
  service: BusinessApiService,
  model: ODataServiceModel,
): void {
  for (const configuredEntity of service.entities) {
    const set = model.entitySets[configuredEntity.entitySet];
    if (!set)
      throw new Error(
        `Allowlisted entity set is absent from live metadata: ${configuredEntity.entitySet}`,
      );
    const type = model.entityTypes[set.entityType];
    if (!type)
      throw new Error(
        `Entity type is absent from live metadata: ${set.entityType}`,
      );
    const actualKeys = new Set(type.keys);
    for (const key of configuredEntity.keys) {
      if (!actualKeys.has(key))
        throw new Error(`Unknown key ${key} on ${configuredEntity.entitySet}`);
    }
    if (
      configuredEntity.keys.length !== type.keys.length ||
      configuredEntity.keys.some((key, i) => key !== type.keys[i])
    ) {
      throw new Error(
        `Allowlisted keys do not match live metadata for ${configuredEntity.entitySet}`,
      );
    }
    for (const field of [
      ...configuredEntity.mutableFields,
      ...configuredEntity.immutableFields,
      ...configuredEntity.sensitiveFields,
      ...configuredEntity.verifyFields,
    ]) {
      if (!type.properties[field])
        throw new Error(
          `UnknownField ${field} on ${configuredEntity.entitySet}`,
        );
    }
    for (const key of type.keys) {
      if (!configuredEntity.immutableFields.includes(key))
        throw new Error(
          `Key ${key} must be immutable on ${configuredEntity.entitySet}`,
        );
    }
    for (const operation of configuredEntity.operations) {
      if (!operation.startsWith("action:")) continue;
      const action = model.functionImports[operation.slice("action:".length)];
      if (!action) {
        throw new Error(
          `Allowlisted action is absent from live metadata: ${operation}`,
        );
      }
      if (action.httpMethod?.toUpperCase() !== "POST") {
        throw new Error(`Allowlisted action must use POST: ${operation}`);
      }
    }
  }
}
