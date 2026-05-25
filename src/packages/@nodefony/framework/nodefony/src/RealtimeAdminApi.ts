import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IInstanceErrorHealth,
} from "nodefony";
import { ProcessProbe, Nodefony, readOrmHealth } from "nodefony";
import { getRealtimeHub } from "./RealtimeHub";
import { clusterProbeHealth } from "./ClusterProbeClient";
import type {
  IRealtimeHealth,
  IRealtimeClusterHealth,
} from "../interfaces/IRealtimeProbe";

// Sonde process du worker (CPU/mém/event-loop) — 1 instance/process (deltas par
// intervalle). Lue dans buildOwnHealth → voyage dans le report de sonde (cluster) puis le
// snapshot pod → la vue « salle des machines » a les stats process PAR worker. lazy : le
// monitor event-loop ne s'active qu'au 1ᵉʳ read(). SERVEUR (ProcessProbe = node:perf_hooks).
const processProbe = new ProcessProbe();

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
/**
 * Compteurs d'erreurs Syslog du worker (cumuls monotones), ou `undefined` si le kernel/son
 * syslog n'est pas joignable. Lecture pure de 2 entiers (0 scan du ring buffer).
 */
function readInstanceErrorHealth(): IInstanceErrorHealth | undefined {
  const syslog = Nodefony.getKernel()?.syslog;
  if (!syslog) return undefined;
  return { errorTotal: syslog.errorTotal, criticTotal: syslog.criticTotal };
}

export function buildOwnHealth(): IRealtimeHealth {
  const health: IRealtimeHealth = {
    instanceId: String(process.pid),
    ...getRealtimeHub().probe(),
    process: processProbe.read(),
  };
  // Sondes per-instance NON realtime (additif, omis si absent → non-breaking) :
  const orm = readOrmHealth();
  if (orm) health.orm = orm;
  const errors = readInstanceErrorHealth();
  if (errors) health.errors = errors;
  return health;
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
