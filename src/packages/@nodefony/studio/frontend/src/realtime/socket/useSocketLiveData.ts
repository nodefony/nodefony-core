import { useMemo } from "react";
import { useNodefonyChannelData, useNodefonyState } from "nodefony/react";
import type { LiveNodeData } from "../../components/ui";
import {
  normalize,
  type HealthPayload,
  type InstanceHealth,
  type NormalizedHealth,
} from "../../utils/realtimeHealth";
import { PLATFORM_CHANNELS } from "nodefony";

/* ════════════════════════════════════════════════════════════════════════
 * useSocketLiveData — hook qui livre un snapshot temps réel de la Socket.
 *
 * Source = canal `nodefony:socket`, qui rejoue le MÊME producteur que
 * l'endpoint `/nodefony/realtime/api/health` (`buildRealtimeHealth()`).
 * Ce producteur renvoie DEUX formes : la vue pod agrégée quand la sonde
 * cluster est branchée (`{cluster, instances[], totals{…}}`) ou le snapshot
 * per-instance sinon. Lire les scalaires « à la racine » ne marche donc que
 * dans le second cas — d'où le passage obligatoire par `normalize()`, le
 * miroir PARTAGÉ (`utils/realtimeHealth.ts`) qui ramène les deux formes au
 * même modèle. Aucun type de sonde n'est redéclaré ici : une copie locale
 * dérive en silence dès que le contrat serveur bouge.
 *
 * Les `mapXxxLive(snap)` projettent le snapshot vers un `Record<nodeId,
 * LiveNodeData>` exploitable par `FlowGraph` — un par schéma de la doc.
 * Le mapping est PUR (testable, 0 allocation cachée), `FlowGraph` n'a pas
 * besoin de connaître le métier.
 *
 * RÈGLE de remplissage : le bandeau `metrics` d'un nœud ne porte QUE des
 * valeurs réellement mesurées. Une caractéristique descriptive (topologie,
 * ordre de grandeur d'une latence, nom d'un seam) vit dans le `sub` du nœud,
 * jamais dans le bandeau — sinon elle se lit comme une mesure.
 * ════════════════════════════════════════════════════════════════════════ */

export interface SocketLiveSnapshot {
  /**
   * Santé normalisée (mono-process et cluster ramenés au même modèle) —
   * `null` tant qu'aucune frame n'est arrivée.
   */
  rt: NormalizedHealth | null;
  /**
   * Carte d'identité du backplane effectif (driver / transport / cross-pod),
   * lue sur la première instance qui la remonte. `null` si la sonde ne l'a
   * pas encore livrée.
   */
  backplane: InstanceHealth["backplane"] | null;
  /** État de la socket côté client (RealtimeClient). */
  clientState: ReturnType<typeof useNodefonyState>;
}

/**
 * Descripteur de backplane du pod. En cluster tous les workers partagent le
 * même driver — la première instance qui le remonte fait foi. Retourne la
 * référence existante (aucune allocation par tick).
 */
function readBackplane(
  health: NormalizedHealth | null,
): InstanceHealth["backplane"] | null {
  if (!health) return null;
  const list = health.instances;
  for (let i = 0; i < list.length; i += 1) {
    const bp = list[i]?.backplane;
    if (bp) return bp;
  }
  return null;
}

/** Snapshot brut + état client. À mapper ensuite via `mapXxxLive(snap)`. */
export function useSocketLiveData(): SocketLiveSnapshot {
  const raw = useNodefonyChannelData<HealthPayload>(PLATFORM_CHANNELS.socket);
  const clientState = useNodefonyState();
  // Une seule normalisation par frame reçue, partagée par les 6 mappings —
  // et un snapshot d'identité STABLE, sans quoi le `useMemo([snap])` de
  // chaque `<LiveBranch>` ne pourrait jamais faire mouche.
  const rt = useMemo(() => normalize(raw), [raw]);
  const backplane = useMemo(() => readBackplane(rt), [rt]);
  return useMemo(
    () => ({ rt, backplane, clientState }),
    [rt, backplane, clientState],
  );
}

/* ─── Aides de dérivation (pures, 0 allocation) ──────────────────────────── */

/** Format compact pour les compteurs > 1k. */
function fmt(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Le driver `loopback` reste dans le process : aucun bus inter-process branché. */
function backplaneWired(bp: InstanceHealth["backplane"] | null): boolean {
  if (!bp) return false;
  return bp.crossPod === true || (!!bp.driver && bp.driver !== "loopback");
}

/**
 * Plus large fan-out constaté sur un canal de l'instance (max des `subscribers`).
 * Sert à allumer les nœuds « abonné » par rang : le nœud n° k s'allume quand un
 * canal porte au moins k abonnés simultanés. Boucle simple, aucune allocation.
 */
function maxSubscribers(inst: InstanceHealth | undefined): number {
  if (!inst) return 0;
  let max = 0;
  const list = inst.channels;
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i].subscribers;
    if (s > max) max = s;
  }
  return max;
}

/**
 * Nœud « abonné n° `rank` » : allumé dès que l'instance porte au moins `rank`
 * abonnés simultanés sur un même canal. L'identité du peer est illustrative
 * (ce n'est pas UN client donné), le seuil franchi est réel.
 */
function subscriberNode(
  maxSubs: number,
  rank: number,
  pulse: boolean,
): LiveNodeData {
  const reached = maxSubs >= rank;
  return { status: reached ? "ok" : "idle", pulse: reached && pulse };
}

/**
 * Nœud « worker » alimenté par `instances[index]` de la vue pod. Absent de
 * l'agrégat (mono-process, ou pod plus petit que le schéma) → nœud neutre SANS
 * métrique : le schéma illustre N workers, la sonde n'en connaît qu'un.
 */
function workerNode(
  instances: InstanceHealth[] | undefined,
  index: number,
  extraLabel: string,
  extraValue: (inst: InstanceHealth) => string,
): LiveNodeData {
  const inst = instances?.[index];
  if (!inst) return { status: "idle" };
  return {
    status: "ok",
    pulse: inst.connectionCount > 0,
    metrics: [
      { label: "instance", value: inst.instanceId },
      { label: extraLabel, value: extraValue(inst) },
    ],
  };
}

/**
 * Bandeau du nœud backplane : ce que la sonde dit du bus RÉELLEMENT branché.
 * `RealtimeHub.probe()` renvoie toujours un descripteur (à défaut de driver,
 * celui du loopback) → l'absence de bandeau signale l'absence de frame, pas
 * l'absence de backplane.
 */
function backplaneNode(bp: InstanceHealth["backplane"] | null): LiveNodeData {
  if (!bp) return { status: "idle" };
  return {
    status: backplaneWired(bp) ? "ok" : "idle",
    metrics: [
      { label: "driver", value: bp.driver ?? "—" },
      { label: "transport", value: bp.kind ?? "—" },
      { label: "cross-pod", value: bp.crossPod ? "oui" : "non" },
    ],
  };
}

/**
 * Schéma d'URL de la page — le transport de la socket suit celui du document
 * (`wss:` sur une page `https:`). Constante de module : ne change pas d'un tick
 * à l'autre.
 */
const CLIENT_TRANSPORT =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? "WSS"
    : "WS";

/* ─── Mappings vers les graphes de la doc ────────────────────────────────── */

/**
 * Mapping pour le **graphe Architecture** (Client → Transport → Peer → Hub →
 * Backplane → Workers). Chaque node a `metrics?` quand la donnée fait sens.
 * Status :
 *  - "ok"   = preuve d'activité (≥1 connexion / ≥1 fan-out / cycle frappé)
 *  - "idle" = pas de signe d'activité (mais pas d'erreur)
 *  - "warn" = anomalie (backpressure, slow consumers)
 *  - "down" = ne pas pulser (rouge fixe)
 *
 * Les deux nœuds « Worker » ne s'alimentent qu'en vue pod agrégée : hors
 * cluster la sonde ne connaît qu'une instance, le second reste neutre.
 */
export function mapArchitectureLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const totals = rt?.totals;
  const connected = snap.clientState === "connected";
  const channels = totals?.channelCount ?? 0;
  const conns = totals?.connectionCount ?? 0;
  const fanout = totals?.fanoutTotal ?? 0;
  const bp = totals?.backpressure;
  const slow = bp?.slowConsumers ?? 0;
  const bpBytes = bp?.totalBufferedAmount ?? 0;
  const hubWarn = slow > 0 || bpBytes > 0;
  const instances = rt?.instances;
  return {
    client: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [
        { label: "état", value: snap.clientState },
        { label: "transport", value: CLIENT_TRANSPORT },
      ],
    },
    transport: {
      status: conns > 0 ? "ok" : "idle",
      pulse: conns > 0,
      // Compteur SERVEUR (toutes connexions du pod), pas la connexion de
      // cette page — le label doit le dire.
      metrics: [{ label: "connexions (serveur)", value: fmt(conns) }],
    },
    peer: {
      status: rt ? "ok" : "idle",
      pulse: !!rt,
      metrics: [
        { label: "msgs émis", value: fmt(totals?.messagesSentTotal) },
        { label: "octets émis", value: fmt(totals?.bytesSentTotal) },
      ],
    },
    hub: {
      status: hubWarn ? "warn" : channels > 0 ? "ok" : "idle",
      pulse: channels > 0,
      metrics: [
        { label: "canaux", value: fmt(channels) },
        { label: "fan-out", value: fmt(fanout) },
        ...(hubWarn ? ([{ label: "slow", value: fmt(slow) }] as const) : []),
      ],
    },
    backplane: backplaneNode(snap.backplane),
    w1: workerNode(instances, 0, "canaux", (i) => fmt(i.channelCount)),
    w2: workerNode(instances, 1, "canaux", (i) => fmt(i.channelCount)),
  };
}

/**
 * Mapping pour le **graphe Fan-out** : un publish part d'un service vers le hub
 * local, qui notifie ses N abonnés ET forward au backplane (lequel relaie aux
 * autres workers).
 *
 * Les trois nœuds « abonné local » s'allument PAR RANG (`subscriberNode`) : le
 * 3ᵉ ne s'allume que si un canal porte ≥ 3 abonnés simultanés. La branche
 * cross-worker (hub B, ses abonnés) n'est alimentée qu'en vue pod agrégée avec
 * un second worker ; sinon elle reste neutre — c'est la topologie illustrée,
 * pas une mesure.
 */
export function mapFanOutLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const totals = rt?.totals;
  const channels = totals?.channelCount ?? 0;
  const fanout = totals?.fanoutTotal ?? 0;
  const publishes = totals?.publishTotal ?? 0;
  const bp = totals?.backpressure;
  const slow = bp?.slowConsumers ?? 0;
  const bpBytes = bp?.totalBufferedAmount ?? 0;
  const hubWarn = slow > 0 || bpBytes > 0;
  const active = fanout > 0;
  const instances = rt?.instances;
  const localSubs = maxSubscribers(instances?.[0]);
  const remote = instances?.[1];
  const remoteSubs = maxSubscribers(remote);
  return {
    source: {
      status: publishes > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "publish total", value: fmt(publishes) }],
    },
    hub: {
      status: hubWarn ? "warn" : channels > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [
        { label: "canaux", value: fmt(channels) },
        { label: "abonnés (max/canal)", value: fmt(localSubs) },
        { label: "fan-out", value: fmt(fanout) },
        ...(hubWarn ? ([{ label: "slow", value: fmt(slow) }] as const) : []),
      ],
    },
    peerA: subscriberNode(localSubs, 1, active),
    peerB: subscriberNode(localSubs, 2, active),
    peerC: subscriberNode(localSubs, 3, active),
    backplane: backplaneNode(snap.backplane),
    hubB: remote
      ? {
          status: "ok",
          pulse: active,
          metrics: [
            { label: "instance", value: remote.instanceId },
            { label: "fan-out", value: fmt(remote.fanoutTotal) },
          ],
        }
      : { status: "idle" },
    peerX: subscriberNode(remoteSubs, 1, active),
    peerY: subscriberNode(remoteSubs, 2, active),
  };
}

/**
 * Mapping pour le **graphe Protocole** — illustre les 4 types de frames
 * JSON-RPC 2.0 qui circulent sur la socket :
 *  - `notifyOut` : notifications client→server SANS `id` (subscribe / unsubscribe / publish)
 *  - `request`   : requêtes client→server AVEC `id` (nodefony:kernel:ping, …)
 *  - `response`  : réponses server→client (result / error, même `id`)
 *  - `notifyIn`  : notifications server→client SANS `id` (channel push, realtime:welcome)
 *
 * Le push `notifyIn` est le gros volume — son `pulse` suit `fanoutTotal`.
 * `request`/`response` n'ont AUCUN compteur dans la sonde : ils restent neutres
 * plutôt que de porter un chiffre emprunté à un autre flux.
 */
export function mapProtocoleLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const totals = rt?.totals;
  const connected = snap.clientState === "connected";
  const channels = totals?.channelCount ?? 0;
  const fanout = totals?.fanoutTotal ?? 0;
  const msgs = totals?.messagesSentTotal ?? 0;
  const conns = totals?.connectionCount ?? 0;
  return {
    client: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [{ label: "état", value: snap.clientState }],
    },
    server: {
      status: rt ? "ok" : "idle",
      pulse: !!rt,
      metrics: [{ label: "connexions", value: fmt(conns) }],
    },
    // Sans `id` — c'est ici que vivent les abonnements (le canal actif).
    // `inboundTotal` ne couvre QUE les frames full-duplex des canaux gated
    // (`RealtimeHub.recordInbound`), pas les subscribe/publish : son label le
    // précise pour ne pas le lire comme « tout le trafic montant ».
    notifyOut: {
      status: channels > 0 ? "ok" : "idle",
      pulse: channels > 0,
      metrics: [
        { label: "canaux abonnés", value: fmt(channels) },
        {
          label: "frames full-duplex",
          value: fmt(totals?.inboundTotal),
        },
      ],
    },
    // Sans `id` — c'est ici que vit le gros volume (push de la sonde, logs, …).
    notifyIn: {
      status: fanout > 0 ? "ok" : "idle",
      pulse: fanout > 0,
      metrics: [
        { label: "msgs émis", value: fmt(msgs) },
        { label: "fan-out", value: fmt(fanout) },
      ],
    },
    // Avec `id` — aucun compteur RPC dans la sonde.
    request: { status: "idle" },
    response: { status: "idle" },
  };
}

/**
 * Reconnaît un canal de sonde santé, suffixe de cadence compris. La convention
 * `rateChannel()` est `base:<ms>` (`nodefony:orm:health:5000`) : tester `endsWith(":health")`
 * rate tous les canaux cadencés. On ignore un dernier segment purement numérique
 * avant de comparer — sans allouer la sous-chaîne (ces mappings tournent à chaque
 * frame reçue).
 */
function isHealthChannel(channel: string): boolean {
  let end = channel.length;
  const lastColon = channel.lastIndexOf(":");
  if (lastColon !== -1 && lastColon < channel.length - 1) {
    let numericSuffix = true;
    for (let i = lastColon + 1; i < channel.length; i += 1) {
      const code = channel.charCodeAt(i);
      if (code < 48 || code > 57) {
        numericSuffix = false;
        break;
      }
    }
    if (numericSuffix) end = lastColon;
  }
  return end >= 7 && channel.startsWith(":health", end - 7);
}

/**
 * Mapping pour le **graphe Sondes** — illustre le patron en 5 pièces :
 *   probe → buildHealth → { endpoint HTTP, ticker WS } → canal → Studio.
 *
 * Le signal direct disponible = le canal `nodefony:socket` lui-même expose
 * la liste des canaux abonnés (`channels[]`) et leur trafic. On dérive :
 *  - nombre de canaux `*:health` actifs (sondes vivantes côté serveur)
 *  - somme des messages sur ces canaux (= ticks reçus)
 *
 * `probe`/`buildHealth`/`endpoint` n'ont pas de signal propre : recevoir une
 * frame prouve que l'agrégateur tourne (l'endpoint HTTP appelle le MÊME
 * constructeur), leur activité fine reste portée par le `ticker`.
 */
export function mapSondesLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const connected = snap.clientState === "connected";
  // Un seul parcours : compte des canaux santé + cumul de leurs publications.
  let sondesCount = 0;
  let totalTicks = 0;
  const instances = rt?.instances;
  if (instances) {
    for (let i = 0; i < instances.length; i += 1) {
      const list = instances[i].channels;
      for (let j = 0; j < list.length; j += 1) {
        const stat = list[j];
        if (!isHealthChannel(stat.channel)) continue;
        sondesCount += 1;
        totalTicks += stat.messages;
      }
    }
  }
  const live = sondesCount > 0;
  const active = live && totalTicks > 0;
  return {
    // Pièce 1 — la sonde dans le service métier (signal indirect).
    probe: {
      status: live ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "sondes actives", value: fmt(sondesCount) }],
    },
    // Pièce 2 — l'agrégateur pur (idem, signal porté par le ticker).
    health: {
      status: live ? "ok" : "idle",
      pulse: active,
    },
    // Pièce 3 — endpoint HTTP 1er paint. Studio l'appelle hors socket : aucun
    // compteur ne remonte ici, seule la présence de l'agrégateur est acquise.
    endpoint: { status: rt ? "ok" : "idle" },
    // Pièce 4 — provider ticker (cœur du temps réel).
    ticker: {
      status: live ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "ticks", value: fmt(totalTicks) }],
    },
    // Pièce 5a — canaux `<x>:health` du RealtimeHub.
    channel: {
      status: live ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "canaux *:health", value: fmt(sondesCount) }],
    },
    // Pièce 5b — Studio (abonné).
    studio: {
      status: connected ? "ok" : "idle",
      pulse: connected && active,
      metrics: [{ label: "état", value: snap.clientState }],
    },
  };
}

/** Drivers backplane natifs — un nœud du graphe par driver du registre. */
export const NATIVE_BACKPLANE_DRIVERS = [
  "loopback",
  "cluster",
  "redis",
] as const;

/** Le driver branché sort du registre natif → c'est un driver userland. */
function isCustomDriver(driver: string | undefined): boolean {
  if (!driver) return false;
  return !(NATIVE_BACKPLANE_DRIVERS as readonly string[]).includes(driver);
}

/**
 * Mapping pour le **graphe Backplane** — les workers du pod ↔ `IBackplane` ↔
 * les drivers du registre.
 *
 * Le driver RÉELLEMENT branché vient de la sonde (`backplane.driver`, alimenté
 * par `IBackplane.describe()`) : son nœud passe « ok » et porte transport +
 * cross-pod ; les autres restent des alternatives neutres. Les workers
 * s'alimentent de `instances[]` — hors vue pod agrégée, seul le premier existe.
 */
export function mapBackplaneLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const totals = rt?.totals;
  const fanout = totals?.fanoutTotal ?? 0;
  const publishes = totals?.publishTotal ?? 0;
  const active = fanout > 0;
  const instances = rt?.instances;
  const bp = snap.backplane;
  const driver = bp?.driver;
  const wired = backplaneWired(bp);
  const driverNode = (id: string): LiveNodeData => {
    if (driver !== id) return { status: "idle" };
    return {
      status: "ok",
      pulse: active,
      metrics: [
        { label: "actif", value: "✓" },
        { label: "transport", value: bp?.kind ?? "—" },
        { label: "cross-pod", value: bp?.crossPod ? "oui" : "non" },
      ],
    };
  };
  return {
    workerA: workerNode(instances, 0, "publish", (i) => fmt(i.publishTotal)),
    workerB: workerNode(instances, 1, "publish", (i) => fmt(i.publishTotal)),
    workerC: workerNode(instances, 2, "publish", (i) => fmt(i.publishTotal)),
    backplane: {
      status: wired ? "ok" : active ? "ok" : "idle",
      pulse: active,
      metrics: [
        { label: "driver", value: driver ?? "—" },
        { label: "publish total", value: fmt(publishes) },
        { label: "fan-out", value: fmt(fanout) },
      ],
    },
    loopback: driverNode("loopback"),
    cluster: driverNode("cluster"),
    redis: driverNode("redis"),
    // Driver userland (`registerBackplaneDriver`) : allumé seulement si le
    // driver branché n'est aucun des natifs.
    custom: isCustomDriver(driver)
      ? {
          status: "ok",
          pulse: active,
          metrics: [
            { label: "driver", value: driver ?? "—" },
            { label: "transport", value: bp?.kind ?? "—" },
          ],
        }
      : { status: "idle" },
  };
}

/**
 * Mapping pour le **graphe Actions** — pipeline RPC réel d'une frame avec `id` :
 *   request → résolution de méthode → beforeDispatch → handler → result,
 * avec le seam d'audit `onFrameAudit` sur les seules branches d'ERREUR.
 *
 * La sonde n'expose aucun compteur RPC : hors `request` (état client réel) et
 * `welcome` (le handshake est acquis dès qu'une frame arrive), les étapes
 * restent neutres. Elles ne portent PAS de métrique : leur rôle est décrit par
 * le `sub` du nœud, un bandeau chiffré ferait passer du texte pour une mesure.
 */
export function mapActionsLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const connected = snap.clientState === "connected";
  return {
    request: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [{ label: "client", value: connected ? "prêt" : "déconnecté" }],
    },
    // `realtime:welcome` est émis UNE fois au handshake : recevoir des frames
    // prouve qu'il est passé, rien de plus.
    welcome: {
      status: snap.rt ? "ok" : "idle",
    },
    resolve: { status: "idle" },
    authz: { status: "idle" },
    handler: { status: "idle" },
    audit: { status: "idle" },
    result: { status: "idle" },
  };
}
