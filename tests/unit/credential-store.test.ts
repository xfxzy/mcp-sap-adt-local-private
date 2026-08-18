import { describe, expect, it } from "vitest";
import { CredentialStore } from "../../src/credentials/credential-store.js";

describe("CredentialStore", () => {
  it("stores only protected text", async () => {
    const files = new Map<string, string>();
    const store = new CredentialStore(
      {
        protect: async (value) => `protected:${value}`,
        unprotect: async (value) => value.slice(10),
      },
      {
        read: async (path) => files.get(path),
        write: async (path, value) => void files.set(path, value),
        remove: async (path) => void files.delete(path),
      },
      "C:/secure/credentials.json",
    );

    await store.set("SAH", "secret");

    expect([...files.values()][0]).not.toContain('secret"');
    expect(await store.get("SAH")).toBe("secret");
  });

  it("normalizes credential references and removes entries", async () => {
    const files = new Map<string, string>();
    const store = new CredentialStore(
      {
        protect: async (value) => `protected:${value}`,
        unprotect: async (value) => value.slice(10),
      },
      {
        read: async (path) => files.get(path),
        write: async (path, value) => void files.set(path, value),
        remove: async (path) => void files.delete(path),
      },
      "C:/secure/credentials.json",
    );

    await store.set("sah", "secret");
    expect(await store.has("SAH")).toBe(true);
    await store.remove("sah");
    expect(await store.has("SAH")).toBe(false);
  });

  it("rejects malformed storage without exposing its contents", async () => {
    const store = new CredentialStore(
      { protect: async () => "unused", unprotect: async () => "unused" },
      {
        read: async () => "not-json-secret",
        write: async () => undefined,
        remove: async () => undefined,
      },
      "C:/secure/credentials.json",
    );

    await expect(store.get("SAH")).rejects.toThrow(
      /credential store is invalid/i,
    );
    await expect(store.get("SAH")).rejects.not.toThrow(/not-json-secret/);
  });
});
