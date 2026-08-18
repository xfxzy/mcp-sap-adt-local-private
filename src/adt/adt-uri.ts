export function requireAdtUri(value: string): string {
  const uri = value.trim();
  const hasControlCharacter = [...uri].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (uri.startsWith("//") || uri.includes("\\") || hasControlCharacter) {
    throw new Error(`SAP returned an invalid ADT URI: ${value}`);
  }
  const relative = uri.startsWith("/");
  const parsed = new URL(uri, "https://configured-sap.invalid");
  const validRelative =
    relative &&
    parsed.origin === "https://configured-sap.invalid" &&
    parsed.pathname.startsWith("/sap/bc/adt/");
  const validAdtScheme =
    !relative &&
    parsed.protocol === "adt:" &&
    /^[A-Za-z0-9_.-]+$/.test(parsed.hostname) &&
    parsed.pathname.startsWith("/sap/bc/adt/");
  if (!validRelative && !validAdtScheme) {
    throw new Error(`SAP returned an invalid ADT URI: ${value}`);
  }
  return uri;
}

export function optionalAdtUri(value: string | undefined): string | undefined {
  return value === undefined ? undefined : requireAdtUri(value);
}
