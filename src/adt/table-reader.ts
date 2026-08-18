import { AdtClient } from "@mcp-abap-adt/adt-clients";
import { XMLParser } from "fast-xml-parser";
import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { RateLimiter } from "../http/rate-limiter.js";
import { SapHttpSession } from "../http/sap-http-session.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";
import { AdtConnectionAdapter } from "./adt-connection-adapter.js";

export interface TableColumn {
  name: string;
  dataType?: string;
  length?: number;
  decimals?: number;
  key?: boolean;
  description?: string;
}

export interface TableStructureResult {
  tableName: string;
  columns: TableColumn[];
}

export interface TableQueryResult {
  sql: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface TableReader {
  readStructure(
    system: SapSystemConfig,
    tableName: string,
  ): Promise<TableStructureResult>;
  readQuery(
    system: SapSystemConfig,
    sql: string,
    rowLimit: number,
  ): Promise<TableQueryResult>;
}

interface AdtTableUtils {
  readObjectMetadata(
    objectType: string,
    objectName: string,
  ): Promise<{ data: unknown }>;
  getSqlQuery(params: {
    sql_query: string;
    row_number: number;
  }): Promise<{ data: unknown }>;
}

export type TableRateLimiterFactory = (system: SapSystemConfig) => RateLimiter;

export class AdtTableReader implements TableReader {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: TableRateLimiterFactory = (system) =>
      new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  async readStructure(
    system: SapSystemConfig,
    tableName: string,
  ): Promise<TableStructureResult> {
    return this.withUtils(system, async (_utils, connection) => {
      const response = await connection.makeAdtRequest({
        url: `/sap/bc/adt/datapreview/ddic/${encodeURIComponent(tableName.toUpperCase())}/metadata`,
        method: "GET",
        timeout: system.limits.requestTimeoutMs,
        headers: {
          Accept:
            "application/xml, application/vnd.sap.adt.datapreview.table.v1+xml",
        },
      });
      return parseTableStructure(response.data, tableName);
    });
  }

  async readQuery(
    system: SapSystemConfig,
    sql: string,
    rowLimit: number,
  ): Promise<TableQueryResult> {
    return this.withUtils(
      system,
      async (utils) => {
        const response = await utils.getSqlQuery({
          sql_query: toDataPreviewSql(sql),
          row_number: rowLimit,
        });
        return { sql, ...parseDataPreview(response.data) };
      },
      true,
    );
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
    operation: (
      utils: AdtTableUtils,
      connection: AdtConnectionAdapter,
    ) => Promise<T>,
    requireCsrf = false,
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
      if (requireCsrf) await connection.connect();
      return await operation(
        new AdtClient(connection).getUtils() as unknown as AdtTableUtils,
        connection,
      );
    } finally {
      await dispatcher.close();
    }
  }
}

export function toDataPreviewSql(sql: string): string {
  return sql.replace(/\s+UP\s+TO\s+\d+\s+ROWS\s*$/i, "").trimEnd();
}

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
  }).parse(value) as unknown;
}

function localName(name: string): string {
  return name.replace(/^@_/, "").split(":").at(-1)?.toLowerCase() ?? name;
}

function attribute(
  object: Record<string, unknown>,
  ...names: string[]
): unknown {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(object)) {
    if (key.startsWith("@_") && wanted.has(localName(key))) return value;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  if (value.toLowerCase() === "true" || value === "X") return true;
  if (value.toLowerCase() === "false" || value === "") return false;
  return undefined;
}

function walk(
  value: unknown,
  visit: (key: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    visit(localName(key), item);
    walk(item, visit);
  }
}

export function parseTableStructure(
  source: unknown,
  tableName: string,
): TableStructureResult {
  const columns: TableColumn[] = [];
  walk(parsed(source), (key, value) => {
    if (
      (!key.includes("field") && key !== "metadata") ||
      typeof value !== "object" ||
      value === null
    )
      return;
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const object = candidate as Record<string, unknown>;
      const name = attribute(object, "name");
      if (typeof name !== "string" || !name) continue;
      const dataType = attribute(object, "datatype", "type");
      const description = attribute(object, "description", "text");
      columns.push({
        name,
        ...(typeof dataType === "string" ? { dataType } : {}),
        ...(numberValue(attribute(object, "length")) !== undefined
          ? { length: numberValue(attribute(object, "length")) }
          : {}),
        ...(numberValue(attribute(object, "decimals")) !== undefined
          ? { decimals: numberValue(attribute(object, "decimals")) }
          : {}),
        ...(booleanValue(attribute(object, "key", "iskey", "keyattribute")) !==
        undefined
          ? {
              key: booleanValue(
                attribute(object, "key", "iskey", "keyattribute"),
              ),
            }
          : {}),
        ...(typeof description === "string" ? { description } : {}),
      });
    }
  });
  if (columns.length === 0) {
    throw new Error(`SAP table structure response is empty for ${tableName}`);
  }
  return { tableName: tableName.toUpperCase(), columns };
}

function scalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>)["#text"];
    if (text !== undefined) return scalar(text);
  }
  return JSON.stringify(value);
}

function localChild(object: Record<string, unknown>, name: string): unknown {
  for (const [key, value] of Object.entries(object)) {
    if (localName(key) === name.toLowerCase()) return value;
  }
  return undefined;
}

export function parseDataPreview(source: unknown): {
  columns: string[];
  rows: Array<Record<string, string>>;
} {
  const document = parsed(source);
  if (
    typeof document === "object" &&
    document !== null &&
    !Array.isArray(document)
  ) {
    const direct = document as { columns?: unknown; rows?: unknown };
    if (Array.isArray(direct.columns) && Array.isArray(direct.rows)) {
      const columns = direct.columns.map(scalar);
      const rows = direct.rows.map((row) => {
        if (typeof row !== "object" || row === null || Array.isArray(row))
          return {};
        return Object.fromEntries(
          columns.map((column) => [
            column,
            scalar((row as Record<string, unknown>)[column]),
          ]),
        );
      });
      return { columns, rows };
    }
  }

  const previewColumns: Array<{ name: string; values: string[] }> = [];
  walk(document, (key, value) => {
    if (key !== "columns") return;
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const column = candidate as Record<string, unknown>;
      const metadata = localChild(column, "metadata");
      if (typeof metadata !== "object" || metadata === null) continue;
      const name = attribute(metadata as Record<string, unknown>, "name");
      if (typeof name !== "string" || !name) continue;
      const dataSet = localChild(column, "dataset");
      const rawValues =
        typeof dataSet === "object" && dataSet !== null
          ? localChild(dataSet as Record<string, unknown>, "data")
          : undefined;
      previewColumns.push({
        name,
        values: (Array.isArray(rawValues) ? rawValues : [rawValues])
          .filter((item) => item !== undefined)
          .map(scalar),
      });
    }
  });
  if (previewColumns.length > 0) {
    const columns = previewColumns.map((column) => column.name);
    const rowCount = Math.max(
      0,
      ...previewColumns.map((column) => column.values.length),
    );
    const rows = Array.from({ length: rowCount }, (_unused, rowIndex) =>
      Object.fromEntries(
        previewColumns.map((column) => [
          column.name,
          column.values[rowIndex] ?? "",
        ]),
      ),
    );
    return { columns, rows };
  }

  const columns: string[] = [];
  const rowNodes: unknown[] = [];
  walk(document, (key, value) => {
    if (key === "column") {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        if (typeof candidate !== "object" || candidate === null) continue;
        const name = attribute(candidate as Record<string, unknown>, "name");
        if (typeof name === "string" && !columns.includes(name))
          columns.push(name);
      }
    }
    if (key === "row")
      rowNodes.push(...(Array.isArray(value) ? value : [value]));
  });
  const rows = rowNodes.map((rowNode) => {
    const values: string[] = [];
    walk(rowNode, (key, value) => {
      if (key === "value" || key === "cell") {
        for (const candidate of Array.isArray(value) ? value : [value]) {
          values.push(scalar(candidate));
        }
      }
    });
    return Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    );
  });
  if (columns.length === 0)
    throw new Error("SAP data preview response has no columns");
  return { columns, rows };
}
