import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  CLUSTER_PROBE_CTL_KIND,
  RichProcessProbe,
  readOrmRich,
  isClusterMessage,
  isClusterProbeEnrich,
} from "nodefony";
import type { ClusterProbeFacet } from "nodefony";
import type {
  IRealtimeHealth,
  IRealtimeClusterHealth,
} from "../../interfaces/IRealtimeProbe.js";

/**
 * Transport IPC de la sonde cluster côté worker — abstrait `process.send` / la réception
 * des snapshots du master, derrière un seam **injectable** (même pattern que
 * `IClusterBackplaneTransport`). Permet de tester le report + le cache **sans forker**.
 */
export interface IClusterProbeTransport {
  /** Émet une remontée de sonde vers le master (worker → master). No-op hors cluster. */
  send(report: unknown): void;
  /** Enregistre le récepteur des snapshots agrégés du master (master → worker). */
  onReceive(cb: (msg: unknown) => void): void;
}

/** Transport de production : `process.send` + `process.on("message")`. */
export const processProbeTransport: IClusterProbeTransport = {
  send(report) {
    process.send?.(report);
  },
  onReceive(cb) {
    process.on("message", (msg) => cb(msg));
  },
};

/**
 * Consolide N santés per-instance en une vue **POD** ({@link IRealtimeClusterHealth}).
 * Pur (aucune I/O) : somme les scalaires ; la backpressure `maxBufferedAmount` est un MAX
 * (le pire worker), `totalBufferedAmount`/`slowConsumers` des sommes.
 *
 * @param instances - santés per-instance (chaque worker, snapshot master).
 * @param ts - horodatage du snapshot (défaut maintenant).
 */
export function mergeClusterHealth(
  instances: IRealtimeHealth[],
  ts: number = Date.now(),
): IRealtimeClusterHealth {
  const totals: IRealtimeClusterHealth["totals"] = {
    channelCount: 0,
    publishTotal: 0,
    fanoutTotal: 0,
    inboundTotal: 0,
    connectionCount: 0,
    bytesSentTotal: 0,
    messagesSentTotal: 0,
    backpressure: {
      maxBufferedAmount: 0,
      totalBufferedAmount: 0,
      slowConsumers: 0,
      drops: 0,
    },
  };
  // Sondes ORM/erreurs (additives) : agrégées seulement si ≥ 1 worker les remonte.
  let orm: IRealtimeClusterHealth["totals"]["orm"] | undefined;
  let errors: IRealtimeClusterHealth["totals"]["errors"] | undefined;
  for (const h of instances) {
    totals.channelCount += h.channelCount;
    totals.publishTotal += h.publishTotal;
    totals.fanoutTotal += h.fanoutTotal;
    totals.inboundTotal += h.inboundTotal;
    totals.connectionCount += h.connectionCount;
    totals.bytesSentTotal += h.bytesSentTotal;
    totals.messagesSentTotal += h.messagesSentTotal;
    const bp = h.backpressure;
    if (bp.maxBufferedAmount > totals.backpressure.maxBufferedAmount) {
      totals.backpressure.maxBufferedAmount = bp.maxBufferedAmount;
    }
    totals.backpressure.totalBufferedAmount += bp.totalBufferedAmount;
    totals.backpressure.slowConsumers += bp.slowConsumers;
    totals.backpressure.drops += bp.drops;
    if (h.orm) {
      orm ??= {
        connectors: 0,
        connected: 0,
        queryTotal: 0,
        slowTotal: 0,
        errorTotal: 0,
        reconnectTotal: 0,
        maxEwmaMs: null,
      };
      orm.connectors += h.orm.connectors;
      orm.connected += h.orm.connected;
      orm.queryTotal += h.orm.queryTotal;
      orm.slowTotal += h.orm.slowTotal;
      orm.errorTotal += h.orm.errorTotal;
      orm.reconnectTotal += h.orm.reconnectTotal;
      if (
        h.orm.maxEwmaMs !== null &&
        (orm.maxEwmaMs === null || h.orm.maxEwmaMs > orm.maxEwmaMs)
      ) {
        orm.maxEwmaMs = h.orm.maxEwmaMs;
      }
    }
    if (h.errors) {
      errors ??= { errorTotal: 0, criticTotal: 0 };
      errors.errorTotal += h.errors.errorTotal;
      errors.criticTotal += h.errors.criticTotal;
    }
  }
  if (orm) totals.orm = orm;
  if (errors) totals.errors = errors;
  return {
    cluster: true,
    ts,
    instanceCount: instances.length,
    instances,
    totals,
  };
}

/**
 * Client de sonde cluster **côté worker** (Phase 4c) — le pendant de
 * {@link ClusterProbeAggregator} (master). Deux rôles :
 *  - **report** : envoie périodiquement sa santé per-instance au master (`CLUSTER_PROBE_KIND`) ;
 *  - **cache** : reçoit le snapshot agrégé du master (`CLUSTER_PROBE_SNAPSHOT_KIND`) et le garde
 *    → n'importe quel worker sert la vue POD en O(1) (modèle push : 0 latence de requête).
 *
 * **Bypass total quand désactivé** : ce client n'est instancié/`start()` QUE par le module
 * Framework en worker de cluster AVEC la sonde activée. Sinon (mono-process, ou sonde coupée)
 * il n'existe pas → aucun timer, aucun listener, aucun IPC, et {@link clusterProbeHealth}
 * renvoie `null` → l'endpoint santé retombe sur la vue per-instance. Aucun coût « au cas où ».
 *
 * Perf : 1 timer `unref` (report) + 1 listener IPC. Le report sérialise 1 santé / intervalle
 * (≥ 1 s, jamais hot path). SERVEUR uniquement.
 */
export class ClusterProbeClient {
  readonly #transport: IClusterProbeTransport;
  readonly #intervalMs: number;
  #lastInstances: IRealtimeHealth[] | null = null;
  #snapTs = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;
  // Drill-down (Phase 2) : sonde riche de CE worker, allouée SEULEMENT quand le master
  // demande l'enrichissement (`nf:probe:enrich {enabled:true}`) → « on paie ce qu'on
  // regarde ». Le rich voyage ensuite dans le report → snapshot pod → vue Supervision.
  #richProbe: RichProcessProbe | null = null;
  #richEnabled = false;
  // Drill-down ORM (facette "orm") : dernier blob de diagnostic ORM riche de CE worker,
  // rafraîchi par un ticker SEULEMENT pendant le drill (le `connection/health` est async
  // → on ne peut pas le lire dans le report sync). Joint au report tant qu'il est non-null.
  #ormRich: unknown = null;
  #ormRichTimer: ReturnType<typeof setInterval> | null = null;
  #ormRichEnabled = false;

  constructor(
    transport: IClusterProbeTransport = processProbeTransport,
    intervalMs = 2000,
  ) {
    this.#transport = transport;
    this.#intervalMs = intervalMs;
  }

  /**
   * Démarre le report périodique + l'écoute des snapshots. Idempotent. 1ᵉʳ report immédiat.
   *
   * @param buildOwn - fournit la santé per-instance courante (capturée à chaque tick).
   */
  start(buildOwn: () => IRealtimeHealth): void {
    if (this.#started) return;
    this.#started = true;
    this.#transport.onReceive((msg) => this.#ingest(msg));
    this.#report(buildOwn); // 1ᵉʳ report immédiat (pas d'attente)
    this.#timer = setInterval(() => this.#report(buildOwn), this.#intervalMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  #report(buildOwn: () => IRealtimeHealth): void {
    const payload = buildOwn();
    // Drill-down actif sur CE worker → joindre la sonde riche au report. Lazy : la sonde
    // (+ son observer GC) n'existe que pendant le drill, libérée dès `stop`/désactivation.
    if (this.#richEnabled) {
      if (this.#richProbe === null) this.#richProbe = new RichProcessProbe();
      payload.rich = this.#richProbe.read();
    }
    // Drill ORM actif sur CE worker → joindre le dernier blob ORM riche en cache (produit
    // par le ticker async #startOrmRich). Voyage ensuite dans le snapshot pod → canal
    // `orm:rich@<pid>`. Absent hors drill (cache null) → 0 surcoût.
    if (this.#ormRich !== null) payload.ormRich = this.#ormRich;
    this.#transport.send({ kind: CLUSTER_PROBE_KIND, payload });
  }

  /**
   * Démarre le rafraîchissement périodique du blob ORM riche (facette `"orm"`). Idempotent.
   * Le `connection/health` étant ASYNC (ping), on ne peut pas le lire dans le report sync :
   * un ticker `unref` met à jour le cache `#ormRich`, que le report joint ensuite. 1ᵉʳ fetch
   * immédiat. No-op si aucun driver n'a branché `setOrmRichProvider` (`readOrmRich() === null`).
   */
  #startOrmRich(): void {
    if (this.#ormRichTimer !== null) return;
    const refresh = (): void => {
      const p = readOrmRich();
      if (p === null) {
        this.#ormRich = null;
        return;
      }
      p.then((r) => {
        // Garde anti-course : ne garder le résultat que si le drill est toujours actif.
        if (this.#ormRichEnabled) this.#ormRich = r;
      }).catch(() => {
        /* best-effort : un tick raté n'interrompt pas le drill */
      });
    };
    refresh();
    this.#ormRichTimer = setInterval(refresh, this.#intervalMs);
    (this.#ormRichTimer as { unref?: () => void }).unref?.();
  }

  /** Arrête le rafraîchissement ORM riche et purge le cache. Idempotent. */
  #stopOrmRich(): void {
    if (this.#ormRichTimer !== null) {
      clearInterval(this.#ormRichTimer);
      this.#ormRichTimer = null;
    }
    this.#ormRich = null;
  }

  /**
   * Demande au master d'(arrêter d')enrichir le worker `pid` sur une **facette** (drill-down).
   * Émis par le worker qui tient la connexion navigateur quand un client subscribe/unsubscribe
   * le canal `dashboard:supervision@<pid>` (facette `"process"`) ou `orm:rich@<pid>` (facette
   * `"orm"`). No-op hors cluster (`send` no-op).
   *
   * @param pid - worker ciblé (identité de la vue pod).
   * @param enable - `true` = activer la sonde riche sur ce worker, `false` = la couper.
   * @param facet - quelle sonde riche cibler (défaut `"process"`).
   */
  requestEnrich(
    pid: number,
    enable: boolean,
    facet: ClusterProbeFacet = "process",
  ): void {
    this.#transport.send({
      kind: CLUSTER_PROBE_CTL_KIND,
      op: enable ? "enrich" : "stop",
      pid,
      facet,
    });
  }

  /**
   * Met en cache le dernier snapshot agrégé, OU applique un ordre d'enrichissement ciblé
   * du master (`nf:probe:enrich`). Ignore les autres kinds + malformés.
   */
  #ingest(msg: unknown): void {
    if (isClusterProbeEnrich(msg)) {
      // Facette ORM : (dés)active le ticker de cache ORM riche (indépendant du process).
      if ((msg.facet ?? "process") === "orm") {
        this.#ormRichEnabled = msg.enabled;
        if (msg.enabled) this.#startOrmRich();
        else this.#stopOrmRich();
        return;
      }
      // Facette process (défaut) : sonde process riche.
      this.#richEnabled = msg.enabled;
      // Désactivation → libérer immédiatement la sonde riche (détache l'observer GC).
      if (!msg.enabled && this.#richProbe !== null) {
        this.#richProbe.disable();
        this.#richProbe = null;
      }
      return;
    }
    if (!isClusterMessage(msg) || msg.kind !== CLUSTER_PROBE_SNAPSHOT_KIND) {
      return;
    }
    const snap = msg as { ts?: unknown; instances?: unknown };
    if (Array.isArray(snap.instances)) {
      this.#lastInstances = snap.instances as IRealtimeHealth[];
      this.#snapTs = typeof snap.ts === "number" ? snap.ts : Date.now();
    }
  }

  /** Vue POD agrégée, ou `null` tant qu'aucun snapshot n'est reçu (cold start). */
  getClusterHealth(): IRealtimeClusterHealth | null {
    if (this.#lastInstances === null) return null;
    return mergeClusterHealth(this.#lastInstances, this.#snapTs);
  }

  /** Arrête le report et purge le cache. Idempotent. Libère la sonde riche (drill). */
  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#started = false;
    this.#lastInstances = null;
    this.#richEnabled = false;
    if (this.#richProbe !== null) {
      this.#richProbe.disable();
      this.#richProbe = null;
    }
    this.#ormRichEnabled = false;
    this.#stopOrmRich();
  }
}

// Singleton worker (1 par process). `null` = sonde cluster non branchée (mono-process ou
// désactivée) → bypass total. Branché par le module Framework en worker de cluster.
let _client: ClusterProbeClient | null = null;

/** Branche le client de sonde cluster du process (worker). Remplace un éventuel précédent. */
export function setClusterProbeClient(
  client: ClusterProbeClient,
): ClusterProbeClient {
  _client = client;
  return client;
}

/**
 * Vue POD agrégée si la sonde cluster est branchée ET a reçu un snapshot, sinon `null`.
 * `null` ⇒ l'endpoint santé sert la vue per-instance (mono-process / sonde désactivée /
 * cold start). Lecture pure, jamais throw.
 */
export function clusterProbeHealth(): IRealtimeClusterHealth | null {
  return _client?.getClusterHealth() ?? null;
}

/**
 * Demande au master d'(arrêter d')enrichir le worker `pid` sur une **facette** (drill-down
 * Phase 2). Facettes indépendantes : `"process"` (supervision) et `"orm"` (drill ORM).
 *
 * @param pid - worker ciblé.
 * @param enable - activer/couper la sonde riche.
 * @param facet - quelle sonde riche cibler (défaut `"process"`).
 * @returns `true` si la sonde cluster est branchée (worker de cluster) → l'ordre est émis ;
 *   `false` en mono-process / sonde désactivée (pas de drill cross-worker possible → le
 *   consommateur retombe sur la sonde riche locale du process courant).
 */
export function clusterProbeRequestEnrich(
  pid: number,
  enable: boolean,
  facet: ClusterProbeFacet = "process",
): boolean {
  if (_client === null) return false;
  _client.requestEnrich(pid, enable, facet);
  return true;
}

/**
 * Santé d'UN worker `pid` extraite du dernier snapshot pod (avec sa sonde riche si le
 * drill est actif), ou `null` (mono-process, pid inconnu, ou cold start). Lecture pure.
 */
export function clusterProbeInstance(pid: number): IRealtimeHealth | null {
  const health = _client?.getClusterHealth();
  if (!health) return null;
  return (
    health.instances.find(
      (i) => i.process?.pid === pid || i.instanceId === String(pid),
    ) ?? null
  );
}

export default ClusterProbeClient;
