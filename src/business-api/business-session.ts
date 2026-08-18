import type { SapSystemConfig } from "../config/types.js";
import type { CredentialStore } from "../credentials/credential-store.js";
import { ODataSession } from "../odata/odata-session.js";
import type { SystemRegistry } from "../systems/system-registry.js";
import { createSapDispatcher } from "../tls/create-dispatcher.js";

export interface BusinessSessionDependencies {
  systems: SystemRegistry;
  credentials: CredentialStore;
  session?: ODataSession;
}

export async function withBusinessSession<T>(
  deps: BusinessSessionDependencies,
  systemId: string,
  callback: (session: ODataSession, system: SapSystemConfig) => Promise<T>,
): Promise<T> {
  const system = deps.systems.requireActive(systemId);
  if (!system.access.read)
    throw new Error(`Read access is disabled for SAP system ${system.id}`);
  if (deps.session) return callback(deps.session, system);
  const password = await deps.credentials.get(system.auth.credentialRef);
  if (!password)
    throw new Error(`Credential is not configured for SAP system ${system.id}`);
  const dispatcher = createSapDispatcher(system);
  try {
    return await callback(
      ODataSession.create({
        system,
        getPassword: async () => password,
        dispatcher,
      }),
      system,
    );
  } finally {
    await dispatcher.close();
  }
}
