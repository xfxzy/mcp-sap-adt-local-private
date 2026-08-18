import { inspect } from "node:util";
import { Command } from "commander";
import { getSystem } from "../config/schema.js";
import { createRuntimeContext } from "../runtime/context.js";
import { serveMcp } from "../server.js";
import {
  defaultCodexSkillsPath,
  defaultSkillSourcePath,
  installSkills,
} from "../skills/install-skills.js";
import { inspectCertificate } from "../tls/certificate.js";
import { evaluateCertificate } from "../tls/tls-policy.js";
import { APP_NAME, APP_VERSION } from "../version.js";

interface ConfigOptions {
  config?: string;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const value = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/[\r\n]+$/, "");
    if (!value) {
      throw new Error("Password input is empty");
    }
    return value;
  }

  process.stderr.write("SAP password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stderr.write("\n");
      if (error) reject(error);
      else if (!value) reject(new Error("Password input is empty"));
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        finish(new Error("Password input cancelled"));
      } else if (text === "\r" || text === "\n") {
        finish();
      } else if (text === "\b" || text === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += text;
      }
    };
    process.stdin.on("data", onData);
  });
}

function addConfigOption(command: Command): Command {
  return command.option(
    "--config <path>",
    "Path to systems.yaml (or MCP_SAP_SYSTEMS_CONFIG)",
  );
}

export function buildCli(): Command {
  const program = new Command()
    .name(APP_NAME)
    .description("Local multi-system SAP ADT and OData MCP server")
    .version(APP_VERSION);

  addConfigOption(
    program.command("serve").description("Start the stdio MCP server"),
  ).action(async (options: ConfigOptions) => {
    await serveMcp(await createRuntimeContext({ configPath: options.config }));
  });

  addConfigOption(
    program
      .command("login")
      .argument("<systemId>")
      .description("Store a SAP password with Windows DPAPI"),
  ).action(async (systemId: string, options: ConfigOptions) => {
    const context = await createRuntimeContext({ configPath: options.config });
    const system = getSystem(context.config, systemId);
    const secret = await readSecret();
    await context.credentialStore.set(system.auth.credentialRef, secret);
    process.stderr.write(`Credential stored for ${system.id}\n`);
  });

  addConfigOption(
    program
      .command("logout")
      .argument("<systemId>")
      .description("Remove a stored SAP credential"),
  ).action(async (systemId: string, options: ConfigOptions) => {
    const context = await createRuntimeContext({ configPath: options.config });
    const system = getSystem(context.config, systemId);
    await context.credentialStore.remove(system.auth.credentialRef);
    process.stderr.write(`Credential removed for ${system.id}\n`);
  });

  addConfigOption(
    program.command("list-systems").description("List configured SAP systems"),
  ).action(async (options: ConfigOptions) => {
    const context = await createRuntimeContext({ configPath: options.config });
    writeJson(
      context.config.systems.map((system) => ({
        id: system.id,
        label: system.label,
        environment: system.environment,
        tlsMode: system.tls.mode,
        access: system.access,
      })),
    );
  });

  addConfigOption(
    program
      .command("doctor")
      .argument("[systemId]")
      .description("Check configuration, credentials, TLS, and access"),
  ).action(async (systemId: string | undefined, options: ConfigOptions) => {
    const context = await createRuntimeContext({ configPath: options.config });
    const systems = systemId
      ? [getSystem(context.config, systemId)]
      : context.config.systems;
    const results = [];
    for (const system of systems) {
      try {
        const certificate = await inspectCertificate(system);
        results.push({
          systemId: system.id,
          credentialPresent: await context.credentialStore.has(
            system.auth.credentialRef,
          ),
          tls: evaluateCertificate(system.tls, certificate),
          access: system.access,
        });
      } catch (error) {
        results.push({
          systemId: system.id,
          credentialPresent: await context.credentialStore.has(
            system.auth.credentialRef,
          ),
          reachable: false,
          error: error instanceof Error ? error.message : inspect(error),
        });
      }
    }
    writeJson(results);
  });

  addConfigOption(
    program
      .command("trust-certificate")
      .argument("<systemId>")
      .description("Inspect the current SAP TLS certificate for pinning"),
  ).action(async (systemId: string, options: ConfigOptions) => {
    const context = await createRuntimeContext({ configPath: options.config });
    const system = getSystem(context.config, systemId);
    const certificate = await inspectCertificate(system);
    writeJson({
      systemId: system.id,
      hostnameMatches: certificate.hostnameMatches,
      expired: certificate.expired,
      fingerprintSha256: certificate.fingerprintSha256,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
    });
  });

  program
    .command("install-skills")
    .option("--source <path>", "Packaged skills directory")
    .option("--target <path>", "Codex skills directory")
    .option("--overwrite", "Back up and replace existing skills")
    .description("Install the packaged SAP skills")
    .action(
      async (options: {
        source?: string;
        target?: string;
        overwrite?: boolean;
      }) => {
        const result = await installSkills({
          source: options.source ?? defaultSkillSourcePath(),
          target: options.target ?? defaultCodexSkillsPath(),
          overwrite: options.overwrite === true,
        });
        process.stderr.write(
          `Installed ${result.installed.length} SAP skills\n`,
        );
        for (const backup of result.backups)
          process.stderr.write(`Backup: ${backup}\n`);
      },
    );

  return program;
}
