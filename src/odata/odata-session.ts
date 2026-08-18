import type { Dispatcher } from "undici";
import type { SapSystemConfig } from "../config/types.js";
import {
  type SapHttpResponse,
  SapHttpSession,
} from "../http/sap-http-session.js";
import type { ODataProperty } from "./metadata-types.js";
import { entityPath } from "./odata-path.js";

export interface ODataSessionOptions {
  system: SapSystemConfig;
  getPassword: () => Promise<string>;
  dispatcher?: Dispatcher;
}

export interface ODataEntityRequest {
  serviceRoot: string;
  entitySet: string;
  keys: Record<string, unknown>;
  keyTypes: Record<string, ODataProperty | string>;
  keyOrder?: string[];
  fields?: string[];
}

function unwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  if ("d" in object) return unwrap(object.d);
  if ("results" in object) return object.results;
  return value;
}

export class ODataSession {
  constructor(private readonly http: SapHttpSession) {}

  static create(options: ODataSessionOptions): ODataSession {
    return new ODataSession(new SapHttpSession(options));
  }

  async metadata(serviceRoot: string): Promise<string> {
    return (
      await this.http.request<string>({
        method: "GET",
        path: `${serviceRoot}$metadata`,
        semantic: "read",
        headers: { accept: "application/xml" },
      })
    ).data;
  }

  async getEntity(request: ODataEntityRequest): Promise<{
    data: unknown;
    etag?: string;
    response: SapHttpResponse<string>;
  }> {
    if (
      request.fields?.some((field) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
    ) {
      throw new Error("Invalid OData projection field");
    }
    const path = `${request.serviceRoot}${entityPath(request.entitySet, request.keys, request.keyTypes, request.keyOrder)}${request.fields?.length ? `?$select=${request.fields.join(",")}` : ""}`;
    const response = await this.http.request<string>({
      method: "GET",
      path,
      semantic: "read",
      headers: { accept: "application/json" },
    });
    return {
      data: parseJson(response.data),
      etag: header(response.headers, "etag"),
      response,
    };
  }

  async createEntity(
    serviceRoot: string,
    entitySet: string,
    payload: Record<string, unknown>,
  ): Promise<{ data: unknown; etag?: string }> {
    await this.http.fetchCsrf(serviceRoot);
    const response = await this.http.request<string>({
      method: "POST",
      path: serviceRoot + entitySet,
      semantic: "write",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return {
      data: parseJson(response.data),
      etag: header(response.headers, "etag"),
    };
  }

  async patchEntity(
    request: ODataEntityRequest & {
      payload: Record<string, unknown>;
      etag?: string;
    },
  ): Promise<{ data: unknown; etag?: string }> {
    await this.http.fetchCsrf(request.serviceRoot);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (request.etag) headers["if-match"] = request.etag;
    const path = `${request.serviceRoot}${entityPath(request.entitySet, request.keys, request.keyTypes, request.keyOrder)}`;
    const response = await this.http.request<string>({
      method: "PATCH",
      path,
      semantic: "write",
      headers,
      body: JSON.stringify(request.payload),
    });
    return {
      data: parseJson(response.data),
      etag: header(response.headers, "etag"),
    };
  }

  async action(
    serviceRoot: string,
    actionName: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ data: unknown }> {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(actionName))
      throw new Error("Invalid OData action name");
    await this.http.fetchCsrf(serviceRoot);
    const response = await this.http.request<string>({
      method: "POST",
      path: `${serviceRoot}${actionName}`,
      semantic: "write",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return { data: parseJson(response.data) };
  }

  getSessionId(): string | null {
    return this.http.getSessionId();
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(source: string): unknown {
  if (!source.trim()) return null;
  try {
    return unwrap(JSON.parse(source) as unknown);
  } catch {
    return source;
  }
}
