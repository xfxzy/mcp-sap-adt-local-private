import type {
  IAbapConnection,
  IAbapRequestOptions,
  IAdtResponse,
} from "@mcp-abap-adt/interfaces";
import type { SapHttpSession, SapRequest } from "../http/sap-http-session.js";

export type AdtSemanticClassifier = (
  options: IAbapRequestOptions,
) => SapRequest["semantic"];

function appendParams(url: URL, params: unknown): void {
  if (params === undefined || params === null) return;
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("ADT request params must be an object");
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
}

function requestBody(data: unknown): string | Uint8Array | undefined {
  if (data === undefined) return undefined;
  if (typeof data === "string" || data instanceof Uint8Array) return data;
  return JSON.stringify(data);
}

export class AdtConnectionAdapter implements IAbapConnection {
  private sessionType: "stateful" | "stateless" = "stateless";

  constructor(
    private readonly session: SapHttpSession,
    private readonly classifySemantic: AdtSemanticClassifier = () => "read",
  ) {}

  async connect(): Promise<void> {
    await this.session.fetchCsrf("/sap/bc/adt/discovery");
  }

  async getBaseUrl(): Promise<string> {
    return this.session.getBaseUrl();
  }

  getSessionId(): string | null {
    return this.session.getSessionId();
  }

  setSessionType(type: "stateful" | "stateless"): void {
    this.sessionType = type;
  }

  async makeAdtRequest<T = unknown, D = unknown>(
    options: IAbapRequestOptions,
  ): Promise<IAdtResponse<T, D>> {
    const method = options.method.toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH"].includes(method)) {
      throw new Error(`Unsupported ADT method: ${method}`);
    }
    const baseUrl = await this.getBaseUrl();
    const url = new URL(options.url, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) {
      throw new Error("ADT request URL must target the configured SAP system");
    }
    appendParams(url, options.params);
    const relativePath = `${url.pathname}${url.search}`;
    const response = await this.session.request<T>({
      method: method as SapRequest["method"],
      path: relativePath,
      headers: {
        "x-sap-adt-sessiontype": this.sessionType,
        ...options.headers,
      },
      body: requestBody(options.data),
      semantic: this.classifySemantic(options),
      timeoutMs: options.timeout,
    });
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      config: options as D,
    };
  }
}
