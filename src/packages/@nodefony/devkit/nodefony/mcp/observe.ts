import { setTimeout as delay } from "node:timers/promises";
import {
  ProcessProbe,
  type IMcpTool,
  type IMcpToolResult,
  type IMcpToolRun,
} from "nodefony";
import { mcpText, MCP_RESERVED_PREFIX } from "@nodefony/ai";
import { createProfileAggregator, type IProfilerReader } from "@nodefony/http";
import { progressLine, renderProfileReport } from "./profileReport";

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

/** La sonde du process : ce que l'outil lit du process à chaque relevé. */
export interface IObserveProbe {
  read(): { eventLoopMs: number; heapUsed: number };
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
      "fenêtre — le serveur de développement redémarrerait et l'observation serait " +
      "perdue. Un instantané est envoyé en progression à chaque relevé.",
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
    handler: async (args, _caller, run) => {
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
}

async function observe(
  profiler: IProfilerReader,
  opts: IObserveRun,
): Promise<IMcpToolResult> {
  const aggregator = createProfileAggregator({
    includeTooling: opts.includeTooling,
  });
  const signal = opts.run?.signal;
  const windowSec = opts.windowMs / 1000;
  let cursor = profiler.cursor;
  let lost = 0;
  let filteredRoute = 0;
  let ticks = 0;
  let cancelled = false;
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
      aggregator.add(entry);
    }
  };

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
      if (signal?.aborted === true) {
        cancelled = true;
        break;
      }
      try {
        await delay(Math.min(opts.tickMs, remaining), undefined, { signal });
      } catch {
        // Seule l'annulation rejette ce minuteur : l'agent est parti.
        cancelled = true;
        break;
      }
      drain();
      ticks += 1;
      const health = probe.read();
      heapEnd = health.heapUsed;
      loopSum += health.eventLoopMs;
      loopReads += 1;
      if (health.eventLoopMs > loopMax) loopMax = health.eventLoopMs;
      const elapsedSec = (performance.now() - started) / 1000;
      opts.run?.progress(
        Math.min(elapsedSec, windowSec),
        windowSec,
        progressLine(aggregator.result(), elapsedSec, windowSec, lost),
      );
    }
    drain();
  } finally {
    probe.dispose();
  }

  const text = renderProfileReport(aggregator.result(), {
    windowMs: opts.windowMs,
    elapsedMs: performance.now() - started,
    ticks,
    lost,
    cancelled,
    route: opts.route,
    filteredRoute,
    pid: process.pid,
    uptimeSec: process.uptime(),
    eventLoop:
      loopReads === 0 ? null : { meanMs: loopSum / loopReads, maxMs: loopMax },
    heapDeltaBytes: heapEnd === null ? null : heapEnd - heapStart,
  });
  return mcpText(opts.note === null ? text : `ℹ️ ${opts.note}.\n${text}`);
}
