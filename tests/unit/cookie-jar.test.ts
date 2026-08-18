import { describe, expect, it } from "vitest";
import { CookieJar } from "../../src/http/cookie-jar.js";

describe("CookieJar", () => {
  it("persists, replaces, and removes SAP cookies", () => {
    const jar = new CookieJar();
    jar.setCookies([
      "SAP_SESSIONID_ABC=one; Path=/; Secure",
      "sap-usercontext=sap-client=400; Path=/",
    ]);
    expect(jar.header()).toContain("SAP_SESSIONID_ABC=one");
    jar.setCookies(["SAP_SESSIONID_ABC=two; Path=/"]);
    expect(jar.header()).toContain("SAP_SESSIONID_ABC=two");
    jar.setCookies(["SAP_SESSIONID_ABC=; Max-Age=0; Path=/"]);
    expect(jar.header()).not.toContain("SAP_SESSIONID_ABC");
  });
});
