import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { applyBusinessChange } from "../../src/business-api/apply-business-change.js";
import { BusinessApiRegistry } from "../../src/business-api/business-api-registry.js";
import type { PreparedBusinessChange } from "../../src/business-api/prepare-business-change.js";
import { parseBusinessApis } from "../../src/business-api/schema.js";
import { ChangePlanStore } from "../../src/change-plans/change-plan-store.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import { SapHttpError } from "../../src/http/errors.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";

const metadata = await readFile(
  new URL("../fixtures/odata/product-metadata.xml", import.meta.url),
  "utf8",
);

const systems = parseSystemsConfig({
  version: 1,
  systems: [
    {
      id: "SAH",
      label: "SAH",
      kind: "fixture",
      environment: "non-production",
      connection: {
        protocol: "https",
        host: "localhost",
        port: 443,
        client: "400",
        language: "1",
        serverTimezone: "UTC",
      },
      auth: { type: "basic", username: "fixture", credentialRef: "SAH" },
      tls: { mode: "strict" },
      access: { read: true, adtDevelopmentWrite: true, businessApiWrite: true },
      development: { objectNamePatterns: ["Z*"], requireTransport: true },
      businessApis: { enabledProfiles: ["p"] },
      limits: {
        requestTimeoutMs: 1000,
        rateLimitPerMin: 60,
        maxSourceLines: 100,
      },
    },
  ],
});

const apiConfig = parseBusinessApis({
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
              operations: ["read", "update", "action:ReleaseProduct"],
              mutableFields: ["ProductType"],
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

function makeRegistry(): SystemRegistry {
  const registry = new SystemRegistry(systems);
  registry.setActive(["SAH"]);
  return registry;
}

function makePlan(
  plans: ChangePlanStore,
  operation: PreparedBusinessChange["operation"],
  payload: Record<string, unknown>,
  diff: PreparedBusinessChange["diff"],
): string {
  const now = new Date();
  const planId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  plans.put({
    id: planId,
    kind: "business",
    systemId: "SAH",
    target: "API_PRODUCT/A_Product",
    createdAt: now.toISOString(),
    expiresAt,
    expectedEtag: 'W/"fixture-etag"',
    request: {
      planId,
      kind: "business",
      systemId: "SAH",
      apiId: "API_PRODUCT",
      entitySet: "A_Product",
      operation,
      keys: { Product: "1" },
      diff,
      payload,
      expectedEtag: 'W/"fixture-etag"',
      expiresAt,
    },
  });
  return planId;
}

function makeDeps(session: Record<string, unknown>, plans: ChangePlanStore) {
  const registry = makeRegistry();
  return {
    systems: registry,
    credentials: {} as never,
    apis: new BusinessApiRegistry(apiConfig, registry),
    plans,
    session: session as never,
    audit: { write: vi.fn(async () => undefined) },
  };
}

describe("apply business change", () => {
  it("does not write when approval is false", async () => {
    const plans = new ChangePlanStore();
    const patchEntity = vi.fn();
    await expect(
      applyBusinessChange(
        {
          systems: {} as never,
          credentials: {} as never,
          apis: {} as never,
          plans,
          audit: { write: vi.fn() },
        },
        { planId: "00000000-0000-0000-0000-000000000001", approveWrite: false },
      ),
    ).rejects.toThrow(/approve/i);
    expect(patchEntity).not.toHaveBeenCalled();
  });

  it("maps SAP 412 to a stale plan and sends only one PATCH", async () => {
    const plans = new ChangePlanStore();
    const patchEntity = vi
      .fn()
      .mockRejectedValue(new SapHttpError(412, "Precondition Failed"));
    const session = {
      metadata: vi.fn(async () => metadata),
      getEntity: vi.fn(async () => ({
        data: { Product: "1", ProductType: "FERT" },
        etag: 'W/"fixture-etag"',
      })),
      patchEntity,
      action: vi.fn(),
      createEntity: vi.fn(),
    };
    const planId = makePlan(plans, "update", { ProductType: "HALB" }, [
      {
        field: "ProductType",
        before: "FERT",
        after: "HALB",
        type: "Edm.String",
      },
    ]);

    await expect(
      applyBusinessChange(makeDeps(session, plans), {
        planId,
        approveWrite: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_CHANGE_PLAN" });
    expect(patchEntity).toHaveBeenCalledTimes(1);
    expect(session.getEntity).toHaveBeenCalledTimes(1);
  });

  it("applies an allowlisted action once and independently verifies it", async () => {
    const plans = new ChangePlanStore();
    const action = vi.fn(async () => ({ data: null }));
    const session = {
      metadata: vi.fn(async () => metadata),
      getEntity: vi
        .fn()
        .mockResolvedValueOnce({
          data: { Product: "1", ProductType: "FERT" },
          etag: 'W/"fixture-etag"',
        })
        .mockResolvedValueOnce({
          data: { Product: "1", ProductType: "HALB" },
          etag: 'W/"fixture-etag-2"',
        }),
      patchEntity: vi.fn(),
      action,
      createEntity: vi.fn(),
    };
    const planId = makePlan(
      plans,
      "action:ReleaseProduct",
      { Product: "1", ProductType: "HALB" },
      [
        {
          field: "ProductType",
          before: "FERT",
          after: "HALB",
          type: "Edm.String",
        },
      ],
    );

    const result = await applyBusinessChange(makeDeps(session, plans), {
      planId,
      approveWrite: true,
    });

    expect(result).toMatchObject({
      verified: true,
      operation: "action:ReleaseProduct",
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(
      "/sap/opu/odata/sap/API_PRODUCT_SRV/",
      "ReleaseProduct",
      { Product: "1", ProductType: "HALB" },
    );
    expect(session.getEntity).toHaveBeenCalledTimes(2);
  });
});
