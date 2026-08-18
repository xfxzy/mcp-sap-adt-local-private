import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseBusinessApis } from "../../src/business-api/schema.js";
import { parseODataMetadata } from "../../src/odata/parse-metadata.js";
import { validateServiceProfile } from "../../src/odata/validate-service-profile.js";

const xml = await readFile(
  new URL("../fixtures/odata/product-metadata.xml", import.meta.url),
  "utf8",
);
const profile = parseBusinessApis({
  version: 1,
  profiles: {
    p: {
      services: [
        {
          id: "API_PRODUCT",
          serviceRoot: "/sap/opu/odata/sap/API_PRODUCT_SRV/",
          entities: [
            {
              entitySet: "A_Product",
              keys: ["Product"],
              operations: ["read", "create", "update", "action:ReleaseProduct"],
              mutableFields: ["ProductType", "BaseUnit", "ProductGroup"],
              immutableFields: ["Product"],
              sensitiveFields: [],
              verifyFields: ["Product", "ProductType"],
            },
          ],
        },
      ],
    },
  },
});

describe("OData V2 metadata", () => {
  it("extracts entity keys, nullable state, and EDM types", () => {
    const model = parseODataMetadata(xml);
    expect(model.entitySets.A_Product.entityType).toBe(
      "API_PRODUCT_SRV.A_ProductType",
    );
    expect(model.entityTypes["API_PRODUCT_SRV.A_ProductType"].keys).toEqual([
      "Product",
    ]);
    expect(
      model.entityTypes["API_PRODUCT_SRV.A_ProductType"].properties.Product
        .type,
    ).toBe("Edm.String");
    expect(
      model.entityTypes["API_PRODUCT_SRV.A_ProductType"].properties.Product
        .nullable,
    ).toBe(false);
    expect(
      model.entityTypes["API_PRODUCT_SRV.A_ProductType"].properties.Product
        .maxLength,
    ).toBe(40);
    expect(model.functionImports.ReleaseProduct.httpMethod).toBe("POST");
  });

  it("validates the allowlisted service against live metadata", () => {
    const model = parseODataMetadata(xml);
    validateServiceProfile(profile.profiles.p.services[0], model);
  });

  it("rejects an allowlisted field absent from live metadata", () => {
    const model = parseODataMetadata(xml);
    expect(() =>
      validateServiceProfile(
        {
          ...profile.profiles.p.services[0],
          entities: [
            {
              ...profile.profiles.p.services[0].entities[0],
              verifyFields: ["UnknownField"],
            },
          ],
        },
        model,
      ),
    ).toThrow(/UnknownField/);
  });
});
