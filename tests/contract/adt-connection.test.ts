import { afterEach, describe, expect, it } from "vitest";
import { AdtConnectionAdapter } from "../../src/adt/adt-connection-adapter.js";
import { type SapFixture, startSapFixture } from "../helpers/sap-fixture.js";

const fixtures: SapFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("SAP HTTP and ADT connection", () => {
  it("adds sap-client and sap-language to every ADT request", async () => {
    const fixture = await startSapFixture();
    fixtures.push(fixture);
    await fixture.createSession().request({
      method: "GET",
      path: "/sap/bc/adt/discovery",
      semantic: "read",
    });
    expect(fixture.lastUrl.searchParams.get("sap-client")).toBe("400");
    expect(fixture.lastUrl.searchParams.get("sap-language")).toBe("1");
  });

  it("persists response cookies on the next request", async () => {
    const fixture = await startSapFixture({
      responses: [
        {
          status: 200,
          headers: { "set-cookie": "SAP_SESSIONID_FIXTURE=abc; Path=/" },
        },
        200,
      ],
    });
    fixtures.push(fixture);
    const session = fixture.createSession();
    await session.request({ method: "GET", path: "/one", semantic: "read" });
    await session.request({ method: "GET", path: "/two", semantic: "read" });
    expect(fixture.lastHeaders.cookie).toContain("SAP_SESSIONID_FIXTURE=abc");
  });

  it("retries a transient GET only within the configured bound", async () => {
    const fixture = await startSapFixture({ responses: [503, 200] });
    fixtures.push(fixture);
    const response = await fixture.createSession().request({
      method: "GET",
      path: "/read",
      semantic: "read",
    });
    expect(response.status).toBe(200);
    expect(fixture.requestCount).toBe(2);
  });

  it("never retries a semantic write", async () => {
    const fixture = await startSapFixture({ responses: [503, 200] });
    fixtures.push(fixture);
    await expect(
      fixture.createSession().request({
        method: "POST",
        path: "/write",
        semantic: "write",
      }),
    ).rejects.toThrow(/503/);
    expect(fixture.requestCount).toBe(1);
  });

  it("does not allow callers to override authentication or cookies", async () => {
    const fixture = await startSapFixture();
    fixtures.push(fixture);
    await fixture.createSession().request({
      method: "GET",
      path: "/read",
      semantic: "read",
      headers: {
        Authorization: "Bearer attacker",
        Cookie: "attacker=true",
      },
    });
    expect(fixture.lastHeaders.authorization).toMatch(/^Basic /);
    expect(fixture.lastHeaders.authorization).not.toContain("attacker");
    expect(fixture.lastHeaders.cookie).toBeUndefined();
  });

  it("maps ADT requests and keeps where-used POST semantically read-only", async () => {
    const fixture = await startSapFixture({ responses: [503, 200] });
    fixtures.push(fixture);
    const adapter = new AdtConnectionAdapter(fixture.createSession());
    const response = await adapter.makeAdtRequest({
      url: "/sap/bc/adt/repository/informationsystem/usageReferences",
      method: "POST",
      timeout: 5000,
      data: "<query />",
    });
    expect(response.status).toBe(200);
    expect(fixture.requestCount).toBe(2);
  });

  it("sends a fetched CSRF token on a semantically read-only POST", async () => {
    const accepts: Array<string | undefined> = [];
    const fixture = await startSapFixture({
      handler: (request, response) => {
        accepts.push(request.headers.accept);
        if (request.method === "GET") {
          response.writeHead(200, {
            "x-csrf-token": "fixture-token",
            "set-cookie": "SAP_SESSIONID_FIXTURE=csrf; Path=/",
          });
        } else {
          response.writeHead(200);
        }
        response.end("ok");
      },
    });
    fixtures.push(fixture);
    const session = fixture.createSession();

    await session.fetchCsrf("/sap/bc/adt/discovery");
    await session.request({
      method: "POST",
      path: "/sap/bc/adt/datapreview/freestyle",
      semantic: "read",
      body: "SELECT bukrs FROM t001",
    });

    expect(accepts[0]).toBe("application/atomsvc+xml");
    expect(fixture.lastHeaders["x-csrf-token"]).toBe("fixture-token");
    expect(fixture.lastHeaders.cookie).toContain("SAP_SESSIONID_FIXTURE=csrf");
  });
});
