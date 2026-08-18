import { AdtClient, AdtRuntimeClient } from "@mcp-abap-adt/adt-clients";
import { XMLParser } from "fast-xml-parser";
import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { RateLimiter } from "../http/rate-limiter.js";
import { SapHttpSession } from "../http/sap-http-session.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";
import { AdtConnectionAdapter } from "./adt-connection-adapter.js";
import { optionalAdtUri } from "./adt-uri.js";

export interface RuntimeFeedParams {
  user?: string;
  from?: string;
  to?: string;
  maxResults: number;
}

export interface RuntimeDumpSummary {
  id: string;
  title: string;
  updatedAt: string;
  uri?: string;
  summary: string;
  user?: string;
  category?: string;
}

export interface RuntimeDumpDetail {
  dumpId: string;
  view: "default" | "summary" | "formatted";
  content: string;
  contentType?: string;
}

export interface SystemMessageSummary {
  id: string;
  title: string;
  text: string;
  severity: string;
  validFrom: string;
  validTo: string;
  createdBy: string;
}

export interface GatewayErrorSummary {
  type: string;
  shortText: string;
  transactionId: string;
  packageName?: string;
  applicationComponent?: string;
  occurredAt: string;
  username?: string;
  client?: string;
  requestKind?: string;
}

export interface TransportListParams {
  user: string;
  status?: string;
  dateRange?: string;
  targetSystem?: string;
  requestType?: string;
}

export interface TransportSummary {
  number: string;
  description?: string;
  owner?: string;
  status?: string;
  targetSystem?: string;
  type?: string;
  changedAt?: string;
}

export interface RuntimeReader {
  listDumps(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: RuntimeDumpSummary[] }>;
  readDumpDetail(
    system: SapSystemConfig,
    params: {
      dumpId: string;
      view: "default" | "summary" | "formatted";
    },
  ): Promise<RuntimeDumpDetail>;
  readSystemMessages(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: SystemMessageSummary[] }>;
  readHttpLog(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: GatewayErrorSummary[] }>;
  listTransports(
    system: SapSystemConfig,
    params: TransportListParams,
  ): Promise<{ items: TransportSummary[] }>;
}

interface AdtResponseLike {
  data: unknown;
  headers?: Record<string, unknown>;
}

interface RuntimeClients {
  runtime: AdtRuntimeClient;
  adt: AdtClient;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isRecord(value) && value["#text"] !== undefined) {
    return stringValue(value["#text"]);
  }
  return "";
}

function parseXml(source: unknown): Record<string, unknown> {
  const text = sourceText(source);
  if (!text.trim()) return {};
  const parsed = xmlParser.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error("SAP runtime response is invalid");
  return parsed;
}

function sourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (source instanceof Uint8Array) return new TextDecoder().decode(source);
  if (source === undefined || source === null) return "";
  return JSON.stringify(source);
}

function atomEntries(source: unknown): Array<Record<string, unknown>> {
  const document = parseXml(source);
  const feed = isRecord(document.feed) ? document.feed : undefined;
  return asArray(feed?.entry).filter(isRecord);
}

function childString(
  node: Record<string, unknown>,
  ...names: string[]
): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(node)) {
    const local = key.replace(/^@_/, "").split(":").at(-1)?.toLowerCase();
    if (local && wanted.has(local)) return stringValue(value);
  }
  return "";
}

function linkUri(entry: Record<string, unknown>): string | undefined {
  for (const link of asArray(entry.link)) {
    if (!isRecord(link)) continue;
    const uri = stringValue(link["@_href"]);
    if (uri) return optionalAdtUri(uri);
  }
  return undefined;
}

export function normalizeSapTimestamp(value: string): string {
  const timestamp = value.trim();
  if (!timestamp) return "";
  if (/^\d{14}$/.test(timestamp)) {
    return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}`;
  }
  const milliseconds = Date.parse(timestamp);
  return Number.isNaN(milliseconds)
    ? timestamp
    : new Date(milliseconds).toISOString();
}

export function parseDumpFeed(source: unknown): RuntimeDumpSummary[] {
  return atomEntries(source).map((entry) => {
    const uri = linkUri(entry);
    const user = isRecord(entry.author)
      ? childString(entry.author, "name")
      : "";
    const category = isRecord(entry.category)
      ? childString(entry.category, "term")
      : stringValue(entry.category);
    return {
      id: stringValue(entry.id),
      title: stringValue(entry.title),
      updatedAt: normalizeSapTimestamp(stringValue(entry.updated)),
      ...(uri ? { uri } : {}),
      summary: stringValue(entry.content),
      ...(user ? { user } : {}),
      ...(category ? { category } : {}),
    };
  });
}

export function parseSystemMessageFeed(
  source: unknown,
): SystemMessageSummary[] {
  return atomEntries(source).map((entry) => ({
    id: stringValue(entry.id),
    title: stringValue(entry.title),
    text: stringValue(entry.content),
    severity:
      childString(entry, "severity") ||
      (isRecord(entry.category) ? childString(entry.category, "term") : ""),
    validFrom: normalizeSapTimestamp(
      childString(entry, "validFrom") || stringValue(entry.updated),
    ),
    validTo: normalizeSapTimestamp(childString(entry, "validTo")),
    createdBy: isRecord(entry.author) ? childString(entry.author, "name") : "",
  }));
}

export function parseGatewayErrorFeed(source: unknown): GatewayErrorSummary[] {
  return atomEntries(source).map((entry) => {
    const category = isRecord(entry.category)
      ? childString(entry.category, "term")
      : stringValue(entry.category);
    const packageName = childString(entry, "package");
    const applicationComponent = childString(entry, "applicationComponent");
    const username = isRecord(entry.author)
      ? childString(entry.author, "name")
      : "";
    const client = childString(entry, "client");
    const requestKind = childString(entry, "requestKind");
    return {
      type: category,
      shortText: stringValue(entry.title),
      transactionId: stringValue(entry.id),
      ...(packageName ? { packageName } : {}),
      ...(applicationComponent ? { applicationComponent } : {}),
      occurredAt: normalizeSapTimestamp(stringValue(entry.updated)),
      ...(username ? { username } : {}),
      ...(client ? { client } : {}),
      ...(requestKind ? { requestKind } : {}),
    };
  });
}

function transportNodes(value: unknown, parentKey = ""): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => transportNodes(item, parentKey));
  }
  if (!isRecord(value)) return [];
  const nodes: unknown[] = [];
  for (const [key, item] of Object.entries(value)) {
    const local = key.split(":").at(-1)?.toLowerCase() ?? key.toLowerCase();
    if (local === "transportrequest" || local === "request") {
      nodes.push(...asArray(item));
    } else {
      nodes.push(...transportNodes(item, local));
    }
  }
  return nodes;
}

export function parseTransportList(source: unknown): TransportSummary[] {
  return transportNodes(parseXml(source))
    .filter(isRecord)
    .flatMap((node) => {
      const number = childString(
        node,
        "number",
        "transportNumber",
        "requestNumber",
        "id",
      );
      if (!number) return [];
      const description = childString(node, "description", "text", "title");
      const owner = childString(node, "owner", "user");
      const status = childString(node, "status");
      const targetSystem = childString(node, "targetSystem", "target");
      const type = childString(node, "type", "requestType");
      const changed = childString(
        node,
        "changedAt",
        "changed",
        "updated",
        "date",
      );
      return [
        {
          number,
          ...(description ? { description } : {}),
          ...(owner ? { owner } : {}),
          ...(status ? { status } : {}),
          ...(targetSystem ? { targetSystem } : {}),
          ...(type ? { type } : {}),
          ...(changed ? { changedAt: normalizeSapTimestamp(changed) } : {}),
        },
      ];
    });
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value.map(String).join(", ");
  return typeof value === "string" ? value : undefined;
}

export type RuntimeRateLimiterFactory = (
  system: SapSystemConfig,
) => RateLimiter;

export class AdtRuntimeReader implements RuntimeReader {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: RuntimeRateLimiterFactory = (system) =>
      new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  async listDumps(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: RuntimeDumpSummary[] }> {
    return this.withClients(system, async ({ runtime }) => {
      const options = {
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.maxResults ? { top: params.maxResults } : {}),
      };
      const response = params.user
        ? await runtime.getDumps().listByUser(params.user, options)
        : await runtime.getDumps().list(options);
      return { items: parseDumpFeed(response.data) };
    });
  }

  async readDumpDetail(
    system: SapSystemConfig,
    params: {
      dumpId: string;
      view: "default" | "summary" | "formatted";
    },
  ): Promise<RuntimeDumpDetail> {
    return this.withClients(system, async ({ runtime }) => {
      const response = (await runtime
        .getDumps()
        .getById(params.dumpId, { view: params.view })) as AdtResponseLike;
      const contentType = headerValue(response.headers, "content-type");
      return {
        dumpId: params.dumpId,
        view: params.view,
        content: sourceText(response.data),
        ...(contentType ? { contentType } : {}),
      };
    });
  }

  async readSystemMessages(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: SystemMessageSummary[] }> {
    return this.withClients(system, async ({ runtime }) => {
      const response = await runtime.getSystemMessages().list({
        ...(params.user ? { user: params.user } : {}),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.maxResults ? { maxResults: params.maxResults } : {}),
      });
      return { items: parseSystemMessageFeed(response.data) };
    });
  }

  async readHttpLog(
    system: SapSystemConfig,
    params: Partial<RuntimeFeedParams>,
  ): Promise<{ items: GatewayErrorSummary[] }> {
    return this.withClients(system, async ({ runtime }) => {
      const response = await runtime.getGatewayErrorLog().list({
        ...(params.user ? { user: params.user } : {}),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.maxResults ? { maxResults: params.maxResults } : {}),
      });
      return { items: parseGatewayErrorFeed(response.data) };
    });
  }

  async listTransports(
    system: SapSystemConfig,
    params: TransportListParams,
  ): Promise<{ items: TransportSummary[] }> {
    return this.withClients(system, async ({ adt }) => {
      const state = await adt.getRequest().list(params);
      const response = state.listResult as AdtResponseLike | undefined;
      return { items: parseTransportList(response?.data) };
    });
  }

  private rateLimiter(system: SapSystemConfig): RateLimiter {
    const existing = this.rateLimiters.get(system.id);
    if (existing) return existing;
    const created = this.createRateLimiter(system);
    this.rateLimiters.set(system.id, created);
    return created;
  }

  private async withClients<T>(
    system: SapSystemConfig,
    operation: (clients: RuntimeClients) => Promise<T>,
  ): Promise<T> {
    const password = await this.credentials.get(system.auth.credentialRef);
    if (!password) {
      throw new Error(
        `Credential is not configured for SAP system ${system.id}`,
      );
    }
    const dispatcher = createSapDispatcher(system);
    try {
      const connection = new AdtConnectionAdapter(
        new SapHttpSession({
          system,
          dispatcher,
          getPassword: async () => password,
          rateLimiter: this.rateLimiter(system),
        }),
      );
      return await operation({
        runtime: new AdtRuntimeClient(connection),
        adt: new AdtClient(connection),
      });
    } finally {
      await dispatcher.close();
    }
  }
}
