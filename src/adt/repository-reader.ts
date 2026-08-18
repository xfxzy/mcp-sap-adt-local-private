import { AdtClient } from "@mcp-abap-adt/adt-clients";
import type {
  ISearchResult,
  IWhereUsedListResult,
} from "@mcp-abap-adt/interfaces";
import { XMLParser } from "fast-xml-parser";
import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { RateLimiter } from "../http/rate-limiter.js";
import { SapHttpSession } from "../http/sap-http-session.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";
import { AdtConnectionAdapter } from "./adt-connection-adapter.js";
import { optionalAdtUri, requireAdtUri } from "./adt-uri.js";

export interface RepositorySearchParams {
  query: string;
  objectType?: string;
  maxResults: number;
}

export interface RepositorySearchResult {
  name: string;
  type: string;
  uri?: string;
  packageName?: string;
  description?: string;
}

export interface RepositorySourceParams {
  objectType: string;
  objectName: string;
  functionGroup?: string;
  version: "active" | "inactive";
}

export interface RepositorySourceResult {
  source: string;
  uri?: string;
}

export interface RepositoryStructureResult {
  structure: RepositoryStructureNode;
  uri?: string;
}

export interface RepositoryStructureNode {
  name: string;
  attributes: Record<string, string>;
  text?: string;
  children: RepositoryStructureNode[];
}

export interface RepositoryWhereUsedParams {
  objectType: string;
  objectName: string;
  maxResults: number;
}

export interface RepositoryWhereUsedResult {
  references: RepositorySearchResult[];
}

export interface RepositoryReader {
  search(
    system: SapSystemConfig,
    params: RepositorySearchParams,
  ): Promise<RepositorySearchResult[]>;
  readSource(
    system: SapSystemConfig,
    params: RepositorySourceParams,
  ): Promise<RepositorySourceResult>;
  getObjectStructure(
    system: SapSystemConfig,
    objectType: string,
    objectName: string,
  ): Promise<RepositoryStructureResult>;
  whereUsed(
    system: SapSystemConfig,
    params: RepositoryWhereUsedParams,
  ): Promise<RepositoryWhereUsedResult>;
}

export interface AdtRepositoryUtils {
  search(params: {
    query: string;
    objectType?: string;
    maxResults?: number;
  }): Promise<ISearchResult[]>;
  readObjectSource(
    objectType: string,
    objectName: string,
    functionGroup?: string,
    version?: "active" | "inactive",
  ): Promise<{ data: unknown; headers?: Record<string, unknown> }>;
  getObjectStructure(
    objectType: string,
    objectName: string,
  ): Promise<{ data: unknown; headers?: Record<string, unknown> }>;
  getWhereUsedList(params: {
    object_name: string;
    object_type: string;
    includeRawXml?: boolean;
  }): Promise<IWhereUsedListResult>;
}

export type RepositoryRateLimiterFactory = (
  system: SapSystemConfig,
) => RateLimiter;

export class AdtRepositoryReader implements RepositoryReader {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: RepositoryRateLimiterFactory = (
      system,
    ) => new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  async search(
    system: SapSystemConfig,
    params: RepositorySearchParams,
  ): Promise<RepositorySearchResult[]> {
    return this.withUtils(system, async (utils) =>
      (await utils.search(params))
        .slice(0, params.maxResults)
        .map(normalizeSearchResult),
    );
  }

  async readSource(
    system: SapSystemConfig,
    params: RepositorySourceParams,
  ): Promise<RepositorySourceResult> {
    return this.withUtils(system, async (utils) => {
      const response = await utils.readObjectSource(
        params.objectType,
        params.objectName,
        params.functionGroup,
        params.version,
      );
      const uri = optionalAdtUri(
        headerValue(response.headers, "content-location"),
      );
      return {
        source: asText(response.data),
        ...(uri ? { uri } : {}),
      };
    });
  }

  async getObjectStructure(
    system: SapSystemConfig,
    objectType: string,
    objectName: string,
  ): Promise<RepositoryStructureResult> {
    return this.withUtils(system, async (utils) => {
      const response = await utils.getObjectStructure(objectType, objectName);
      const uri = optionalAdtUri(
        headerValue(response.headers, "content-location"),
      );
      return {
        structure: parseObjectStructure(response.data),
        ...(uri ? { uri } : {}),
      };
    });
  }

  async whereUsed(
    system: SapSystemConfig,
    params: RepositoryWhereUsedParams,
  ): Promise<RepositoryWhereUsedResult> {
    return this.withUtils(system, async (utils) => {
      const response = await utils.getWhereUsedList({
        object_name: params.objectName,
        object_type: params.objectType,
      });
      return {
        references: response.references
          .slice(0, params.maxResults)
          .map(normalizeSearchResult),
      };
    });
  }

  private rateLimiter(system: SapSystemConfig): RateLimiter {
    const existing = this.rateLimiters.get(system.id);
    if (existing) return existing;
    const created = this.createRateLimiter(system);
    this.rateLimiters.set(system.id, created);
    return created;
  }

  private async withUtils<T>(
    system: SapSystemConfig,
    operation: (utils: AdtRepositoryUtils) => Promise<T>,
  ): Promise<T> {
    const password = await this.credentials.get(system.auth.credentialRef);
    if (!password) {
      throw new Error(
        `Credential is not configured for SAP system ${system.id}`,
      );
    }
    const dispatcher = createSapDispatcher(system);
    try {
      const session = new SapHttpSession({
        system,
        dispatcher,
        getPassword: async () => password,
        rateLimiter: this.rateLimiter(system),
      });
      const connection = new AdtConnectionAdapter(session);
      const client = new AdtClient(connection);
      return await operation(
        client.getUtils() as unknown as AdtRepositoryUtils,
      );
    } finally {
      await dispatcher.close();
    }
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function localName(name: string): string {
  return name.split(":").at(-1) ?? name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("SAP object structure contains a non-scalar value");
}

function structureNode(name: string, value: unknown): RepositoryStructureNode {
  const attributes: Record<string, string> = {};
  const children: RepositoryStructureNode[] = [];
  let text: string | undefined;
  const object = isRecord(value) ? value : { "#text": value };

  for (const [key, item] of Object.entries(object)) {
    if (key.startsWith("@_")) {
      if (key === "@_xmlns" || key.startsWith("@_xmlns:")) continue;
      const attributeName = localName(key.slice(2));
      const attributeValue = scalar(item);
      attributes[attributeName] =
        attributeName.toLowerCase().endsWith("uri") ||
        attributeName.toLowerCase() === "href"
          ? requireAdtUri(attributeValue)
          : attributeValue;
      continue;
    }
    if (key === "#text") {
      const candidate = scalar(item).trim();
      if (candidate) text = candidate;
      continue;
    }
    for (const child of Array.isArray(item) ? item : [item]) {
      children.push(structureNode(localName(key), child));
    }
  }

  return {
    name: localName(name),
    attributes,
    ...(text ? { text } : {}),
    children,
  };
}

function parseObjectStructure(value: unknown): RepositoryStructureNode {
  const document =
    typeof value === "string"
      ? (new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
          parseAttributeValue: false,
          parseTagValue: false,
          trimValues: true,
        }).parse(value) as unknown)
      : value;
  if (!isRecord(document)) {
    throw new Error("SAP object structure response is invalid");
  }
  const root = Object.entries(document).find(
    ([key]) => key !== "?xml" && !key.startsWith("@_") && key !== "#text",
  );
  if (!root) {
    throw new Error("SAP object structure response is empty");
  }
  return structureNode(root[0], root[1]);
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function normalizeSearchResult(result: {
  name: string;
  type: string;
  uri?: string;
  packageName?: string;
  description?: string;
}): RepositorySearchResult {
  const uri = optionalAdtUri(result.uri);
  return {
    name: result.name,
    type: result.type,
    ...(uri ? { uri } : {}),
    ...(result.packageName ? { packageName: result.packageName } : {}),
    ...(result.description ? { description: result.description } : {}),
  };
}
