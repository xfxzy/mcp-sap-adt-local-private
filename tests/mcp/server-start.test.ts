import { afterEach, describe, expect, it } from "vitest";
import { startTestMcpServer, type TestMcpClient } from "../helpers/mcp.js";

const clients: TestMcpClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("MCP server", () => {
  it("starts with an empty phase-one tool list", async () => {
    const client = await startTestMcpServer();
    clients.push(client);
    expect((await client.listTools()).tools).toEqual([]);
  });
});
