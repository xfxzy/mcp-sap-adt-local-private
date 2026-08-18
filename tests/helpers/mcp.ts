import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../../src/server.js";

export interface TestServerOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  server?: McpServer;
}

export interface TestMcpClient {
  close(): Promise<void>;
  listTools(): ReturnType<Client["listTools"]>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): ReturnType<Client["callTool"]>;
}

export async function startTestMcpServer(
  options: TestServerOptions = {},
): Promise<TestMcpClient> {
  const client = new Client({
    name: "mcp-sap-adt-local-tests",
    version: "0.1.0",
  });
  let inProcessServer: McpServer | undefined;

  if (options.command) {
    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env as Record<string, string> | undefined,
      stderr: "pipe",
    });
    await client.connect(transport);
  } else {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    inProcessServer = options.server ?? createMcpServer();
    await inProcessServer.connect(serverTransport);
    await client.connect(clientTransport);
  }

  return {
    listTools: () => client.listTools(),
    callTool: (name, args = {}) => client.callTool({ name, arguments: args }),
    async close() {
      await client.close();
      await inProcessServer?.close();
    },
  };
}
