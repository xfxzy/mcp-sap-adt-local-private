import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { SapSystemConfig } from "../../src/config/types.js";
import { SapHttpSession } from "../../src/http/sap-http-session.js";

export interface FixtureResponse {
  status: number;
  headers?: Record<string, string | string[]>;
  body?: string;
}

export interface SapFixtureOptions {
  handler?: (request: IncomingMessage, response: ServerResponse) => void;
  responses?: Array<number | FixtureResponse>;
}

export interface SapFixture {
  baseUrl: string;
  close(): Promise<void>;
  createSession(): SapHttpSession;
  lastHeaders: Record<string, string | string[] | undefined>;
  lastUrl: URL;
  methods: string[];
  requestCount: number;
  server: Server;
}

function fixtureSystem(port: number): SapSystemConfig {
  return {
    id: "FIXTURE",
    label: "SAP fixture",
    kind: "fixture",
    environment: "non-production",
    connection: {
      protocol: "https",
      host: "127.0.0.1",
      port,
      client: "400",
      language: "1",
      serverTimezone: "UTC",
    },
    auth: { type: "basic", username: "fixture", credentialRef: "FIXTURE" },
    tls: { mode: "strict" },
    access: {
      read: true,
      adtDevelopmentWrite: true,
      businessApiWrite: true,
    },
    development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 5000,
      rateLimitPerMin: 600,
      maxSourceLines: 5000,
    },
  };
}

export async function startSapFixture(
  options: SapFixtureOptions = {},
): Promise<SapFixture> {
  const state = {
    requestCount: 0,
    lastUrl: new URL("http://127.0.0.1/"),
    lastHeaders: {} as Record<string, string | string[] | undefined>,
    methods: [] as string[],
  };
  const responses = [...(options.responses ?? [])];
  const server = createServer((request, response) => {
    state.requestCount += 1;
    state.methods.push(request.method ?? "");
    state.lastUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    state.lastHeaders = request.headers;

    if (options.handler) {
      options.handler(request, response);
      return;
    }
    const configured = responses.shift() ?? 200;
    const fixtureResponse: FixtureResponse =
      typeof configured === "number" ? { status: configured } : configured;
    response.writeHead(fixtureResponse.status, fixtureResponse.headers);
    response.end(fixtureResponse.body ?? "ok");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    server,
    get requestCount() {
      return state.requestCount;
    },
    get lastUrl() {
      return state.lastUrl;
    },
    get lastHeaders() {
      return state.lastHeaders;
    },
    get methods() {
      return state.methods;
    },
    createSession() {
      return new SapHttpSession({
        system: fixtureSystem(address.port),
        baseUrl,
        getPassword: async () => "fixture-password",
        retryDelayMs: 0,
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
