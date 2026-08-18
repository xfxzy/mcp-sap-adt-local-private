import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRuntimeContext } from "../dist/runtime/context.js";
import { createMcpServer } from "../dist/server.js";

const systemId = process.env.LIVE_SAP;
const packageName = process.env.LIVE_SAP_PACKAGE;
const transportRequest = process.env.LIVE_SAP_TRANSPORT;
const approveWrite = process.env.LIVE_SAP_APPROVE_WRITE === "true";
const programName = "ZR_MCP_ADT_LOCAL_SMOKE";
const sourcePath = fileURLToPath(
  new URL("./fixtures/ZR_MCP_ADT_LOCAL_SMOKE.abap", import.meta.url),
);

if (!systemId) throw new Error("Set LIVE_SAP to a configured system ID");
if (!packageName) throw new Error("Set LIVE_SAP_PACKAGE to an existing package");

const context = await createRuntimeContext();
const server = createMcpServer(context);
const client = new Client({
  name: "mcp-sap-adt-local-live-development-smoke",
  version: "0.1.0",
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

try {
  await client.callTool({
    name: "set_active_systems",
    arguments: { systemIds: [systemId] },
  });
  if (!transportRequest) {
    const configuredSystem = context.config.systems.find(
      (system) => system.id === systemId.toUpperCase(),
    );
    if (!configuredSystem) throw new Error(`System is not configured: ${systemId}`);
    const sapUser = configuredSystem.auth.username.replaceAll("'", "''");
    const transports = await client.callTool({
      name: "read_table",
      arguments: {
        systemId,
        sql: `SELECT trkorr, trfunction, trstatus, as4user, strkorr FROM e070 WHERE as4user = '${sapUser}' AND trstatus = 'D'`,
        maxRows: 100,
      },
    });
    process.stdout.write(
      `${JSON.stringify(transports.structuredContent?.rows ?? [], null, 2)}\n`,
    );
    const repositoryObjects = await client.callTool({
      name: "read_table",
      arguments: {
        systemId,
        sql: `SELECT devclass, object, obj_name, author FROM tadir WHERE author = '${sapUser}' AND object = 'PROG'`,
        maxRows: 100,
      },
    });
    process.stdout.write(
      `${JSON.stringify(repositoryObjects.structuredContent?.rows ?? [], null, 2)}\n`,
    );
    throw new Error(
      "Set LIVE_SAP_TRANSPORT to one reviewed modifiable transport before preparing",
    );
  }
  const search = await client.callTool({
    name: "search_repository_object",
    arguments: {
      systemId,
      query: programName,
      objectType: "PROG/P",
      maxResults: 10,
    },
  });
  if (search.isError) throw new Error("Program existence search failed");
  const results = Array.isArray(search.structuredContent?.results)
    ? search.structuredContent.results
    : [];
  const action = results.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      String(item.name).toUpperCase() === programName,
  )
    ? "update"
    : "create";

  const prepared = await client.callTool({
    name: "prepare_z_program_change",
    arguments: {
      systemId,
      action,
      programName,
      sourcePath,
      packageName,
      ...(transportRequest ? { transportRequest } : {}),
      description: "MCP SAP ADT local smoke",
    },
  });
  if (prepared.isError) {
    const message = prepared.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join(" ");
    throw new Error(`Prepare failed: ${message}`);
  }
  process.stdout.write(`${JSON.stringify(prepared.structuredContent, null, 2)}\n`);
  if (!approveWrite) {
    process.stdout.write("PREPARE_ONLY: PASS\n");
    process.stdout.write("SAP_WRITE_EXECUTED: NO\n");
  } else {
    const planId = prepared.structuredContent?.id;
    const sourceHash = prepared.structuredContent?.request?.sourceHash;
    if (typeof planId !== "string" || typeof sourceHash !== "string") {
      throw new Error("Prepared plan response is missing its ID or source hash");
    }
    const applied = await client.callTool({
      name: "apply_z_program_change",
      arguments: { planId, approveWrite: true },
    });
    if (applied.isError) throw new Error("Apply failed");
    const verified = await client.callTool({
      name: "verify_z_program",
      arguments: {
        systemId,
        programName,
        packageName,
        expectedHash: sourceHash,
      },
    });
    if (verified.isError) throw new Error("Independent verification failed");
    process.stdout.write(`${JSON.stringify(applied.structuredContent, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(verified.structuredContent, null, 2)}\n`);
    process.stdout.write("SAP_WRITE_EXECUTED: YES\n");
  }
} finally {
  await client.close();
  await server.close();
}
