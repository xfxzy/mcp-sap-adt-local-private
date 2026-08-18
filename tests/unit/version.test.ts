import { describe, expect, it } from "vitest";
import { APP_NAME, APP_VERSION } from "../../src/version.js";

describe("version metadata", () => {
  it("uses the independent local product identity", () => {
    expect(APP_NAME).toBe("mcp-sap-adt-local");
    expect(APP_VERSION).toMatch(/^0\.1\.0$/);
  });
});
