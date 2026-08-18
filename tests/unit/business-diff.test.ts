import { describe, expect, it } from "vitest";
import { buildBusinessDiff } from "../../src/business-api/business-diff.js";

describe("business field diffs", () => {
  it("returns typed before and after values", () => {
    expect(
      buildBusinessDiff(
        { ProductGroup: "DY01" },
        { ProductGroup: "DY02" },
        {
          ProductGroup: {
            name: "ProductGroup",
            type: "Edm.String",
            nullable: true,
          },
        },
      ),
    ).toEqual([
      {
        field: "ProductGroup",
        before: "DY01",
        after: "DY02",
        type: "Edm.String",
      },
    ]);
  });

  it("omits unchanged values", () => {
    expect(
      buildBusinessDiff(
        { ProductGroup: "DY01" },
        { ProductGroup: "DY01" },
        {
          ProductGroup: {
            name: "ProductGroup",
            type: "Edm.String",
            nullable: true,
          },
        },
      ),
    ).toEqual([]);
  });
});
