import { getSystem } from "../config/schema.js";
import type { SapSystemConfig, SystemsConfig } from "../config/types.js";

export class SystemRegistry {
  private active = new Set<string>();

  constructor(private readonly config: SystemsConfig) {}

  list(): SapSystemConfig[] {
    return [...this.config.systems];
  }

  setActive(ids: string[]): string[] {
    const normalized = ids.map((id) => id.trim().toUpperCase());
    const unique = new Set(normalized);
    if (unique.size !== normalized.length) {
      throw new Error("Active SAP system IDs must be unique");
    }
    for (const id of normalized) {
      try {
        getSystem(this.config, id);
      } catch {
        throw new Error(`SAP system is not configured: ${id || "<empty>"}`);
      }
    }
    this.active = unique;
    return this.activeIds();
  }

  activeIds(): string[] {
    return [...this.active].sort();
  }

  isActive(id: string): boolean {
    return this.active.has(id.trim().toUpperCase());
  }

  requireActive(id: string): SapSystemConfig {
    const system = getSystem(this.config, id);
    if (!this.active.has(system.id)) {
      throw new Error(`SAP system ${system.id} is not active`);
    }
    return system;
  }
}
