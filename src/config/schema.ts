import { z } from "zod";
import type { SapSystemConfig, SystemsConfig } from "./types.js";

const fingerprintSchema = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(":", "").toUpperCase())
  .pipe(z.string().regex(/^[A-F0-9]{64}$/, "invalid SHA-256 fingerprint"))
  .transform((value) => value.match(/.{2}/g)?.join(":") ?? value);

const tlsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("strict") }).strict(),
  z
    .object({
      mode: z.literal("custom-ca"),
      caFile: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("pinned"),
      fingerprintSha256: fingerprintSchema,
      allowExpired: z.boolean().default(false),
    })
    .strict(),
  z.object({ mode: z.literal("insecure") }).strict(),
]);

const systemSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((value) => value.toUpperCase()),
    label: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    environment: z.enum(["production", "non-production"]),
    connection: z
      .object({
        protocol: z.literal("https", {
          error: "SAP connections require HTTPS",
        }),
        host: z.string().trim().min(1),
        port: z.number().int().min(1).max(65535),
        client: z.string().regex(/^\d{3}$/, "SAP client must contain 3 digits"),
        language: z.string().trim().min(1).max(2),
        serverTimezone: z.string().trim().min(1),
      })
      .strict(),
    auth: z
      .object({
        type: z.literal("basic"),
        username: z.string().trim().min(1),
        credentialRef: z
          .string()
          .trim()
          .min(1)
          .transform((value) => value.toUpperCase()),
      })
      .strict(),
    tls: tlsSchema,
    access: z
      .object({
        read: z.boolean(),
        adtDevelopmentWrite: z.boolean(),
        businessApiWrite: z.boolean(),
      })
      .strict(),
    development: z
      .object({
        objectNamePatterns: z.array(z.string().trim().min(1)).min(1),
        requireTransport: z.boolean(),
      })
      .strict(),
    businessApis: z
      .object({ enabledProfiles: z.array(z.string().trim().min(1)) })
      .strict(),
    limits: z
      .object({
        requestTimeoutMs: z.number().int().positive(),
        rateLimitPerMin: z.number().int().positive(),
        maxSourceLines: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const systemsConfigSchema = z
  .object({
    version: z.literal(1),
    systems: z.array(systemSchema).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const [index, system] of config.systems.entries()) {
      if (seen.has(system.id)) {
        context.addIssue({
          code: "custom",
          path: ["systems", index, "id"],
          message: `Duplicate system id: ${system.id}`,
        });
      }
      seen.add(system.id);

      if (
        system.environment === "production" &&
        (system.access.adtDevelopmentWrite || system.access.businessApiWrite)
      ) {
        context.addIssue({
          code: "custom",
          path: ["systems", index, "access"],
          message: "Production systems must be read-only",
        });
      }
    }
  });

export function parseSystemsConfig(input: unknown): SystemsConfig {
  return systemsConfigSchema.parse(input) as SystemsConfig;
}

export function getSystem(config: SystemsConfig, id: string): SapSystemConfig {
  const normalizedId = id.trim().toUpperCase();
  const system = config.systems.find(
    (candidate) => candidate.id === normalizedId,
  );
  if (!system) {
    throw new Error(
      `SAP system is not configured: ${normalizedId || "<empty>"}`,
    );
  }
  return system;
}
