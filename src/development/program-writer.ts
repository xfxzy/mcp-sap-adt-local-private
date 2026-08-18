import { AdtClient } from "@mcp-abap-adt/adt-clients";
import type {
  IAdtSourceObject,
  IProgramConfig,
  IProgramState,
} from "@mcp-abap-adt/interfaces";
import { AdtConnectionAdapter } from "../adt/adt-connection-adapter.js";
import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { RateLimiter } from "../http/rate-limiter.js";
import { SapHttpSession } from "../http/sap-http-session.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";
import type {
  ProgramChangeAction,
  StoredProgramChangeRequest,
} from "./prepare-program-change.js";

export interface ProgramWriteRequest extends StoredProgramChangeRequest {}

export interface ProgramWriter {
  create(system: SapSystemConfig, request: ProgramWriteRequest): Promise<void>;
  update(system: SapSystemConfig, request: ProgramWriteRequest): Promise<void>;
}

export type ProgramWriterRateLimiterFactory = (
  system: SapSystemConfig,
) => RateLimiter;

export class AdtProgramWriter implements ProgramWriter {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly createRateLimiter: ProgramWriterRateLimiterFactory = (
      system,
    ) => new RateLimiter(system.limits.rateLimitPerMin),
  ) {}

  async create(
    system: SapSystemConfig,
    request: ProgramWriteRequest,
  ): Promise<void> {
    await this.withProgram(system, (program) =>
      writeProgramWithClient(program, { ...request, action: "create" }),
    );
  }

  async update(
    system: SapSystemConfig,
    request: ProgramWriteRequest,
  ): Promise<void> {
    await this.withProgram(system, (program) =>
      writeProgramWithClient(program, { ...request, action: "update" }),
    );
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
      const connection = new AdtConnectionAdapter(session, (options) =>
        options.method.toUpperCase() === "GET" ? "read" : "write",
      );
      await connection.connect();
      const client = new AdtClient(connection);
      return await operation(client.getProgram());
    } finally {
      await dispatcher.close();
    }
  }
}

export async function writeProgramWithClient(
  program: IAdtSourceObject<IProgramConfig, IProgramState>,
  request: ProgramWriteRequest & { action: ProgramChangeAction },
): Promise<void> {
  const config: IProgramConfig = {
    programName: request.programName,
    packageName: request.packageName,
    ...(request.transportRequest
      ? { transportRequest: request.transportRequest }
      : {}),
    description: request.description,
    programType: "executable",
  };

  if (request.action === "create") {
    await program.create(config, {
      sourceCode: request.source,
      activateOnCreate: false,
      deleteOnFailure: false,
    });
  }

  const result = await program.update(config, {
    sourceCode: request.source,
    activateOnUpdate: true,
    deleteOnFailure: false,
  });
  const activationStatus = result.activateResult?.status;
  if (
    typeof activationStatus !== "number" ||
    activationStatus < 200 ||
    activationStatus >= 300
  ) {
    throw new Error(
      `Program activation did not succeed: ${activationStatus ?? "missing status"}`,
    );
  }
}
