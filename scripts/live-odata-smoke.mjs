import { createRuntimeContext } from "../dist/runtime/context.js";
import { BusinessApiRegistry } from "../dist/business-api/business-api-registry.js";
import { prepareBusinessChange } from "../dist/business-api/prepare-business-change.js";
import { ChangePlanStore } from "../dist/change-plans/change-plan-store.js";
import { SystemRegistry } from "../dist/systems/system-registry.js";

const [systemId = "SAH", apiId = "API_PRODUCT", entitySet = "A_Product", key = "MCP-LOCAL-SMOKE", field = "ProductGroup", value = "DY02"] = process.argv.slice(2);
const context = await createRuntimeContext();
if (!context.businessApis) throw new Error("Business API config is not loaded");
const systems = new SystemRegistry(context.config);
systems.setActive([systemId]);
const apis = new BusinessApiRegistry(context.businessApis, systems);
const plan = await prepareBusinessChange({ systems, apis, credentials: context.credentialStore, plans: new ChangePlanStore() }, { systemId, apiId, entitySet, operation: "update", keys: { Product: key }, changes: { [field]: value } });
process.stdout.write(`${JSON.stringify({ ...plan, instruction: "STOP: present this exact plan to the user. Do not apply until separately approved." }, null, 2)}\n`);
