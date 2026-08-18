import type { ODataProperty } from "../odata/metadata-types.js";

export interface BusinessFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
  type: string;
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildBusinessDiff(
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
  properties: Record<string, ODataProperty>,
): BusinessFieldDiff[] {
  return Object.entries(changes)
    .filter(([field, after]) => !valuesEqual(current[field], after))
    .map(([field, after]) => ({
      field,
      before: current[field],
      after,
      type: properties[field].type,
    }));
}
