import type { SystemRegistry } from "../systems/system-registry.js";
import type {
  BusinessApiEntity,
  BusinessApiService,
  BusinessApisConfig,
} from "./schema.js";

export class BusinessApiRegistry {
  constructor(
    private readonly config: BusinessApisConfig,
    private readonly systems: SystemRegistry,
  ) {}

  profilesFor(systemId: string): string[] {
    return this.systems
      .requireActive(systemId)
      .businessApis.enabledProfiles.filter((id) =>
        Boolean(this.config.profiles[id]),
      );
  }

  servicesFor(systemId: string): BusinessApiService[] {
    return this.profilesFor(systemId).flatMap(
      (profileId) => this.config.profiles[profileId].services,
    );
  }

  requireService(systemId: string, apiId: string): BusinessApiService {
    const service = this.servicesFor(systemId).find(
      (candidate) => candidate.id === apiId,
    );
    if (!service)
      throw new Error(
        `Business API is not allowlisted for SAP system ${systemId}: ${apiId}`,
      );
    return service;
  }

  requireEntity(
    systemId: string,
    apiId: string,
    entitySet: string,
  ): { service: BusinessApiService; entity: BusinessApiEntity } {
    const service = this.requireService(systemId, apiId);
    const entity = service.entities.find(
      (candidate) => candidate.entitySet === entitySet,
    );
    if (!entity)
      throw new Error(
        `Business entity is not allowlisted: ${apiId}/${entitySet}`,
      );
    return { service, entity };
  }

  list(
    systemId: string,
  ): Array<{ profileId: string; service: BusinessApiService }> {
    return this.profilesFor(systemId).flatMap((profileId) =>
      this.config.profiles[profileId].services.map((service) => ({
        profileId,
        service,
      })),
    );
  }
}
