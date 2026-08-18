import { describe, expect, it, vi } from "vitest";
import { SapHttpSession } from "../../src/http/sap-http-session.js";

describe("SAP CSRF token handling", () => {
  it("rejects a CSRF fetch response without a token", async () => {
    const session = Object.create(SapHttpSession.prototype) as SapHttpSession;
    vi.spyOn(session, "request").mockResolvedValue({
      data: "",
      status: 200,
      statusText: "OK",
      headers: {},
    });

    await expect(
      session.fetchCsrf("/sap/opu/odata/sap/API_PRODUCT_SRV/"),
    ).rejects.toThrow(/CSRF token/i);
  });
});
