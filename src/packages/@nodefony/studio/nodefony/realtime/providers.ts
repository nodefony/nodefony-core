/// <reference types="node" />
/**
 * Providers temps réel Studio — transport-agnostiques (forward-compat P13.4).
 *
 * Chaque provider produit des données et les pousse via un callback `Publish(channel, payload)`.
 * Il ne connaît NI le transport NI l'enveloppe : aujourd'hui le `StudioRealtimeController`
 * fournit un `publish` qui encapsule en JSON-RPC 2.0 et appelle `context.send()` (push direct
 * sur 1 socket). Quand `@nodefony/realtime` (RealtimeService, P13.4) arrivera, on passera
 * simplement `realtimeService.publish` — ces providers et les noms de canaux restent
 * IDENTIQUES. C'est ça la « petite migration » : on ne réécrit pas la collecte de données.
 */
import os from "node:os";
import v8 from "node:v8";
import { monitorEventLoopDelay } from "node:perf_hooks";

export type Publish = (channel: string, payload: unknown) => void;

/**
 * Plafond du tas V8 (`--max-old-space-size`, ~2-4 Go par défaut). **Constant**
 * pour la durée de vie du process → lu UNE seule fois (jamais dans le tick).
 *
 * C'est le BON dénominateur pour « le heap est-il plein ? » : `heapUsed/heapTotal`
 * vaut ~99% en permanence (V8 garde `heapTotal` collé au-dessus de `heapUsed`),
 * donc trompeur. `heapUsed/heapLimit` est, lui, actionnable.
 */
const HEAP_LIMIT = v8.getHeapStatistics().heap_size_limit;

/**
 * Identifiant stable de CETTE instance/process. Override possible via env
 * `NODEFONY_INSTANCE_ID` (utile en multi-process pour distinguer les workers).
 * Forward-compat vue cluster (P13) : les stats sont taguées avec, le futur
 * RealtimeService Redis fan-out → le dashboard pourra tracer N séries par instance.
 */
export const INSTANCE_ID = process.env.NODEFONY_INSTANCE_ID ?? String(process.pid);

interface SyslogLike {
  on(event: string, fn: (...a: unknown[]) => void): unknown;
  off?(event: string, fn: (...a: unknown[]) => void): unknown;
  removeListener?(event: string, fn: (...a: unknown[]) => void): unknown;
}

/** Canaux temps réel FIGÉS (deviendront des canaux RealtimeService en P13.4). */
export const CHANNELS = {
  syslog: "syslog:stream",
  stats: "dashboard:stats",
} as const;

/** Options de coalescing du pont syslog. */
export interface SyslogBridgeOptions {
  /** Fenêtre d'agrégation : 1 frame WS au plus toutes les `flushMs`. Défaut 200. */
  flushMs?: number;
  /** Cap d'un batch (ring buffer) : au-delà, on garde les + récents et on compte
   *  les omis. Borne la mémoire ET le nb de Pdu envoyés au front. Défaut 500. */
  maxBatch?: number;
}

/**
 * Pont syslog kernel → canal `syslog:stream`, **coalescé**.
 *
 * Au lieu de pousser 1 frame WS par `Pdu` (un flood de logs — ex broadcast WS
 * massif — noyait le front Studio à coups de N `JSON.stringify`+`send` par tick),
 * on accumule les Pdu dans un **ring buffer borné** et on flush **1 frame
 * agrégée toutes les `flushMs`** : `{ logs: Pdu[], dropped }`. Sous surcharge, le
 * ring écrase les plus vieux et `dropped` indique combien ont été omis → le front
 * affiche un récap au lieu de se figer. C'est le découplage débit-source / débit-UI.
 *
 * Perf (règle ABSOLUE) : alloc **lazy** (ring `null` tant qu'aucun log), timer
 * **armé au 1er log** puis désarmé au flush (aucun timer si silence), `unref`
 * (cloud-native), refs libérées au flush. Mémoire bornée à `maxBatch` Pdu.
 *
 * Forward-compat P13.4 : le coalescing vit dans le provider (couche collecte) →
 * identique quand on branchera `realtimeService.publish`.
 *
 * @returns dispose() qui désarme le timer ET détache le listener — OBLIGATOIRE
 *          (aucun listener/timer sans cleanup, sinon fuite à chaque déconnexion WS).
 */
export function createSyslogBridge(
  syslog: SyslogLike,
  publish: Publish,
  opts: SyslogBridgeOptions = {},
): () => void {
  const flushMs = opts.flushMs ?? 200;
  const maxBatch = opts.maxBatch ?? 500;

  let ring: unknown[] | null = null; // lazy : alloué au 1er log
  let head = 0; // index du plus ancien
  let count = 0; // éléments vivants
  let dropped = 0; // omis (cap dépassé) depuis le dernier flush
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (count === 0 && dropped === 0) return;
    const logs = new Array(count);
    for (let i = 0; i < count; i++) logs[i] = ring![(head + i) % maxBatch];
    const d = dropped;
    // reset + libère les refs (évite de retenir des Pdu/stack traces).
    for (let i = 0; i < maxBatch; i++) ring![i] = undefined;
    head = 0;
    count = 0;
    dropped = 0;
    publish(CHANNELS.syslog, { logs, dropped: d });
  };

  const onLog = (pdu: unknown): void => {
    if (ring === null) ring = new Array(maxBatch);
    if (count === maxBatch) {
      ring[head] = pdu; // ring plein → écrase le plus ancien
      head = (head + 1) % maxBatch;
      dropped++;
    } else {
      ring[(head + count) % maxBatch] = pdu;
      count++;
    }
    if (timer === null) {
      timer = setTimeout(flush, flushMs);
      (timer as { unref?: () => void }).unref?.();
    }
  };

  syslog.on("onLog", onLog);
  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    ring = null;
    head = count = dropped = 0;
    (syslog.off ?? syslog.removeListener)?.call(syslog, "onLog", onLog);
  };
}

/**
 * Ticker de stats runtime → canal `dashboard:stats` toutes les `intervalMs`.
 * CPU% calculé en delta entre deux ticks (1 seul `process.cpuUsage()` par tick).
 *
 * @returns dispose() qui clear l'interval — OBLIGATOIRE.
 */
export function createStatsTicker(publish: Publish, intervalMs = 1000): () => void {
  const cores = os.cpus().length || 1; // 1 seule lecture (os.cpus alloue un array)
  let prevCpu = process.cpuUsage();
  let prevTs = Date.now();
  // Event-loop lag : métrique dev clé (détecte le blocage synchrone). Histogramme
  // natif, mean lu + reset à chaque tick → lag moyen sur l'intervalle.
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  const tick = (): void => {
    const now = Date.now();
    const cur = process.cpuUsage();
    const userDelta = cur.user - prevCpu.user;
    const sysDelta = cur.system - prevCpu.system;
    const elapsedMs = Math.max(now - prevTs, 1);
    prevCpu = cur;
    prevTs = now;
    // % d'UN cœur (comme `top`) : un process Node mono-thread sature ~100%.
    // (Pas de /cores : sinon un process saturant 1 cœur n'afficherait que 100/cores.)
    const cpuPercent = Math.min(
      100,
      Math.round(((userDelta + sysDelta) / 1000 / elapsedMs) * 100),
    );
    const eventLoopMs = Math.round((eld.mean / 1e6) * 100) / 100;
    eld.reset();
    const mem = process.memoryUsage();
    publish(CHANNELS.stats, {
      ts: now,
      instanceId: INSTANCE_ID,
      uptime: process.uptime(),
      pid: process.pid,
      cpuPercent,
      cpuCount: cores,
      eventLoopMs,
      loadavg: os.loadavg(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapLimit: HEAP_LIMIT,
        external: mem.external,
      },
    });
  };
  const timer = setInterval(tick, intervalMs);
  (timer as { unref?: () => void }).unref?.(); // cloud-native : ne bloque pas l'exit
  return () => {
    clearInterval(timer);
    eld.disable();
  };
}
