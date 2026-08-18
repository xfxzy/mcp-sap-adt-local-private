import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CredentialProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}

export interface CredentialFiles {
  read(path: string): Promise<string | undefined>;
  write(path: string, value: string): Promise<void>;
  remove(path: string): Promise<void>;
}

interface StoredCredentials {
  version: 1;
  credentials: Record<string, string>;
}

function normalizeReference(reference: string): string {
  const normalized = reference.trim().toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw new Error("Credential reference is invalid");
  }
  return normalized;
}

function encodeProtected(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeProtected(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function parseStoredCredentials(source: string | undefined): StoredCredentials {
  if (source === undefined) {
    return { version: 1, credentials: {} };
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("credentials" in parsed) ||
      typeof parsed.credentials !== "object" ||
      parsed.credentials === null ||
      Array.isArray(parsed.credentials) ||
      !Object.values(parsed.credentials).every(
        (value) => typeof value === "string",
      )
    ) {
      throw new Error("shape");
    }
    return parsed as StoredCredentials;
  } catch {
    throw new Error("Credential store is invalid");
  }
}

export class NodeCredentialFiles implements CredentialFiles {
  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async write(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, value, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

export class CredentialStore {
  constructor(
    private readonly protector: CredentialProtector,
    private readonly files: CredentialFiles,
    private readonly path: string,
  ) {}

  async set(reference: string, secret: string): Promise<void> {
    if (!secret) {
      throw new Error("Credential secret must not be empty");
    }
    const normalized = normalizeReference(reference);
    const stored = await this.readStore();
    const protectedText = await this.protector.protect(secret);
    stored.credentials[normalized] = encodeProtected(protectedText);
    await this.files.write(this.path, JSON.stringify(stored));
  }

  async get(reference: string): Promise<string | undefined> {
    const normalized = normalizeReference(reference);
    const stored = await this.readStore();
    const protectedText = stored.credentials[normalized];
    if (protectedText === undefined) {
      return undefined;
    }
    return this.protector.unprotect(decodeProtected(protectedText));
  }

  async has(reference: string): Promise<boolean> {
    const normalized = normalizeReference(reference);
    const stored = await this.readStore();
    return Object.hasOwn(stored.credentials, normalized);
  }

  async remove(reference: string): Promise<void> {
    const normalized = normalizeReference(reference);
    const stored = await this.readStore();
    if (!Object.hasOwn(stored.credentials, normalized)) {
      return;
    }
    delete stored.credentials[normalized];
    if (Object.keys(stored.credentials).length === 0) {
      await this.files.remove(this.path);
      return;
    }
    await this.files.write(this.path, JSON.stringify(stored));
  }

  async listReferences(): Promise<string[]> {
    const stored = await this.readStore();
    return Object.keys(stored.credentials).sort();
  }

  private async readStore(): Promise<StoredCredentials> {
    return parseStoredCredentials(await this.files.read(this.path));
  }
}
