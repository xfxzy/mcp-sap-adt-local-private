import type { ODataProperty } from "./metadata-types.js";
import { formatODataValue } from "./odata-values.js";

export function entityPath(
  entitySet: string,
  keys: Record<string, unknown>,
  keyTypes: Record<string, ODataProperty | string>,
  keyOrder?: string[],
): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(entitySet))
    throw new Error("Invalid OData entity set");
  const order = keyOrder ?? Object.keys(keys);
  if (order.length === 0) throw new Error("OData entity key is required");
  const expected = new Set(order);
  const supplied = Object.keys(keys);
  if (
    supplied.some((key) => !expected.has(key)) ||
    order.some((key) => !(key in keys))
  )
    throw new Error("OData keys do not match configured key set");
  const values = order.map((key) => {
    const descriptor = keyTypes[key];
    const type = typeof descriptor === "string" ? descriptor : descriptor?.type;
    if (!type) throw new Error(`Missing OData key type: ${key}`);
    return `${key}=${formatODataValue(keys[key], type)}`;
  });
  return `${entitySet}(${values.join(",")})`;
}
