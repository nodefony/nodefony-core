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

/**
 * Pont syslog kernel → canal `syslog:stream`. Chaque `Pdu` est publié tel quel
 * (la sérialisation est déléguée au transport).
 *
 * @returns dispose() qui détache le listener — OBLIGATOIRE (règle perf : aucun
 *          listener sans cleanup, sinon fuite à chaque (dé)connexion WS).
 */
export function createSyslogBridge(syslog: SyslogLike, publish: Publish): () => void {
  const onLog = (pdu: unknown): void => publish(CHANNELS.syslog, pdu);
  syslog.on("onLog", onLog);
  return () => {
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
