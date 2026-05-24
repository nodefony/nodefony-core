import type { IAdminApi, IAdminDescriptor, IAdminEndpoint } from "nodefony";
import { getRealtimeHub } from "./RealtimeHub";
import { clusterProbeHealth } from "./ClusterProbeClient";
import type {
  IRealtimeHealth,
  IRealtimeClusterHealth,
} from "../interfaces/IRealtimeProbe";

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
 *  - `GET /nodefony/realtime/api/health` → vue POD agrégée ({@link IRealtimeClusterHealth})
 *    en cluster avec sonde active, sinon snapshot per-instance ({@link IRealtimeHealth}).
 */

/**
 * Santé per-instance de CE worker : lecture pure du hub ({@link RealtimeHub.probe}) +
 * identité process. Aucune I/O, jamais throw. C'est ce que chaque worker **remonte** au
 * master (Phase 4c) et le fallback quand il n'y a pas d'agrégat.
 */
export function buildOwnHealth(): IRealtimeHealth {
  return {
    instanceId: String(process.pid),
    ...getRealtimeHub().probe(),
  };
}

/**
 * Construit la **santé de la socket** servie par l'endpoint/le canal `realtime:health` :
 * la **vue POD agrégée** si la sonde cluster est branchée et a reçu un snapshot du master
 * (Phase 4c, push), sinon la **vue per-instance** (mono-process, sonde désactivée, ou cold
 * start). Lecture pure, jamais throw. Async pour matcher la signature des tickers broker.
 *
 * @returns {@link IRealtimeClusterHealth} (cluster) ou {@link IRealtimeHealth} (per-instance).
 */
export async function buildRealtimeHealth(): Promise<
  IRealtimeHealth | IRealtimeClusterHealth
> {
  return clusterProbeHealth() ?? buildOwnHealth();
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
