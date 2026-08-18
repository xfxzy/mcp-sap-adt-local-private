import { describe, expect, it } from "vitest";
import { validateBusinessValue } from "../../src/business-api/prepare-business-change.js";
import type { ODataProperty } from "../../src/odata/metadata-types.js";

function property(
  type: string,
  options: Partial<ODataProperty> = {},
): ODataProperty {
  return { name: "Value", type, nullable: false, ...options };
}

describe("business API value validation", () => {
  it("enforces string length and nullability", () => {
    expect(() =>
      validateBusinessValue(
        "Name",
        "ABCDE",
        property("Edm.String", { maxLength: 4 }),
      ),
    ).toThrow(/MaxLength/i);
    expect(() =>
      validateBusinessValue("Name", null, property("Edm.String")),
    ).toThrow(/nullable/i);
    expect(() =>
      validateBusinessValue(
        "Name",
        null,
        property("Edm.String", { nullable: true }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["Edm.Int16", "32768"],
    ["Edm.Int32", "2147483648"],
    ["Edm.Int64", "9223372036854775808"],
  ])("rejects values outside the %s range", (type, value) => {
    expect(() => validateBusinessValue("Count", value, property(type))).toThrow(
      /range/i,
    );
  });

  it("enforces decimal precision and scale", () => {
    const decimal = property("Edm.Decimal", { precision: 5, scale: 2 });
    expect(() => validateBusinessValue("Amount", "1234.56", decimal)).toThrow(
      /Precision/i,
    );
    expect(() => validateBusinessValue("Amount", "1.234", decimal)).toThrow(
      /Scale/i,
    );
    expect(() =>
      validateBusinessValue("Amount", "123.45", decimal),
    ).not.toThrow();
  });

  it("validates Boolean, GUID, and DateTime values", () => {
    expect(() =>
      validateBusinessValue("Active", "true", property("Edm.Boolean")),
    ).toThrow(/boolean/i);
    expect(() =>
      validateBusinessValue("Id", "not-a-guid", property("Edm.Guid")),
    ).toThrow(/GUID/i);
    expect(() =>
      validateBusinessValue(
        "ChangedAt",
        "2026-99-99",
        property("Edm.DateTime"),
      ),
    ).toThrow(/DateTime/i);
    expect(() =>
      validateBusinessValue(
        "Id",
        "550e8400-e29b-41d4-a716-446655440000",
        property("Edm.Guid"),
      ),
    ).not.toThrow();
    expect(() =>
      validateBusinessValue(
        "ChangedAt",
        "2026-08-10T10:00:00Z",
        property("Edm.DateTime"),
      ),
    ).not.toThrow();
  });
});
