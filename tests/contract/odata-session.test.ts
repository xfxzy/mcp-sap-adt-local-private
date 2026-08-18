import { describe, expect, it, vi } from "vitest";
import { ODataSession } from "../../src/odata/odata-session.js";

describe("OData session mutation contract", () => {
  it("fetches CSRF and cookies before one PATCH and forwards the ETag", async () => {
    const http = {
      fetchCsrf: vi.fn(async () => undefined),
      request: vi.fn(async () => ({
        data: '{"d":{"Product":"1"}}',
        headers: { etag: 'W/"fixture-etag"' },
        status: 200,
        statusText: "OK",
      })),
      getSessionId: vi.fn(() => "fixture-session"),
    };
    const session = new ODataSession(http as never);
    await session.patchEntity({
      serviceRoot: "/sap/opu/odata/sap/API_PRODUCT_SRV/",
      entitySet: "A_Product",
      keys: { Product: "1" },
      keyTypes: { Product: "Edm.String" },
      payload: { ProductType: "FERT" },
      etag: 'W/"fixture-etag"',
    });
    expect(http.fetchCsrf).toHaveBeenCalledTimes(1);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][0]).toMatchObject({
      method: "PATCH",
      semantic: "write",
    });
    expect(http.request.mock.calls[0][0].headers["if-match"]).toBe(
      'W/"fixture-etag"',
    );
  });

  it("fetches CSRF before one POST action", async () => {
    const http = {
      fetchCsrf: vi.fn(async () => undefined),
      request: vi.fn(async () => ({
        data: "",
        headers: {},
        status: 204,
        statusText: "No Content",
      })),
      getSessionId: vi.fn(() => "fixture-session"),
    };
    const session = new ODataSession(http as never);

    await session.action(
      "/sap/opu/odata/sap/API_PRODUCT_SRV/",
      "ReleaseProduct",
      { Product: "1" },
    );

    expect(http.fetchCsrf).toHaveBeenCalledTimes(1);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][0]).toMatchObject({
      method: "POST",
      path: "/sap/opu/odata/sap/API_PRODUCT_SRV/ReleaseProduct",
      semantic: "write",
      body: '{"Product":"1"}',
    });
  });
});
