import { AdtClient } from "@mcp-abap-adt/adt-clients";
import type {
  IAdtSourceObject,
  IProgramConfig,
  IProgramState,
} from "@mcp-abap-adt/interfaces";
import { XMLParser } from "fast-xml-parser";
import { AdtConnectionAdapter } from "../adt/adt-connection-adapter.js";
import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { RateLimiter } from "../http/rate-limiter.js";
import { SapHttpSession } from "../http/sap-http-session.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";

export interface ProgramSnapshot {
  exists: boolean;
  active: boolean;
  source?: string;
  packageName?: string;
  description?: string;
}

export interface ProgramReader {
  read(system: SapSystemConfig, programName: string): Promise<ProgramSnapshot>;
}

export type ProgramRateLimiterFactory = (
  system: SapSystemConfig,
) => RateLimiter;

export class AdtProgramReader implements ProgramReader {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: ProgramRateLimiterFactory = (system) =>
      new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  async read(
    system: SapSystemConfig,
    programName: string,
  ): Promise<ProgramSnapshot> {
    return this.withProgram(system, async (program) => {
      let activeState: IProgramState | undefined;
      try {
        activeState = await program.read({ programName }, "active");
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      let metadataState: IProgramState;
      try {
        metadataState = await program.readMetadata({ programName });
      } catch (error) {
        if (isNotFound(error)) return { exists: false, active: false };
        throw error;
      }

      const metadata = parseProgramMetadata(metadataState.metadataResult?.data);
      if (!activeState) {
        return { exists: true, active: false, ...metadata };
      }
      return {
        exists: true,
        active: true,
        source: asText(activeState.readResult?.data),
        ...metadata,
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

  private async withProgram<T>(
    system: SapSystemConfig,
    operation: (
      program: IAdtSourceObject<IProgramConfig, IProgramState>,
    ) => Promise<T>,
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
      const client = new AdtClient(new AdtConnectionAdapter(session));
      return await operation(client.getProgram());
    } finally {
      await dispatcher.close();
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    status?: number;
    response?: { status?: number };
  };
  return candidate.status === 404 || candidate.response?.status === 404;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value === undefined || value === null) return "";
  throw new Error("SAP program source response is not text");
}

function localName(value: string): string {
  return value.split(":").at(-1) ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAttribute(
  value: unknown,
  elementName: string,
  attributeName: string,
): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (localName(key) === elementName) {
      for (const [attribute, attributeValue] of Object.entries(
        isRecord(child) ? child : {},
      )) {
        if (
          attribute.startsWith("@_") &&
          localName(attribute.slice(2)) === attributeName &&
          typeof attributeValue === "string"
        ) {
          return attributeValue;
        }
      }
    }
    const nested = findAttribute(child, elementName, attributeName);
    if (nested) return nested;
  }
  return undefined;
}

function parseProgramMetadata(value: unknown): {
  packageName?: string;
  description?: string;
} {
  if (value === undefined || value === null || value === "") return {};
  const document =
    typeof value === "string"
      ? (new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
          parseAttributeValue: false,
          trimValues: true,
        }).parse(value) as unknown)
      : value;
  const packageName = findAttribute(document, "packageRef", "name");
  const description = findAttribute(document, "abapProgram", "description");
  return {
    ...(packageName ? { packageName } : {}),
    ...(description ? { description } : {}),
  };
}
