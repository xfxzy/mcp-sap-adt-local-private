import { BusinessApiRegistry } from "../dist/business-api/business-api-registry.js";
import { withBusinessSession } from "../dist/business-api/business-session.js";
import { createRuntimeContext } from "../dist/runtime/context.js";
import { SystemRegistry } from "../dist/systems/system-registry.js";
import { parseODataMetadata } from "../dist/odata/parse-metadata.js";
import { validateServiceProfile } from "../dist/odata/validate-service-profile.js";

const systemId = process.argv[2] ?? "SAH";
const context = await createRuntimeContext();
if (!context.businessApis) throw new Error("Business API config is not loaded");
const systems = new SystemRegistry(context.config);
systems.setActive([systemId]);
const apis = new BusinessApiRegistry(context.businessApis, systems);
const results = [];
for (const { profileId, service } of apis.list(systemId)) {
  try {
    await withBusinessSession({ systems, credentials: context.credentialStore }, systemId, async (session) => {
      const model = parseODataMetadata(await session.metadata(service.serviceRoot));
      validateServiceProfile(service, model);
      results.push({ systemId: systemId.toUpperCase(), profileId, apiId: service.id, serviceRoot: service.serviceRoot, status: "compatible", entitySets: Object.keys(model.entitySets) });
    });
  } catch (error) {
    results.push({ systemId: systemId.toUpperCase(), profileId, apiId: service.id, serviceRoot: service.serviceRoot, status: "incompatible", error: error instanceof Error ? error.message : String(error) });
  }
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
