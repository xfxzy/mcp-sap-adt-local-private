export type ODataValueType =
  | "Edm.String"
  | "Edm.Boolean"
  | "Edm.Int16"
  | "Edm.Int32"
  | "Edm.Int64"
  | "Edm.Decimal"
  | "Edm.Double"
  | "Edm.Single"
  | "Edm.DateTime"
  | "Edm.DateTimeOffset"
  | "Edm.Guid";

function quote(value: string): string {
  const encoded = encodeURIComponent(value)
    .replaceAll("'", "''")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
  return `'${encoded}'`;
}

export function formatODataValue(value: unknown, type: string): string {
  if (type === "Edm.String") {
    if (typeof value !== "string")
      throw new Error("OData string key must be a string");
    return quote(value);
  }
  if (type === "Edm.Boolean") {
    if (typeof value !== "boolean")
      throw new Error("OData boolean key must be boolean");
    return value ? "true" : "false";
  }
  if (["Edm.Int16", "Edm.Int32", "Edm.Int64"].includes(type)) {
    if (
      typeof value !== "number" &&
      typeof value !== "bigint" &&
      typeof value !== "string"
    )
      throw new Error(`OData integer key has invalid type: ${type}`);
    const text = String(value);
    if (!/^-?\d+$/.test(text))
      throw new Error(`OData integer key is invalid: ${text}`);
    return text;
  }
  if (["Edm.Decimal", "Edm.Double", "Edm.Single"].includes(type)) {
    if (typeof value !== "number" && typeof value !== "string")
      throw new Error(`OData numeric key has invalid type: ${type}`);
    const text = String(value);
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
      throw new Error(`OData numeric key is invalid: ${text}`);
    return type === "Edm.Decimal" ? `${text}m` : text;
  }
  if (type === "Edm.Guid") {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new Error("OData GUID key is invalid");
    return `guid'${value}'`;
  }
  if (type === "Edm.DateTime" || type === "Edm.DateTimeOffset") {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    )
      throw new Error(`OData date key is invalid: ${String(value)}`);
    return `${type === "Edm.DateTime" ? "datetime" : "datetimeoffset"}${quote(value)}`;
  }
  throw new Error(`Unsupported OData key type: ${type}`);
}
