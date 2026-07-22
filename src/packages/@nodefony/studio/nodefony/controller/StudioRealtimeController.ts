/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import type { IAdminBroker } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import { Context } from "@nodefony/http";
import type { IAdminRequest, RpcActionHandler, RateBounds } from "nodefony";
import { parseRate } from "nodefony";
import {
  createSyslogBridge,
  createStatsTicker,
  createBrokerTicker,
  readGitBranch,
  CHANNELS,
  type AppMeta,
} from "../realtime/providers";
import { createClusterSupervisionTicker } from "../realtime/clusterSupervision";
import { createClusterOrmTicker } from "../realtime/clusterOrm";
import type ScaffoldService from "../service/ScaffoldService";
import {
  SCAFFOLD_STEPS,
  type ScaffoldStep,
  type IScaffoldJobState,
} from "../service/ScaffoldService";
import type { TScaffoldAnswers } from "nodefony";
import { PLATFORM_CHANNELS, PLATFORM_METHODS } from "nodefony";

/**
 * Canal de drill-down d'un worker du cluster : `nodefony:supervision@<pid>` avec granularité
 * `:<ms>` optionnelle. Capture le `pid` ciblé. Le `@` (vs `:`) évite toute collision avec le
 * canal supervision normal et son suffixe de cadence.
 */
const SUPERVISION_DRILL_RE = new RegExp(
  `^${CHANNELS.supervision}@(\\d+)(?::\\d+)?$`,
);

/**
 * Canal de drill ORM d'un worker du cluster : `nodefony:orm:rich@<pid>` (granularité `:<ms>` optionnelle).
 * Livre le diagnostic ORM RICHE (`connection/health` + `flow`) du worker `pid` EXACT — combine,
 * en un canal, les sources séparées `nodefony:orm:health`/`nodefony:orm:flow` (qui, elles, tombent sur un worker
 * round-robin en cluster). Un seul canal = un seul enrich = pas de ref-count.
 */
const ORM_RICH_DRILL_RE = /^nodefony:orm:rich@(\d+)(?::\d+)?$/;

/**
 * Flux d'un job de génération de code : `nodefony:scaffold:job@<uuid>`.
 *
 * Ce canal n'est pas cadencé (pas de suffixe `:<ms>`) : il ne sonde rien, il RELAIE ce
 * que le job produit — une ligne écrite est une ligne poussée. À l'abonnement, le
 * backlog déjà produit est rejoué, si bien qu'un abonné tardif (ou une page rechargée)
 * ne perd aucune ligne.
 */
const SCAFFOLD_JOB_RE =
  /^nodefony:scaffold:job@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Bornes de cadence par canal cadencé — défaut + min/max (ms). Convention partagée avec
 * le front via {@link rateChannel}/{@link parseRate} (module isomorphe `nodefony`).
 */
const RATE_BOUNDS: Readonly<Record<string, RateBounds>> = {
  // Stats process (supervision page ET debug bar) : même ticker, canaux séparés.
  stats: { default: 1000, min: 250, max: 60000 },
  ormHealth: { default: 5000, min: 1000, max: 60000 },
  // Flux ORM : plus dynamique → défaut 2 s.
  ormFlow: { default: 2000, min: 500, max: 60000 },
  // Drill ORM riche @pid : combine ping (connection/health) + flux → un peu plus lourd
  // (le ping émet une requête) → défaut 3 s, plancher 1 s.
  ormRich: { default: 3000, min: 1000, max: 60000 },
  // Santé de la socket Nodefony (auto-observabilité) : backpressure + fan-out.
  // Défaut 2 s (le débit se dérive de snapshots ; trop fin = bruit, trop lent = perd les pics).
  realtimeHealth: { default: 2000, min: 500, max: 60000 },
};

/**
 * StudioRealtimeController — endpoint WebSocket temps réel permanent de Studio.
 *
 * Route : `WS /nodefony/studio/api/realtime`. Protocole : **JSON-RPC 2.0**.
 *
 * Dérive de {@link RealtimeController} (framework) : TOUT le protocole (handshake,
 * discrimination request/notification/response via `JsonRpcPeer`, actions, pub/sub
 * par canal, cleanup, perf) est porté par la base. Ce contrôleur ne déclare QUE son
 * métier : ses **canaux** ({@link createRealtimeChannel}) et ses **actions**
 * ({@link realtimeActions}).
 *
 * ── Canaux (pub/sub on-demand) ──
 *  - `nodefony:syslog` (Pdu kernel), `nodefony:dashboard`/`nodefony:supervision`,
 *    `nodefony:debugbar`, `nodefony:orm:health`, `nodefony:orm:flow` (suffixe `:<ms>` = granularité).
 * ── Actions (requête→réponse) ──
 *  - `nodefony:kernel:ping` (liveness/RTT), `nodefony:kernel:gc` (force GC si `--expose-gc`).
 *
 * Forward-compat P13.4 : la base + ces providers migrent dans `RealtimeService`.
 */
@controller("/nodefony/studio/api")
class StudioRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("StudioRealtimeController", context);
  }

  @route("studio-ws-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Canaux annoncés au handshake. */
  protected override realtimeChannels(): string[] {
    return Object.values(CHANNELS);
  }

  /** Actions RPC (requête→réponse, direction contrôle). */
  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      [PLATFORM_METHODS.ping]: () => this.actionPing(),
      [PLATFORM_METHODS.gc]: () => this.actionGc(),
      [PLATFORM_METHODS.scaffoldRun]: (params) =>
        this.actionScaffoldRun(params),
      [PLATFORM_METHODS.scaffoldCancel]: (params) =>
        this.actionScaffoldCancel(params),
    };
  }

  /**
   * Lance un job de génération de code et rend son identifiant SANS attendre : le front
   * s'abonne à `nodefony:scaffold:job@<id>` et regarde le travail se faire.
   *
   * Le client ne transmet **aucune commande** — seulement un type, des réponses de
   * formulaire (que le moteur valide contre sa propre spec) et des étapes prises dans une
   * liste fermée. C'est ce qui sépare « piloter un générateur » de « exécuter du shell à
   * distance ».
   *
   * @throws si le service est absent ou hors développement (→ `-32603` côté client, le
   *   détail restant côté serveur).
   */
  private actionScaffoldRun(params: unknown): IScaffoldJobState {
    const svc = this.get<ScaffoldService>("scaffold");
    if (!svc?.enabled) throw new Error("scaffold is development-only");

    const p = (params ?? {}) as {
      type?: unknown;
      answers?: unknown;
      steps?: unknown;
    };
    if (typeof p.type !== "string") throw new Error("type manquant");

    const answers = (
      p.answers && typeof p.answers === "object" ? p.answers : {}
    ) as TScaffoldAnswers;

    // Allowlist : tout ce qui n'est pas une étape connue est jeté, pas exécuté.
    const steps = (Array.isArray(p.steps) ? p.steps : []).filter(
      (s): s is ScaffoldStep =>
        typeof s === "string" &&
        (SCAFFOLD_STEPS as readonly string[]).includes(s),
    );

    return svc.start(p.type, answers, steps);
  }

  /** Interrompt le process en cours d'un job (bouton « arrêter »). */
  private actionScaffoldCancel(params: unknown): { cancelled: boolean } {
    const svc = this.get<ScaffoldService>("scaffold");
    if (!svc?.enabled) throw new Error("scaffold is development-only");
    const id = (params as { id?: unknown })?.id;
    if (typeof id !== "string") throw new Error("id manquant");
    return { cancelled: svc.cancel(id) };
  }

  /**
   * Pont API souverain ACTIVÉ (POC Ph.3) : la socket Studio sert
   * `api.request {path}` → `socket.request("/nodefony/<module>/api/…")` côté
   * front (snapshot ≡ GET REST, même action). Studio mange sa propre cuisine —
   * 1ᵉʳ consommateur réel du pont.
   */
  protected override realtimeApiRequest(): boolean {
    return true;
  }

  /**
   * Crée le provider d'un canal au `subscribe`. Le suffixe `:<ms>` (borné) pilote la
   * granularité. Renvoie le `dispose` (la base l'appelle au `unsubscribe` ET au close)
   * ou `null` si le canal est inconnu.
   */
  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    // Flux d'un job de génération de code. Aucun ticker : on relaie les lignes que le
    // job produit. Le service rejoue d'abord le backlog → un abonné tardif voit TOUT
    // depuis le début, ce qui rend le terminal insensible à la course
    // « je reçois l'id / je m'abonne ».
    const scaffoldJob = SCAFFOLD_JOB_RE.exec(channel);
    if (scaffoldJob) {
      const svc = this.get<ScaffoldService>("scaffold");
      if (!svc?.enabled) return null;
      const jobId = scaffoldJob[1] as string;
      // On relaie l'ÉVÉNEMENT (ligne ou état), pas seulement la ligne : sinon le front
      // n'apprendrait jamais par la socket qu'un job est terminé, et devrait sonder le
      // serveur en boucle alors que la connexion est déjà là.
      return svc.subscribe(jobId, (event) => publish(channel, event));
    }

    // Base « stats process » : supervision (page) ET debug bar partagent le MÊME
    // ticker (sondes process) mais sur des canaux SÉPARÉS.
    const statsBase =
      channel === CHANNELS.supervision ||
      channel.startsWith(`${CHANNELS.supervision}:`)
        ? CHANNELS.supervision
        : channel === CHANNELS.debugbar ||
            channel.startsWith(`${CHANNELS.debugbar}:`)
          ? CHANNELS.debugbar
          : null;

    // Drill-down cluster : supervision RICHE d'UN worker ciblé par pid. Testé AVANT
    // `statsBase` (le `@<pid>` ne matche pas `nodefony:supervision:` mais on lève toute
    // ambiguïté en priorisant le drill).
    const drill = SUPERVISION_DRILL_RE.exec(channel);
    if (drill) {
      const pid = Number(drill[1]);
      const base = `${CHANNELS.supervision}@${pid}`;
      const ms = parseRate(channel, base, RATE_BOUNDS.stats);
      if (pid === process.pid) {
        // Cible = CE worker (ou mono-process) → sonde locale directe, pas d'IPC cluster.
        // createStatsTicker produit déjà le format complet de la supervision.
        return createStatsTicker(
          publish,
          ms,
          this.appMeta(),
          channel,
          this.syslog ?? undefined,
        );
      }
      // Worker DISTANT → enrichissement à la demande via le master (voie B1).
      return createClusterSupervisionTicker(
        publish,
        channel,
        pid,
        ms,
        this.appMeta(),
      );
    }

    // Drill ORM riche d'UN worker ciblé par pid (`nodefony:orm:rich@<pid>`) : connection/health + flow
    // du worker EXACT. En mono / worker courant → combine localement via le broker ; worker
    // distant → enrichissement ORM à la demande via le master (facette "orm", voie B1).
    const ormDrill = ORM_RICH_DRILL_RE.exec(channel);
    if (ormDrill) {
      const pid = Number(ormDrill[1]);
      const base = `${PLATFORM_CHANNELS.ormRich}@${pid}`;
      const ms = parseRate(channel, base, RATE_BOUNDS.ormRich);
      if (pid === process.pid) {
        // CE worker (ou mono-process) → diagnostic riche local exact, sans IPC cluster.
        const broker = this.get<IAdminBroker>("adminBroker");
        return createBrokerTicker(
          async () => ({
            pid,
            ts: Date.now(),
            richPending: false,
            health: await StudioRealtimeController.fetchAdminEndpoint(
              broker,
              "orm",
              "connection/health",
            ),
            flow: await StudioRealtimeController.fetchAdminEndpoint(
              broker,
              "orm",
              "flow",
            ),
          }),
          publish,
          channel,
          ms,
        );
      }
      return createClusterOrmTicker(publish, channel, pid, ms);
    }

    if (channel === CHANNELS.syslog && this.syslog) {
      return createSyslogBridge(this.syslog, publish);
    }
    if (statsBase) {
      // Granularité client via suffixe `:<ms>` (borné 250 ms–60 s). Défaut 1 s.
      const ms = parseRate(channel, statsBase, RATE_BOUNDS.stats);
      // La supervision compte les erreurs CÔTÉ SERVEUR (syslog passé) → pas besoin
      // d'abonner le dashboard à nodefony:syslog. La debug bar non.
      const sysForErrors =
        statsBase === CHANNELS.supervision ? this.syslog : undefined;
      return createStatsTicker(
        publish,
        ms,
        this.appMeta(),
        channel,
        sysForErrors ?? undefined,
      );
    }
    if (
      channel === CHANNELS.ormHealth ||
      channel.startsWith(`${CHANNELS.ormHealth}:`)
    ) {
      // Granularité `nodefony:orm:health:<ms>` (borné 1–60 s). Défaut 5 s.
      const ms = parseRate(channel, CHANNELS.ormHealth, RATE_BOUNDS.ormHealth);
      // Broker capturé À LA CRÉATION (singleton long-lived) : le provider est PARTAGÉ
      // par le hub et survit à la connexion qui l'a créé — ne JAMAIS capturer `this`.
      const broker = this.get<IAdminBroker>("adminBroker");
      return createBrokerTicker(
        () =>
          StudioRealtimeController.fetchAdminEndpoint(
            broker,
            "orm",
            "connection/health",
          ),
        publish,
        channel,
        ms,
      );
    }
    if (
      channel === CHANNELS.ormFlow ||
      channel.startsWith(`${CHANNELS.ormFlow}:`)
    ) {
      // Flux ORM : plus dynamique → défaut 2 s (borné 500 ms–60 s).
      const ms = parseRate(channel, CHANNELS.ormFlow, RATE_BOUNDS.ormFlow);
      const broker = this.get<IAdminBroker>("adminBroker");
      return createBrokerTicker(
        () =>
          StudioRealtimeController.fetchAdminEndpoint(broker, "orm", "flow"),
        publish,
        channel,
        ms,
      );
    }
    if (
      channel === CHANNELS.realtimeHealth ||
      channel.startsWith(`${CHANNELS.realtimeHealth}:`)
    ) {
      // Santé de la socket Nodefony (sonde du RealtimeHub) — défaut 2 s (500 ms–60 s).
      const ms = parseRate(
        channel,
        CHANNELS.realtimeHealth,
        RATE_BOUNDS.realtimeHealth,
      );
      const broker = this.get<IAdminBroker>("adminBroker");
      return createBrokerTicker(
        () =>
          StudioRealtimeController.fetchAdminEndpoint(
            broker,
            "realtime",
            "health",
          ),
        publish,
        channel,
        ms,
      );
    }
    return null;
  }

  /**
   * Action `nodefony:kernel:ping` — liveness + round-trip (le client mesure le RTT). Lecture
   * pure, aucun effet de bord.
   */
  private actionPing(): {
    pong: true;
    ts: number;
    uptime: number;
    pid: number;
    version?: string;
  } {
    return {
      pong: true,
      ts: Date.now(),
      uptime: process.uptime(),
      pid: process.pid,
      version: this.kernel?.version,
    };
  }

  /**
   * Action `nodefony:kernel:gc` — force un cycle GC V8 si lancé avec `--expose-gc`. Renvoie le
   * delta heap (futur bouton « Force GC »). `available:false` sinon (dégradation gracieuse).
   */
  private actionGc(): {
    available: boolean;
    before?: number;
    after?: number;
    freed?: number;
  } {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== "function") return { available: false };
    const before = process.memoryUsage().heapUsed;
    gc();
    const after = process.memoryUsage().heapUsed;
    return { available: true, before, after, freed: before - after };
  }

  /**
   * Appelle un endpoint admin (`<namespace>/<path>`) via le broker — Studio reste
   * GÉNÉRIQUE (aucune dép directe au module producteur : orm-core, framework…). `null`
   * si le producteur ou l'endpoint est absent.
   *
   * **Statique** + `broker` en paramètre : appelé depuis un provider de canal PARTAGÉ
   * (hub), qui doit capturer le broker (singleton long-lived) à la création, JAMAIS
   * `this` (la connexion créatrice peut fermer alors que le provider partagé survit).
   */
  private static async fetchAdminEndpoint(
    broker: IAdminBroker | null | undefined,
    namespace: string,
    path: string,
  ): Promise<unknown> {
    const producer = broker?.list().find((p) => p.adminNamespace === namespace);
    const ep = producer?.adminEndpoints().find((e) => e.path === path);
    if (!ep) return null;
    return ep.handler({
      params: {},
      query: {},
      body: null,
      user: null,
      roles: [],
    } as IAdminRequest);
  }

  /** Métadonnées app statiques (env, branche git, version) pour `nodefony:supervision`. */
  private appMeta(): AppMeta {
    const k = this.kernel;
    return {
      name: k?.projectName,
      version: k?.version,
      env: k?.environment,
      debug: Boolean(k?.debug),
      branch: readGitBranch(),
    };
  }
}

export default StudioRealtimeController;
