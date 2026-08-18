export class CookieJar {
  private readonly cookies = new Map<string, string>();

  setCookies(headers: string[]): void {
    for (const header of headers) {
      const pair = header.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const removed =
        value === "" || /(?:^|;)\s*max-age=0(?:;|$)/i.test(header);
      if (removed) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  sessionId(): string | null {
    for (const [name, value] of this.cookies) {
      if (name.toUpperCase().startsWith("SAP_SESSIONID")) {
        return value;
      }
    }
    return null;
  }
}
