import type {
  IAdtOperationOptions,
  IAdtSourceObject,
  IProgramConfig,
  IProgramState,
} from "@mcp-abap-adt/interfaces";
import { describe, expect, it } from "vitest";
import { writeProgramWithClient } from "../../src/development/program-writer.js";

describe("narrow ADT program writer", () => {
  it("creates metadata, uploads source, and activates without exposing delete", async () => {
    const calls: Array<{
      method: string;
      config: Partial<IProgramConfig>;
      options?: IAdtOperationOptions;
    }> = [];
    const program = {
      create: async (
        config: IProgramConfig,
        options?: IAdtOperationOptions,
      ) => {
        calls.push({ method: "create", config, options });
        return { errors: [], createResult: { status: 201 } };
      },
      update: async (
        config: Partial<IProgramConfig>,
        options?: IAdtOperationOptions,
      ) => {
        calls.push({ method: "update", config, options });
        return { errors: [], activateResult: { status: 200 } };
      },
    } as unknown as IAdtSourceObject<IProgramConfig, IProgramState>;

    await writeProgramWithClient(program, {
      action: "create",
      programName: "ZR_TEST",
      packageName: "ZLOCAL",
      transportRequest: "S4HK900001",
      description: "Controlled create",
      source: "REPORT zr_test.",
    });

    expect(calls.map((call) => call.method)).toEqual(["create", "update"]);
    expect(calls[1]).toMatchObject({
      config: {
        programName: "ZR_TEST",
        packageName: "ZLOCAL",
        transportRequest: "S4HK900001",
      },
      options: {
        sourceCode: "REPORT zr_test.",
        activateOnUpdate: true,
        deleteOnFailure: false,
      },
    });
  });

  it("performs one update call and requires activation success", async () => {
    let updates = 0;
    const program = {
      update: async () => {
        updates += 1;
        return { errors: [], updateResult: { status: 200 } };
      },
    } as unknown as IAdtSourceObject<IProgramConfig, IProgramState>;

    await expect(
      writeProgramWithClient(program, {
        action: "update",
        programName: "ZR_TEST",
        packageName: "ZLOCAL",
        transportRequest: "S4HK900001",
        description: "Controlled update",
        source: "REPORT zr_test.",
      }),
    ).rejects.toThrow(/activation/i);
    expect(updates).toBe(1);
  });
});
