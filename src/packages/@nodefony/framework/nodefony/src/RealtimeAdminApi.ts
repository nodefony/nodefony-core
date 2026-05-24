import type { IAdminApi, IAdminDescriptor, IAdminEndpoint } from "nodefony";
import { getRealtimeHub } from "./RealtimeHub";
import type { IRealtimeHealth } from "../interfaces/IRealtimeProbe";

/**
 * Producteur `IAdminApi` de la **socket Nodefony** — exposé sous
 * `/nodefony/realtime/api/*`. Surface l'**auto-observabilité** du {@link RealtimeHub}
 * (la socket s'observe à travers elle-même) : canaux, fan-out, connexions et surtout
 * **backpressure** (`bufferedAmount` = blocker mémoire #1 du multiplexing N canaux/1 WS).
 *
 * Namespace `realtime` (pas `studio`/`framework`) car la socket est une couche du
 * framework, pas de Studio : le jour où `@nodefony/realtime` (P13.1) existera, ce
 * producteur y déménagera sans changer le contrat. Réutilisé par l'endpoint HTTP
 * (1ᵉʳ paint) ET par le ticker hub realtime `realtime:health` (push live).
 *
 * Endpoints :
 *  - `GET /nodefony/realtime/api/health` → snapshot per-instance ({@link IRealtimeHealth})
 */

/**
 * Construit le snapshot de **santé de la socket** (per-instance) : lecture pure du
 * hub ({@link RealtimeHub.probe}) enrichie de l'identité process. Aucune I/O, jamais
 * throw → bon marché (appelable à chaque tick). Async pour matcher la signature des
 * tickers broker (`() => Promise<unknown>`), mais le coût reste synchrone.
 *
 * @returns le snapshot {@link IRealtimeHealth} du pod courant.
 */
export async function buildRealtimeHealth(): Promise<IRealtimeHealth> {
  return {
    instanceId: String(process.pid),
    ...getRealtimeHub().probe(),
  };
}

const descriptor: IAdminDescriptor = {
  label: "Realtime",
  icon: "wifi",
  order: 3,
};

/**
 * Construit le producteur `IAdminApi` de la socket (namespace `"realtime"`).
 *
 * @returns le contrat admin, prêt à `broker.register()`.
 */
export function createRealtimeAdminApi(): IAdminApi {
  const endpoints: IAdminEndpoint[] = [
    {
      path: "health",
      summary:
        "Santé de la socket (per-instance) — canaux + abonnés, fan-out (publish/livraisons), connexions, octets/frames, backpressure (bufferedAmount max/total, slow-consumers).",
      handler: () => buildRealtimeHealth(),
    },
  ];

  return {
    adminNamespace: "realtime",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
