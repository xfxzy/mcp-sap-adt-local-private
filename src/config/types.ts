export type SapEnvironment = "production" | "non-production";

export type TlsConfig =
  | { mode: "strict" }
  | { mode: "custom-ca"; caFile: string }
  | {
      mode: "pinned";
      fingerprintSha256: string;
      allowExpired: boolean;
    }
  | { mode: "insecure" };

export interface SapSystemConfig {
  id: string;
  label: string;
  kind: string;
  environment: SapEnvironment;
  connection: {
    protocol: "https";
    host: string;
    port: number;
    client: string;
    language: string;
    serverTimezone: string;
  };
  auth: {
    type: "basic";
    username: string;
    credentialRef: string;
  };
  tls: TlsConfig;
  access: {
    read: boolean;
    adtDevelopmentWrite: boolean;
    businessApiWrite: boolean;
  };
  development: {
    objectNamePatterns: string[];
    requireTransport: boolean;
  };
  businessApis: {
    enabledProfiles: string[];
  };
  limits: {
    requestTimeoutMs: number;
    rateLimitPerMin: number;
    maxSourceLines: number;
  };
}

export interface SystemsConfig {
  version: 1;
  systems: SapSystemConfig[];
}
