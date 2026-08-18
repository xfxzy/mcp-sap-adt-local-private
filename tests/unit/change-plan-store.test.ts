import { describe, expect, it } from "vitest";
import { ChangePlanStore } from "../../src/change-plans/change-plan-store.js";

describe("ChangePlanStore", () => {
  it("expires plans after ten minutes", () => {
    const store = new ChangePlanStore(() => new Date("2026-08-09T00:11:00Z"));
    store.put({
      id: "plan-1",
      createdAt: "2026-08-09T00:00:00Z",
      expiresAt: "2026-08-09T00:10:00Z",
      kind: "development",
      systemId: "SAH",
      target: "ZR_TEST",
      expectedHash: "abc",
      request: {},
    });
    expect(() => store.consume("plan-1")).toThrow(/expired/i);
  });

  it("consumes a valid plan only once", () => {
    const store = new ChangePlanStore(() => new Date("2026-08-09T00:05:00Z"));
    store.put({
      id: "plan-1",
      createdAt: "2026-08-09T00:00:00Z",
      expiresAt: "2026-08-09T00:10:00Z",
      kind: "business",
      systemId: "SAH",
      target: "A_Product('1')",
      request: { ProductGroup: "DY02" },
    });
    expect(store.consume("plan-1").id).toBe("plan-1");
    expect(() => store.consume("plan-1")).toThrow(/not found|consumed/i);
  });
});
