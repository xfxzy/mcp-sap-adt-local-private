import { XMLParser } from "fast-xml-parser";
import type {
  ODataFunctionImport,
  ODataProperty,
  ODataServiceModel,
} from "./metadata-types.js";

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function stringAttribute(value: unknown, name: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const attributes = value as Record<string, unknown>;
  const direct = attributes[`@_${name}`];
  if (typeof direct === "string") return direct;
  for (const [key, entry] of Object.entries(attributes)) {
    if (key.startsWith("@_") && localName(key) === name) {
      return typeof entry === "string" ? entry : undefined;
    }
  }
  return undefined;
}

function numberAttribute(value: unknown, name: string): number | undefined {
  const raw = stringAttribute(value, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanAttribute(
  value: unknown,
  name: string,
  fallback: boolean,
): boolean {
  const raw = stringAttribute(value, name);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() !== "false";
}

function localName(name: string): string {
  const index = name.indexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

function collectSchemas(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) return [];
  const root = value as Record<string, unknown>;
  const schemas: Array<Record<string, unknown>> = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const object = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      if (localName(key) === "Schema") {
        for (const schema of arrayOf(child as Record<string, unknown>)) {
          if (typeof schema === "object" && schema !== null)
            schemas.push(schema as Record<string, unknown>);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return schemas;
}

export function parseODataMetadata(xml: string): ODataServiceModel {
  if (!xml.trim()) throw new Error("OData metadata response is empty");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  }).parse(xml) as unknown;
  const model: ODataServiceModel = {
    entitySets: {},
    entityTypes: {},
    functionImports: {},
  };
  for (const schema of collectSchemas(parsed)) {
    const namespace = stringAttribute(schema, "Namespace") ?? "";
    for (const rawEntityType of arrayOf(
      schema.EntityType as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    )) {
      if (typeof rawEntityType !== "object" || rawEntityType === null) continue;
      const name = stringAttribute(rawEntityType, "Name");
      if (!name) continue;
      const qualifiedName = namespace ? `${namespace}.${name}` : name;
      const keyNode = rawEntityType.Key as Record<string, unknown> | undefined;
      const keys = arrayOf(
        keyNode?.PropertyRef as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      )
        .map((ref) => stringAttribute(ref, "Name"))
        .filter((key): key is string => Boolean(key));
      const properties: Record<string, ODataProperty> = {};
      for (const rawProperty of arrayOf(
        rawEntityType.Property as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      )) {
        if (typeof rawProperty !== "object" || rawProperty === null) continue;
        const propertyName = stringAttribute(rawProperty, "Name");
        const type = stringAttribute(rawProperty, "Type");
        if (!propertyName || !type) continue;
        properties[propertyName] = {
          name: propertyName,
          type,
          nullable: booleanAttribute(rawProperty, "Nullable", true),
          maxLength: numberAttribute(rawProperty, "MaxLength"),
          precision: numberAttribute(rawProperty, "Precision"),
          scale: numberAttribute(rawProperty, "Scale"),
        };
      }
      model.entityTypes[qualifiedName] = {
        name: qualifiedName,
        keys,
        properties,
      };
    }
    for (const rawContainer of arrayOf(
      schema.EntityContainer as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    )) {
      if (typeof rawContainer !== "object" || rawContainer === null) continue;
      for (const rawSet of arrayOf(
        rawContainer.EntitySet as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      )) {
        if (typeof rawSet !== "object" || rawSet === null) continue;
        const name = stringAttribute(rawSet, "Name");
        const entityType = stringAttribute(rawSet, "EntityType");
        if (name && entityType) model.entitySets[name] = { name, entityType };
      }
      for (const rawImport of arrayOf(
        rawContainer.FunctionImport as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      )) {
        if (typeof rawImport !== "object" || rawImport === null) continue;
        const name = stringAttribute(rawImport, "Name");
        if (!name) continue;
        const entry: ODataFunctionImport = {
          name,
          httpMethod: stringAttribute(rawImport, "HttpMethod"),
          returnType: stringAttribute(rawImport, "ReturnType"),
        };
        model.functionImports[name] = entry;
      }
    }
  }
  if (
    Object.keys(model.entitySets).length === 0 &&
    Object.keys(model.entityTypes).length === 0
  ) {
    throw new Error("OData metadata contains no CSDL entity model");
  }
  return model;
}
