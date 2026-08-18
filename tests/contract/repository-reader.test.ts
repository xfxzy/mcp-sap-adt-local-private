import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AdtRepositoryReader } from "../../src/adt/repository-reader.js";
import type { SapSystemConfig } from "../../src/config/types.js";
import {
  type CredentialFiles,
  CredentialStore,
} from "../../src/credentials/credential-store.js";

interface RepositoryFixture {
  close(): Promise<void>;
  methods: string[];
  requestBodies: string[];
  system: SapSystemConfig;
}

const fixtures: RepositoryFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

function sendXml(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "application/xml" });
  response.end(body);
}

async function createCredentials(): Promise<CredentialStore> {
  let source: string | undefined;
  const files: CredentialFiles = {
    read: async () => source,
    write: async (_path, value) => {
      source = value;
    },
    remove: async () => {
      source = undefined;
    },
  };
  const credentials = new CredentialStore(
    {
      protect: async (value) => value,
      unprotect: async (value) => value,
    },
    files,
    "memory",
  );
  await credentials.set("FIXTURE", "fixture-password");
  return credentials;
}

async function startRepositoryFixture(
  searchUri = "/sap/bc/adt/programs/programs/ztest",
): Promise<RepositoryFixture> {
  const pfx = await readFile(
    new URL("../fixtures/tls/expired-localhost.pfx", import.meta.url),
  );
  const methods: string[] = [];
  const requestBodies: string[] = [];
  const server = createServer(
    { pfx, passphrase: "fixture-only" },
    (request, response) => {
      methods.push(`${request.method ?? ""} ${request.url ?? ""}`);
      const url = new URL(request.url ?? "/", "https://localhost");

      if (url.pathname === "/sap/bc/adt/repository/informationsystem/search") {
        sendXml(
          response,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><objectReference adtcore:name="ZTEST" adtcore:type="PROG/P" adtcore:description="Test program" adtcore:packageName="$TMP" adtcore:uri="${searchUri}" /></adtcore:objectReferences>`,
        );
        return;
      }

      if (url.pathname.endsWith("/source/main")) {
        response.writeHead(200, {
          "content-type": "text/plain",
          "content-location": "/sap/bc/adt/programs/programs/ztest/source/main",
        });
        response.end("REPORT ztest.\nWRITE 'fixture'.");
        return;
      }

      if (url.pathname === "/sap/bc/adt/repository/objectstructure") {
        sendXml(
          response,
          `<obj:objectStructure xmlns:obj="urn:sap:adt:objectstructure" obj:objectType="PROG/P" obj:objectName="ZTEST"><obj:node obj:name="Main source" obj:type="PROG/P" obj:uri="/sap/bc/adt/programs/programs/ztest/source/main"><obj:node obj:name="Includes" obj:type="PROG/I" /></obj:node></obj:objectStructure>`,
        );
        return;
      }

      if (
        url.pathname ===
        "/sap/bc/adt/repository/informationsystem/usageReferences"
      ) {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          requestBodies.push(body);
          sendXml(
            response,
            `<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" xmlns:adtcore="http://www.sap.com/adt/core" numberOfResults="1" resultDescription="One result"><usageReferences:referencedObjects><usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/zcaller" isResult="true"><adtcore:adtObject name="ZCALLER" type="PROG/P"><adtcore:packageRef name="$TMP" /></adtcore:adtObject></usageReferences:referencedObject></usageReferences:referencedObjects></usageReferences:usageReferenceResult>`,
          );
        });
        return;
      }

      response.writeHead(404);
      response.end("not found");
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const fixture: RepositoryFixture = {
    methods,
    requestBodies,
    system: {
      id: "FIXTURE",
      label: "Repository fixture",
      kind: "fixture",
      environment: "non-production",
      connection: {
        protocol: "https",
        host: "localhost",
        port: address.port,
        client: "400",
        language: "1",
        serverTimezone: "UTC",
      },
      auth: {
        type: "basic",
        username: "fixture",
        credentialRef: "FIXTURE",
      },
      tls: { mode: "insecure" },
      access: {
        read: true,
        adtDevelopmentWrite: false,
        businessApiWrite: false,
      },
      development: {
        objectNamePatterns: ["Z*", "Y*"],
        requireTransport: true,
      },
      businessApis: { enabledProfiles: [] },
      limits: {
        requestTimeoutMs: 5000,
        rateLimitPerMin: 600,
        maxSourceLines: 5000,
      },
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  fixtures.push(fixture);
  return fixture;
}

describe("ADT repository reader", () => {
  it("parses search results and retrieves source through the real adapter", async () => {
    const fixture = await startRepositoryFixture();
    const reader = new AdtRepositoryReader(await createCredentials());

    await expect(
      reader.search(fixture.system, {
        query: "ZTEST",
        objectType: "PROG/P",
        maxResults: 10,
      }),
    ).resolves.toEqual([
      {
        name: "ZTEST",
        type: "PROG/P",
        description: "Test program",
        packageName: "$TMP",
        uri: "/sap/bc/adt/programs/programs/ztest",
      },
    ]);
    await expect(
      reader.readSource(fixture.system, {
        objectType: "PROG/P",
        objectName: "ZTEST",
        version: "active",
      }),
    ).resolves.toEqual({
      source: "REPORT ztest.\nWRITE 'fixture'.",
      uri: "/sap/bc/adt/programs/programs/ztest/source/main",
    });
  });

  it("normalizes object structure XML into a stable tree", async () => {
    const fixture = await startRepositoryFixture();
    const reader = new AdtRepositoryReader(await createCredentials());

    await expect(
      reader.getObjectStructure(fixture.system, "PROG/P", "ZTEST"),
    ).resolves.toEqual({
      structure: {
        name: "objectStructure",
        attributes: { objectType: "PROG/P", objectName: "ZTEST" },
        children: [
          {
            name: "node",
            attributes: {
              name: "Main source",
              type: "PROG/P",
              uri: "/sap/bc/adt/programs/programs/ztest/source/main",
            },
            children: [
              {
                name: "node",
                attributes: { name: "Includes", type: "PROG/I" },
                children: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("executes where-used as a semantically read-only POST", async () => {
    const fixture = await startRepositoryFixture();
    const reader = new AdtRepositoryReader(await createCredentials());

    await expect(
      reader.whereUsed(fixture.system, {
        objectType: "PROG/P",
        objectName: "ZTEST",
        maxResults: 10,
      }),
    ).resolves.toEqual({
      references: [
        {
          name: "ZCALLER",
          type: "PROG/P",
          packageName: "$TMP",
          uri: "/sap/bc/adt/programs/programs/zcaller",
        },
      ],
    });
    expect(
      fixture.methods.some((entry) =>
        entry.startsWith(
          "POST /sap/bc/adt/repository/informationsystem/usageReferences?",
        ),
      ),
    ).toBe(true);
    expect(fixture.requestBodies[0]).toContain("usageReferenceRequest");
  });

  it("rejects repository search URIs outside the ADT path", async () => {
    const fixture = await startRepositoryFixture("https://attacker.invalid/x");
    const reader = new AdtRepositoryReader(await createCredentials());

    await expect(
      reader.search(fixture.system, {
        query: "ZTEST",
        maxResults: 10,
      }),
    ).rejects.toThrow(/ADT URI/i);
  });
});
