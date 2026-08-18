import { describe, expect, it } from "vitest";
import { entityPath } from "../../src/odata/odata-path.js";

describe("OData key paths", () => {
  it("encodes a composite OData V2 key without accepting raw path text", () => {
    expect(
      entityPath(
        "A_CostCenter",
        { ControllingArea: "1000", CostCenter: "1000-1001" },
        { ControllingArea: "Edm.String", CostCenter: "Edm.String" },
        ["ControllingArea", "CostCenter"],
      ),
    ).toBe("A_CostCenter(ControllingArea='1000',CostCenter='1000-1001')");
  });

  it("escapes a quote in a string key", () => {
    expect(
      entityPath("A_Product", { Product: "A'1" }, { Product: "Edm.String" }),
    ).toBe("A_Product(Product='A''1')");
  });

  it("percent-encodes path and query delimiters inside string keys", () => {
    expect(
      entityPath(
        "A_Product",
        { Product: "A/1?#(x)" },
        { Product: "Edm.String" },
      ),
    ).toBe("A_Product(Product='A%2F1%3F%23%28x%29')");
  });
});
