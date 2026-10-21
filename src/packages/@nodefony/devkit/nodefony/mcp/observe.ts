import { setTimeout as delay } from "node:timers/promises";
import {
  ProcessProbe,
  type IMcpCaller,
  type IMcpTool,
  type IMcpToolResult,
  type IMcpToolRun,
} from "nodefony";
import { mcpText, MCP_RESERVED_PREFIX } from "@nodefony/ai";
import {
  createProfileAggregator,
  isFailedProfile,
  type IProfilerReader,
} from "@nodefony/http";
import {
  progressLine,
  renderProfileReport,
  type RequestLogs,
} from "./profileReport";

/** Fenêtre d'observation par défaut, en secondes. */
export const OBSERVE_DEFAULT_SEC = 10;

/**
 * Fenêtre maximale, en secondes. Sous les 60 s qu'un client MCP attend par
 * défaut avant d'abandonner une requête : au-delà, l'agent couperait l'appel
 * juste avant le rapport.
 */
export const OBSERVE_MAX_SEC = 50;

/** Intervalle entre deux relevés, en ms : un instantané de progression par relevé. */
export const OBSERVE_TICK_MS = 2000;

/**
 * Requêtes en erreur dont on lit le journal, au plus — les mêmes que les
 * exemples d'erreurs du rapport, dans le même ordre.
 */
export const OBSERVE_ERROR_LOGS_MAX = 10;

/**
 * Délai maximal, en ms, pendant lequel l'arrêt du serveur attend que le
 * rapport parte : le superviseur de développement tue le process 4 s après
 * le lui avoir demandé.
 */
const SHUTDOWN_REPORT_MAX_MS = 1000;

/** Marge, en ms, laissée à la porte pour écrire le rapport une fois rendu. */
const SHUTDOWN_REPORT_FLUSH_MS = 100;

/** La sonde du process : ce que l'outil lit du process à chaque relevé. */
export interface IObserveProbe {
  read(): { eventLoopMs: number; eventLoopMaxMs: number; heapUsed: number };
  dispose(): void;
}

/** Ce dont l'outil a besoin — injecté, pour l'éprouver sans application. */
export interface IObserveDeps {
  /** Le profileur de l'application, ou `undefined` (production, `@nodefony/http` absent). */
  getProfiler: () => IProfilerReader | undefined;
  /** Intervalle entre deux relevés (défaut {@link OBSERVE_TICK_MS}). */
  tickMs?: number | undefined;
  /** Fabrique de la sonde du process (défaut : `ProcessProbe` du cœur). */
  createProbe?: (() => IObserveProbe) | undefined;
  /**
   * Lit les lignes de journal d'une requête (syslog de l'application, par
   * `requestId`). Absent : le rapport renvoie à `nodefony_admin_call`.
   */
  readRequestLogs?:
    | ((requestId: string, caller: IMcpCaller) => Promise<RequestLogs>)
    | undefined;
  /**
   * S'abonne à l'arrêt du serveur pour la durée d'UN appel, et rend de quoi
   * se désabonner. L'arrêt attend la promesse de l'écouteur (bornée) : le
   * temps que le rapport partiel parte.
   */
  onShutdown?: ((listener: () => Promise<void>) => () => void) | undefined;
}

/**
 * Reconnaît un profileur par sa FORME : le conteneur le rend sous le nom
 * `"profiler"`, et ce module ne dépend pas de sa classe.
 *
 * @param value - ce que le conteneur a rendu.
 * @returns le lecteur, ou `undefined` s'il ne tient pas le contrat.
 */
export function asProfilerReader(value: unknown): IProfilerReader | undefined {
  return isProfilerReader(value) ? value : undefined;
}

function isProfilerReader(value: unknown): value is IProfilerReader {
  return (
    typeof value === "object" &&
    value !== null &&
    "cursor" in value &&
    typeof value.cursor === "number" &&
    "since" in value &&
    typeof value.since === "function" &&
    "get" in value &&
    typeof value.get === "function"
  );
}

/** Durée demandée, bornée — et la remarque à faire si elle a été corrigée. */
function readDuration(raw: unknown): { sec: number; note: string | null } {
  if (raw === undefined) return { sec: OBSERVE_DEFAULT_SEC, note: null };
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      sec: OBSERVE_DEFAULT_SEC,
      note: `durationSec illisible, fenêtre par défaut de ${OBSERVE_DEFAULT_SEC} s`,
    };
  }
  const sec = Math.min(Math.max(Math.round(raw), 1), OBSERVE_MAX_SEC);
  return {
    sec,
    note:
      sec === raw
        ? null
        : `durationSec ramenée à ${sec} s (bornes 1–${OBSERVE_MAX_SEC})`,
  };
}

/**
 * L'outil `nodefony_observe` : observe l'application qui tourne pendant une
 * fenêtre bornée et rend ce que le profileur de développement a mesuré —
 * routes lentes et où part leur temps, N+1, requêtes SQL coûteuses, erreurs,
 * charge du process.
 *
 * C'est un outil LONG : un relevé toutes les deux secondes, chacun envoyé à
 * l'agent en progression ; l'agent qui abandonne l'appel l'arrête au relevé
 * suivant. Rien n'est armé en dehors d'un appel : un minuteur par relevé,
 * libéré par l'annulation elle-même, et la sonde du process libérée en sortie.
 *
 * @param deps - le profileur et, pour les tests, la cadence et la sonde.
 */
export function observeTool(deps: IObserveDeps): IMcpTool {
  const tickMs = deps.tickMs ?? OBSERVE_TICK_MS;
  const createProbe =
    deps.createProbe ?? ((): IObserveProbe => new ProcessProbe());
  return {
    name: `${MCP_RESERVED_PREFIX}observe`,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      "Observe l'application Nodefony qui tourne pendant une fenêtre de " +
      `quelques secondes (défaut ${OBSERVE_DEFAULT_SEC}, max ${OBSERVE_MAX_SEC}) et rend ce que ` +
      "son profileur de développement a mesuré sur les requêtes reçues : " +
      "les routes lentes et OÙ part leur temps (code de l'action, rendu, SQL, " +
      "pare-feu), les N+1 (même requête SQL répétée dans une requête HTTP), les " +
      "requêtes SQL les plus coûteuses (valeurs masquées), les erreurs 5xx avec " +
      "leur requestId, et la charge de la boucle d'événements.\n\n" +
      "À utiliser APRÈS avoir modifié un contrôleur, un service ou une requête, " +
      "pour vérifier l'effet sur l'application réelle. L'outil ne génère AUCUN " +
      "trafic : lancer pendant la fenêtre ce qui sollicite le code (ouvrir la " +
      "page, jouer les tests, une charge). Ne pas modifier de fichier pendant la " +
      "fenêtre — le serveur de développement redémarrerait : l'outil rend alors un " +
      "rapport partiel qui le dit. Les erreurs 5xx arrivent avec leurs lignes de " +
      "journal. Un instantané est envoyé en progression à chaque relevé.",
    inputSchema: {
      type: "object",
      properties: {
        durationSec: {
          type: "integer",
          minimum: 1,
          maximum: OBSERVE_MAX_SEC,
          description: `Durée de l'observation en secondes (défaut ${OBSERVE_DEFAULT_SEC})`,
        },
        route: {
          type: "string",
          description:
            "Restreindre à une route, par son NOM (celui que rend `nodefony_inspect` sujet `routes`)",
        },
        includeTooling: {
          type: "boolean",
          description:
            "Inclure les requêtes de l'outillage (`/nodefony/…` : console, API d'administration, porte MCP). Défaut : non",
        },
      },
    },
    handler: async (args, caller, run) => {
      const profiler = deps.getProfiler();
      if (profiler === undefined) {
        return mcpText(
          "Aucun profileur dans cette application : il n'existe qu'en " +
            "développement, et seulement si `@nodefony/http` est chargé. " +
            "Rien à observer.",
          true,
        );
      }
      const { sec, note } = readDuration(args.durationSec);
      const route =
        typeof args.route === "string" && args.route.length > 0
          ? args.route
          : null;
      return observe(profiler, {
        windowMs: sec * 1000,
        route,
        includeTooling: args.includeTooling === true,
        tickMs,
        createProbe,
        run,
        note,
        caller,
        readRequestLogs: deps.readRequestLogs,
        onShutdown: deps.onShutdown,
      });
    },
  };
}

interface IObserveRun {
  windowMs: number;
  route: string | null;
  includeTooling: boolean;
  tickMs: number;
  createProbe: () => IObserveProbe;
  run: IMcpToolRun | undefined;
  note: string | null;
  caller: IMcpCaller;
  readRequestLogs: IObserveDeps["readRequestLogs"];
  onShutdown: IObserveDeps["onShutdown"];
}

async function observe(
  profiler: IProfilerReader,
  opts: IObserveRun,
): Promise<IMcpToolResult> {
  const aggregator = createProfileAggregator({
    includeTooling: opts.includeTooling,
  });
  const read = opts.readRequestLogs;
  const logs = new Map<string, Promise<RequestLogs>>();
  // Deux raisons d'arrêter la fenêtre : l'agent part, ou le serveur s'arrête.
  const stop = new AbortController();
  const signal =
    opts.run === undefined
      ? stop.signal
      : AbortSignal.any([opts.run.signal, stop.signal]);
  const windowSec = opts.windowMs / 1000;
  let cursor = profiler.cursor;
  let lost = 0;
  let filteredRoute = 0;
  let ticks = 0;
  let cancelled = false;
  let interrupted = false;
  let loopSum = 0;
  let loopMax = 0;
  let loopReads = 0;

  const drain = (): void => {
    const batch = profiler.since(cursor);
    cursor = batch.cursor;
    lost += batch.lost;
    for (const entry of batch.entries) {
      if (opts.route !== null && entry.route !== opts.route) {
        filteredRoute += 1;
        continue;
      }
      const counted = aggregator.add(entry);
      // Journal lu AU RELEVÉ : le syslog ne garde que ses dernières lignes, et
      // celles d'une erreur seraient évincées avant la fin de la fenêtre.
      if (
        counted &&
        read !== undefined &&
        logs.size < OBSERVE_ERROR_LOGS_MAX &&
        isFailedProfile(entry)
      ) {
        logs.set(
          entry.requestId,
          read(entry.requestId, opts.caller).catch((): RequestLogs => ({
            kind: "unavailable",
            reason: "la lecture du journal a échoué",
          })),
        );
      }
    }
  };

  // L'arrêt du serveur (rechargement après une modification de fichier) clôt
  // la fenêtre tout de suite, et attend que le rapport partiel soit parti.
  const delivered = Promise.withResolvers<void>();
  const unsubscribe =
    opts.onShutdown?.(async () => {
      interrupted = true;
      stop.abort();
      await Promise.race([
        delivered.promise.then(() =>
          delay(SHUTDOWN_REPORT_FLUSH_MS, undefined, { ref: false }),
        ),
        delay(SHUTDOWN_REPORT_MAX_MS, undefined, { ref: false }),
      ]);
    }) ?? null;

  const probe = opts.createProbe();
  const started = performance.now();
  const deadline = started + opts.windowMs;
  let heapStart = 0;
  let heapEnd: number | null = null;
  try {
    // Premier relevé du process : la référence des mesures par intervalle.
    heapStart = probe.read().heapUsed;
    opts.run?.progress(
      0,
      windowSec,
      `observation démarrée pour ${windowSec} s` +
        (opts.route === null ? "" : ` sur la route ${opts.route}`),
    );
    for (;;) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      if (signal.aborted) {
        cancelled = !interrupted;
        break;
      }
      try {
        await delay(Math.min(opts.tickMs, remaining), undefined, { signal });
      } catch {
        // Seule l'abandon rejette ce minuteur : l'agent est parti, ou le
        // serveur s'arrête.
        cancelled = !interrupted;
        break;
      }
      drain();
      ticks += 1;
      const health = probe.read();
      heapEnd = health.heapUsed;
      loopSum += health.eventLoopMs;
      loopReads += 1;
      if (health.eventLoopMaxMs > loopMax) loopMax = health.eventLoopMaxMs;
      const elapsedSec = (performance.now() - started) / 1000;
      opts.run?.progress(
        Math.min(elapsedSec, windowSec),
        windowSec,
        progressLine(aggregator.result(), elapsedSec, windowSec, lost),
      );
    }
    drain();
  } catch (error) {
    delivered.resolve();
    unsubscribe?.();
    throw error;
  } finally {
    probe.dispose();
  }

  let errorLogs: Map<string, RequestLogs> | null = null;
  if (read !== undefined) {
    errorLogs = new Map();
    for (const [requestId, pending] of logs) {
      errorLogs.set(requestId, await pending);
    }
  }

  const text = renderProfileReport(aggregator.result(), {
    windowMs: opts.windowMs,
    elapsedMs: performance.now() - started,
    ticks,
    lost,
    cancelled,
    interrupted,
    errorLogs,
    route: opts.route,
    filteredRoute,
    pid: process.pid,
    uptimeSec: process.uptime(),
    eventLoop:
      loopReads === 0 ? null : { meanMs: loopSum / loopReads, maxMs: loopMax },
    heapDeltaBytes: heapEnd === null ? null : heapEnd - heapStart,
  });
  // Le rapport est rendu : l'arrêt éventuel peut reprendre, et l'écouteur
  // n'a plus rien à faire sur le kernel.
  delivered.resolve();
  unsubscribe?.();
  return mcpText(opts.note === null ? text : `ℹ️ ${opts.note}.\n${text}`);
}
