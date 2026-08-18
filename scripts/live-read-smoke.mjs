import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRuntimeContext } from "../dist/runtime/context.js";
import { createMcpServer } from "../dist/server.js";

const systemId = process.env.LIVE_SAP;
if (!systemId) {
  throw new Error("Set LIVE_SAP to a configured system ID");
}

const context = await createRuntimeContext();
const server = createMcpServer(context);
const client = new Client({
  name: "mcp-sap-adt-local-live-read-smoke",
  version: "0.1.0",
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const calls = [
  ["sap_system_info", { systemId }],
  [
    "search_repository_object",
    { systemId, query: "T001", objectType: "TABL/DT", maxResults: 5 },
  ],
  ["read_table_structure", { systemId, tableName: "T001" }],
  [
    "read_table",
    {
      systemId,
      sql: "SELECT bukrs, butxt FROM t001 WHERE bukrs = '1000'",
      maxRows: 10,
    },
  ],
  ["list_dumps", { systemId, maxResults: 5 }],
  ["read_system_messages", { systemId, maxResults: 5 }],
  ["read_http_log", { systemId, maxResults: 5 }],
  ["list_transports", { systemId }],
];

function errorText(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .slice(0, 240);
}

let coreFailure = false;
try {
  const tools = await client.listTools();
  const annotations = new Map(
    tools.tools.map((tool) => [tool.name, tool.annotations]),
  );
  for (const [name] of calls) {
    if (annotations.get(name)?.readOnlyHint !== true) {
      throw new Error(`Smoke call is not declared read-only: ${name}`);
    }
  }

  await client.callTool({
    name: "set_active_systems",
    arguments: { systemIds: [systemId] },
  });
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      process.stdout.write(`${name}: SKIP_WITH_REASON ${errorText(result)}\n`);
      if (["sap_system_info", "read_table"].includes(name)) coreFailure = true;
      continue;
    }
    const content = result.structuredContent ?? {};
    const empty = "count" in content && content.count === 0;
    process.stdout.write(`${name}: ${empty ? "EMPTY" : "PASS"}\n`);
  }
} finally {
  await client.close();
  await server.close();
}

if (coreFailure) process.exitCode = 1;
