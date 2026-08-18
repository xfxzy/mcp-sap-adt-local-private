import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBusinessApis } from "../../src/business-api/load-business-apis.js";
import { parseBusinessApis } from "../../src/business-api/schema.js";

const validProductProfile = {
  version: 1,
  profiles: {
    "s4-core-masterdata-approved": {
      services: [
        {
          id: "API_PRODUCT",
          serviceRoot: "/sap/opu/odata/sap/API_PRODUCT_SRV/",
          entities: [
            {
              entitySet: "A_Product",
              keys: ["Product"],
              operations: ["read", "create", "update"],
              mutableFields: ["ProductType", "BaseUnit", "ProductGroup"],
              immutableFields: ["Product"],
              sensitiveFields: [],
              verifyFields: [
                "Product",
                "ProductType",
                "BaseUnit",
                "ProductGroup",
              ],
            },
          ],
        },
      ],
    },
  },
};

function withEntity(overrides: Record<string, unknown>) {
  return {
    ...validProductProfile,
    profiles: {
      ...validProductProfile.profiles,
      "s4-core-masterdata-approved": {
        services: [
          {
            ...validProductProfile.profiles["s4-core-masterdata-approved"]
              .services[0],
            entities: [
              {
                ...validProductProfile.profiles["s4-core-masterdata-approved"]
                  .services[0].entities[0],
                ...overrides,
              },
            ],
          },
        ],
      },
    },
  };
}

describe("business API allowlist", () => {
  it("accepts explicit entity operations and fields", () => {
    const config = parseBusinessApis(validProductProfile);
    const entity =
      config.profiles["s4-core-masterdata-approved"].services[0].entities[0];

    expect(entity.operations).toEqual(["read", "create", "update"]);
    expect(entity.mutableFields).toContain("ProductGroup");
  });

  it("loads and validates the example YAML", async () => {
    const config = await loadBusinessApis(
      fileURLToPath(
        new URL("../../config/business-apis.example.yaml", import.meta.url),
      ),
    );

    expect(config.version).toBe(1);
    expect(config.profiles["s4-core-masterdata-approved"].services[0].id).toBe(
      "API_PRODUCT",
    );
  });

  it("rejects arbitrary service roots", () => {
    const input = {
      ...validProductProfile,
      profiles: {
        bad: {
          services: [
            {
              ...validProductProfile.profiles["s4-core-masterdata-approved"]
                .services[0],
              id: "BAD",
              serviceRoot: "https://evil.example/api",
            },
          ],
        },
      },
    };

    expect(() => parseBusinessApis(input)).toThrow(/relative.*odata/i);
  });

  it.each([
    "/sap/opu/odata/sap/API_PRODUCT_SRV/../SECRET/",
    "/sap/opu/odata/sap/API_PRODUCT_SRV/?$format=json",
    "/sap/opu/odata/sap/API_PRODUCT_SRV/#fragment",
    "https://user:pass@example.com/sap/opu/odata/sap/API_PRODUCT_SRV/",
  ])("rejects unsafe service root %s", (serviceRoot) => {
    expect(() =>
      parseBusinessApis({
        ...validProductProfile,
        profiles: {
          bad: {
            services: [
              {
                ...validProductProfile.profiles["s4-core-masterdata-approved"]
                  .services[0],
                serviceRoot,
              },
            ],
          },
        },
      }),
    ).toThrow(/relative|service root/i);
  });

  it("rejects wildcard entity names and mutable fields", () => {
    expect(() => parseBusinessApis(withEntity({ entitySet: "A_*" }))).toThrow(
      /entity.*wildcard|entitySet/i,
    );
    expect(() =>
      parseBusinessApis(withEntity({ mutableFields: ["*"] })),
    ).toThrow(/mutable.*wildcard|field/i);
  });

  it.each([
    "delete",
    "DELETE",
    "archive",
  ])("rejects unsupported operation %s", (operation) => {
    expect(() =>
      parseBusinessApis(withEntity({ operations: [operation] })),
    ).toThrow(/operation|delete|unknown/i);
  });

  it("rejects duplicate service and entity identifiers", () => {
    const service =
      validProductProfile.profiles["s4-core-masterdata-approved"].services[0];
    const duplicateServices = {
      ...validProductProfile,
      profiles: {
        profile: { services: [service, { ...service }] },
      },
    };
    expect(() => parseBusinessApis(duplicateServices)).toThrow(
      /duplicate.*service/i,
    );

    const entity = service.entities[0];
    const duplicateEntities = {
      ...validProductProfile,
      profiles: {
        profile: {
          services: [{ ...service, entities: [entity, { ...entity }] }],
        },
      },
    };
    expect(() => parseBusinessApis(duplicateEntities)).toThrow(
      /duplicate.*entity/i,
    );
  });

  it("rejects duplicate fields and inconsistent field policy", () => {
    expect(() =>
      parseBusinessApis(
        withEntity({ mutableFields: ["BaseUnit", "BaseUnit"] }),
      ),
    ).toThrow(/duplicate.*field/i);
    expect(() =>
      parseBusinessApis(
        withEntity({
          mutableFields: ["ProductType"],
          immutableFields: ["ProductType"],
        }),
      ),
    ).toThrow(/mutable.*immutable|overlap|field policy/i);
  });

  it("requires at least one verification field", () => {
    expect(() => parseBusinessApis(withEntity({ verifyFields: [] }))).toThrow(
      /verifyFields|at least one|required/i,
    );
  });

  it("allows mutable fields to also be sensitive for redaction", () => {
    const config = parseBusinessApis(
      withEntity({
        mutableFields: ["ProductType"],
        sensitiveFields: ["ProductType"],
      }),
    );

    expect(
      config.profiles["s4-core-masterdata-approved"].services[0].entities[0]
        .sensitiveFields,
    ).toEqual(["ProductType"]);
  });

  it("requires entity keys to be immutable", () => {
    expect(() =>
      parseBusinessApis(
        withEntity({ immutableFields: [], mutableFields: ["Product"] }),
      ),
    ).toThrow(/key.*immutable|cannot be mutable/i);
  });

  it("rejects whitespace-padded profile IDs and normalized-key collisions", () => {
    expect(() =>
      parseBusinessApis({
        ...validProductProfile,
        profiles: {
          " profile ":
            validProductProfile.profiles["s4-core-masterdata-approved"],
        },
      }),
    ).toThrow(/profile.*(whitespace|trim|invalid)/i);

    expect(() =>
      parseBusinessApis({
        ...validProductProfile,
        profiles: {
          foo: validProductProfile.profiles["s4-core-masterdata-approved"],
          FOO: validProductProfile.profiles["s4-core-masterdata-approved"],
        },
      }),
    ).toThrow(/duplicate.*profile|profile.*normalized/i);
  });

  it("rejects unknown top-level properties", () => {
    expect(() =>
      parseBusinessApis({ ...validProductProfile, extra: true }),
    ).toThrow(/unrecognized|unknown|extra/i);
  });
});
