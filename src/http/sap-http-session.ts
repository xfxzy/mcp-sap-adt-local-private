import { STATUS_CODES } from "node:http";
import { type Dispatcher, request as undiciRequest } from "undici";
import type { SapSystemConfig } from "../config/types.js";
import { CookieJar } from "./cookie-jar.js";
import { SapHttpError } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";

export interface SapRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  semantic: "read" | "write";
  timeoutMs?: number;
}

export interface SapHttpResponse<T = string> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface SapHttpSessionOptions {
  system: SapSystemConfig;
  getPassword: () => Promise<string>;
  baseUrl?: string;
  dispatcher?: Dispatcher;
  maxReadRetries?: number;
  retryDelayMs?: number;
  rateLimiter?: RateLimiter;
}

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

function setCookieValues(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

export class SapHttpSession {
  readonly cookieJar = new CookieJar();
  private readonly baseUrl: string;
  private readonly maxReadRetries: number;
  private readonly retryDelayMs: number;
  private readonly rateLimiter: RateLimiter;
  private csrfToken?: string;

  constructor(private readonly options: SapHttpSessionOptions) {
    this.baseUrl =
      options.baseUrl ??
      `https://${options.system.connection.host}:${options.system.connection.port}`;
    this.maxReadRetries = options.maxReadRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.rateLimiter =
      options.rateLimiter ??
      new RateLimiter(options.system.limits.rateLimitPerMin);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getSessionId(): string | null {
    return this.cookieJar.sessionId();
  }

  async fetchCsrf(path: string): Promise<void> {
    const response = await this.request({
      method: "GET",
      path,
      semantic: "read",
      headers: {
        accept: "application/atomsvc+xml",
        "x-csrf-token": "Fetch",
      },
    });
    const token = response.headers["x-csrf-token"];
    if (typeof token === "string" && token.trim()) {
      this.csrfToken = token;
      return;
    }
    throw new Error("SAP did not return a CSRF token");
  }

  async request<T = string>(request: SapRequest): Promise<SapHttpResponse<T>> {
    if (!request.path.startsWith("/") || request.path.startsWith("//")) {
      throw new Error("SAP request path must be an absolute-path reference");
    }
    const attempts = request.semantic === "read" ? this.maxReadRetries + 1 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.requestOnce<T>(request);
        if (TRANSIENT_STATUSES.has(response.status) && attempt + 1 < attempts) {
          await this.delay(attempt);
          continue;
        }
        if (response.status >= 400) {
          throw new SapHttpError(
            response.status,
            `SAP HTTP ${response.status} ${response.statusText}`,
          );
        }
        return response;
      } catch (error) {
        lastError = error;
        if (
          error instanceof SapHttpError ||
          request.semantic === "write" ||
          attempt + 1 >= attempts
        ) {
          throw error;
        }
        await this.delay(attempt);
      }
    }
    throw lastError;
  }

  private async requestOnce<T>(
    request: SapRequest,
  ): Promise<SapHttpResponse<T>> {
    await this.rateLimiter.acquire();
    const url = new URL(request.path, this.baseUrl);
    url.searchParams.set("sap-client", this.options.system.connection.client);
    url.searchParams.set(
      "sap-language",
      this.options.system.connection.language,
    );
    const password = await this.options.getPassword();
    const headers: Record<string, string> = {
      accept: "application/xml, text/xml, application/json, text/plain",
    };
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (!["authorization", "cookie", "host"].includes(name.toLowerCase())) {
        headers[name] = value;
      }
    }
    headers.authorization = `Basic ${Buffer.from(`${this.options.system.auth.username}:${password}`, "utf8").toString("base64")}`;
    const cookie = this.cookieJar.header();
    if (cookie) headers.cookie = cookie;
    if (request.method !== "GET" && this.csrfToken) {
      headers["x-csrf-token"] = this.csrfToken;
    }
    const timeout =
      request.timeoutMs ?? this.options.system.limits.requestTimeoutMs;
    const result = await undiciRequest(url, {
      method: request.method,
      headers,
      body: request.body,
      dispatcher: this.options.dispatcher,
      headersTimeout: timeout,
      bodyTimeout: timeout,
      signal: AbortSignal.timeout(timeout),
    });
    const responseHeaders = result.headers as Record<
      string,
      string | string[] | undefined
    >;
    this.cookieJar.setCookies(setCookieValues(responseHeaders));
    const data = (await result.body.text()) as T;
    return {
      data,
      status: result.statusCode,
      statusText: STATUS_CODES[result.statusCode] ?? "Unknown Status",
      headers: responseHeaders,
    };
  }

  private async delay(attempt: number): Promise<void> {
    const milliseconds = this.retryDelayMs * 2 ** attempt;
    if (milliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
  }
}
