import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditLog, FileAppendOnlyWriter } from "../audit/audit-log.js";
import { loadBusinessApis } from "../business-api/load-business-apis.js";
import type { BusinessApisConfig } from "../business-api/schema.js";
import { loadSystemsConfig } from "../config/load-config.js";
import type { SystemsConfig } from "../config/types.js";
import {
  CredentialStore,
  NodeCredentialFiles,
} from "../credentials/credential-store.js";
import { DpapiRunner } from "../credentials/dpapi-runner.js";

export interface RuntimeContext {
  config: SystemsConfig;
  businessApis?: BusinessApisConfig;
  credentialStore: CredentialStore;
  audit: AuditLog;
  configPath: string;
}

export interface RuntimeContextOptions {
  configPath?: string;
  businessApisPath?: string;
  credentialsPath?: string;
  auditPath?: string;
}

function localDataRoot(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA;
  if (!base) {
    throw new Error("LOCALAPPDATA or APPDATA is required on Windows");
  }
  return join(base, "mcp-sap-adt-local");
}

export function defaultSystemsConfigPath(): string {
  return resolve(
    process.env.MCP_SAP_SYSTEMS_CONFIG ??
      fileURLToPath(new URL("../../config/systems.yaml", import.meta.url)),
  );
}

export function defaultBusinessApisConfigPath(): string {
  return resolve(
    process.env.MCP_SAP_BUSINESS_APIS_CONFIG ??
      fileURLToPath(
        new URL("../../config/business-apis.yaml", import.meta.url),
      ),
  );
}

export async function createRuntimeContext(
  options: RuntimeContextOptions = {},
): Promise<RuntimeContext> {
  const dataRoot = localDataRoot();
  const configPath = resolve(options.configPath ?? defaultSystemsConfigPath());
  const businessApisPath = resolve(
    options.businessApisPath ?? defaultBusinessApisConfigPath(),
  );
  const credentialsPath = resolve(
    options.credentialsPath ??
      process.env.MCP_SAP_CREDENTIALS ??
      join(dataRoot, "credentials.json"),
  );
  const auditPath = resolve(
    options.auditPath ??
      process.env.MCP_SAP_AUDIT_LOG ??
      join(dataRoot, "audit.jsonl"),
  );
  return {
    config: await loadSystemsConfig(configPath),
    businessApis: await loadBusinessApis(businessApisPath),
    credentialStore: new CredentialStore(
      new DpapiRunner(),
      new NodeCredentialFiles(),
      credentialsPath,
    ),
    audit: new AuditLog(new FileAppendOnlyWriter(auditPath)),
    configPath,
  };
}
