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
import fs from "node:fs";
import path from "node:path";
import {
  monitorEventLoopDelay,
  PerformanceObserver,
  performance,
  constants as perfConstants,
} from "node:perf_hooks";

export type Publish = (channel: string, payload: unknown) => void;

/** Métadonnées applicatives statiques poussées avec `dashboard:supervision`. */
export interface AppMeta {
  name?: string;
  version?: string;
  env?: string;
  debug?: boolean;
  branch?: string;
}

/** Branche git, lue UNE seule fois (cache process). `""` si indéterminée. */
let _gitBranch: string | undefined;

/**
 * Lit la branche git courante depuis `.git/HEAD` (pas de spawn `git`). Détaché →
 * sha court. Caché pour la vie du process (constant). Best-effort : `""` si hors
 * dépôt ou worktree.
 *
 * @param cwd - racine où chercher `.git` (défaut `process.cwd()`)
 */
export function readGitBranch(cwd: string = process.cwd()): string {
  if (_gitBranch !== undefined) return _gitBranch;
  try {
    const head = fs.readFileSync(path.join(cwd, ".git", "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    _gitBranch = m ? m[1]! : head.slice(0, 7); // détaché → sha court
  } catch {
    _gitBranch = "";
  }
  return _gitBranch;
}

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
export const INSTANCE_ID =
  process.env.NODEFONY_INSTANCE_ID ?? String(process.pid);

/**
 * Identité du process — **constante** (lue une fois). Détaille le process pour la
 * carte « Process » de la supervision : runtime Node, OS, parent, exécutable.
 */
export const PROC = {
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  ppid: process.ppid,
  // ⚠️ PAS d'execPath/cwd/argv : chemins absolus = info-leak FS (règle data plane).
} as const;

interface SyslogLike {
  on(event: string, fn: (...a: unknown[]) => void): unknown;
  off?(event: string, fn: (...a: unknown[]) => void): unknown;
  removeListener?(event: string, fn: (...a: unknown[]) => void): unknown;
  /** Diffusion temps réel active ? `false` (coupé à chaud) → le pont n'accumule
   *  ni ne publie rien. `undefined` (par défaut / tests) = diffuser (historique). */
  streamEnabled?: boolean;
}

/** Canaux temps réel FIGÉS (deviendront des canaux RealtimeService en P13.4). */
export const CHANNELS = {
  syslog: "syslog:stream",
  // Canal de la SUPERVISION (sondes process) — nommé `dashboard:supervision`
  // pour la clarté du hub. Abonné UNIQUEMENT par la page Supervision (opt-in).
  supervision: "dashboard:supervision",
  // Canal DÉDIÉ à la debug bar (mêmes sondes process, ticker séparé) → la barre,
  // toujours présente en dev, ne maintient PAS le canal supervision actif.
  debugbar: "debugbar:stats",
  ormHealth: "orm:health",
  // Canal du FLUX ORM (débit requêtes/s + latence + slow) — distinct de la santé
  // (état/ping). Plus dynamique → cadence par défaut plus serrée côté controller.
  ormFlow: "orm:flow",
  // Canal de SANTÉ de la socket Nodefony (auto-observabilité du RealtimeHub) :
  // canaux/abonnés, fan-out, connexions, backpressure (bufferedAmount). La socket
  // s'observe à travers elle-même.
  realtimeHealth: "realtime:health",
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
    // Diffusion coupée à chaud (tuile « Temps réel ») → on n'accumule rien.
    if (syslog.streamEnabled === false) return;
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
 * Ticker de stats runtime → canal `dashboard:supervision` (ou `dashboard:supervision:<ms>`
 * pour la granularité) toutes les `intervalMs`. CPU% calculé en delta entre deux
 * ticks (1 seul `process.cpuUsage()` par tick).
 *
 * En plus du cœur (CPU/mémoire/event-loop), pousse les **sondes process riches**
 * du PATRON sondes+hub — l'équivalent runtime des sondes ORM (latence/storage/pool) :
 *  - **GC** : pression sur l'intervalle (cycles, pause totale, majeurs/mineurs).
 *  - **heapSpaces** : répartition mémoire V8 par espace (new/old/code/large…).
 *  - **handles** : ressources actives qui tiennent la boucle, par type.
 *
 * Perf (règle ABSOLUE) : 1 `PerformanceObserver` GC (incréments O(1) par cycle,
 * **détaché au dispose**) ; les sondes lourdes (`getHeapSpaceStatistics`,
 * `getActiveResourcesInfo`) ne tournent qu'au tick (≥ 1 s, jamais en hot path) ;
 * `setInterval` unref (cloud-native).
 *
 * @param channel - canal de publication (granularité `dashboard:supervision:<ms>`).
 * @returns dispose() qui clear l'interval + détache l'observer GC — OBLIGATOIRE.
 */
export function createStatsTicker(
  publish: Publish,
  intervalMs = 1000,
  meta?: AppMeta,
  channel: string = CHANNELS.supervision,
  syslog?: SyslogLike,
): () => void {
  const cores = os.cpus().length || 1; // 1 seule lecture (os.cpus alloue un array)
  let prevCpu = process.cpuUsage();
  let prevTs = Date.now();
  // Compteur d'erreurs (ERROR/CRITIC) sur l'intervalle, compté CÔTÉ SERVEUR pour
  // éviter de streamer TOUT le syslog au dashboard juste pour un compteur (effet
  // d'observateur sous charge). 1 listener léger (incrément), détaché au dispose.
  let errCount = 0;
  const onErr = (pdu: unknown): void => {
    const sev = (pdu as { severityName?: string } | null)?.severityName;
    if (sev === "ERROR" || sev === "CRITIC") errCount += 1;
  };
  if (syslog) syslog.on("onLog", onErr);
  // Baselines pour les deltas par intervalle :
  //  - ELU (Event Loop Utilization) : fraction du temps où la boucle est ACTIVE
  //    (≠ lag). ~1.0 = thread mono saturé (CPU-bound) — la vraie jauge de saturation.
  //  - changements de contexte (getrusage) : involontaires = OS qui PRÉEMPTE le
  //    process (contention CPU) ; volontaires = process qui cède (attente I/O/lock).
  let prevElu = performance.eventLoopUtilization();
  let prevRu = process.resourceUsage();
  // Event-loop lag : métrique dev clé (détecte le blocage synchrone). Histogramme
  // natif, mean lu + reset à chaque tick → lag moyen sur l'intervalle.
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();

  // Pression GC accumulée sur l'intervalle (reset à chaque tick). 1 observer,
  // incréments O(1) par cycle GC ; détaché au dispose (aucun listener orphelin).
  let gcCount = 0;
  let gcPauseMs = 0;
  let gcMajor = 0;
  let gcMinor = 0;
  const gcObs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcCount += 1;
      gcPauseMs += e.duration;
      // `detail` n'est pas typé sur PerformanceEntry (selon @types/node) → cast de l'entrée.
      const kind = (e as { detail?: { kind?: number } | null }).detail?.kind;
      if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) gcMajor += 1;
      else if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) gcMinor += 1;
    }
  });
  try {
    gcObs.observe({ entryTypes: ["gc"] });
  } catch {
    /* 'gc' indisponible : best-effort, on continue sans sonde GC */
  }

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

    // Sonde GC : snapshot de la pression sur l'intervalle écoulé, puis reset.
    const gc = {
      count: gcCount,
      pauseMs: Math.round(gcPauseMs * 100) / 100,
      major: gcMajor,
      minor: gcMinor,
    };
    gcCount = gcPauseMs = gcMajor = gcMinor = 0;

    // Sonde mémoire V8 : répartition par espace (new/old/code/large_object…).
    const heapSpaces = v8.getHeapSpaceStatistics().map((s) => ({
      name: s.space_name,
      used: s.space_used_size,
      size: s.space_size,
    }));

    // Sonde ressources actives : ce qui tient la boucle vivante, agrégé par type.
    const resources = process.getActiveResourcesInfo();
    const byType: Record<string, number> = Object.create(null);
    for (const r of resources) byType[r] = (byType[r] ?? 0) + 1;

    // Sonde SATURATION boucle (ELU) sur l'intervalle : delta entre 2 mesures.
    const curElu = performance.eventLoopUtilization();
    const eluDelta = performance.eventLoopUtilization(curElu, prevElu);
    prevElu = curElu;
    const elu = {
      utilization: Math.round(eluDelta.utilization * 1000) / 1000, // 0-1
      active: Math.round(eluDelta.active * 100) / 100, // ms boucle active
      idle: Math.round(eluDelta.idle * 100) / 100, // ms boucle idle
    };

    // Sonde CHANGEMENTS DE CONTEXTE (getrusage) : delta sur l'intervalle.
    const ru = process.resourceUsage();
    const ctx = {
      voluntary: ru.voluntaryContextSwitches - prevRu.voluntaryContextSwitches,
      involuntary:
        ru.involuntaryContextSwitches - prevRu.involuntaryContextSwitches,
    };
    prevRu = ru;

    publish(channel, {
      ts: now,
      app: meta, // statique (constant ref) : env, branche git, version, name
      instanceId: INSTANCE_ID,
      proc: PROC, // identité process (constant ref) : node/os/arch/ppid
      uptime: process.uptime(),
      pid: process.pid,
      cpuPercent,
      cpuCount: cores,
      eventLoopMs,
      elu,
      ctx,
      loadavg: os.loadavg(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapLimit: HEAP_LIMIT,
        external: mem.external,
      },
      gc,
      heapSpaces,
      handles: { total: resources.length, byType },
      errCount, // ERROR/CRITIC sur l'intervalle (compté serveur, pas via syslog:stream)
    });
    errCount = 0;
  };
  const timer = setInterval(tick, intervalMs);
  (timer as { unref?: () => void }).unref?.(); // cloud-native : ne bloque pas l'exit
  return () => {
    clearInterval(timer);
    eld.disable();
    gcObs.disconnect();
    if (syslog)
      (syslog.off ?? syslog.removeListener)?.call(syslog, "onLog", onErr);
  };
}

/**
 * Snapshot ONE-SHOT des sondes process — pendant HTTP du canal `dashboard:supervision`
 * (PATRON sondes+hub : endpoint + ticker). Échantillonne CPU% et event-loop sur
 * une courte fenêtre (`sampleMs`) pour une valeur instantanée RÉELLE en une seule
 * requête, sans flux WS. `gc` est `null` (la pression GC nécessite un observer
 * dans la durée — disponible uniquement via le ticker).
 *
 * Usage : Studio affiche ce snapshot quand le temps réel est désactivé (défaut,
 * pour la perf) → cartes peuplées de vraies valeurs au lieu d'un écran vide.
 *
 * @param meta - métadonnées app statiques (env, version, branche).
 * @param sampleMs - fenêtre d'échantillonnage CPU/event-loop (défaut 150 ms).
 */
export async function readStatsSnapshot(
  meta?: AppMeta,
  sampleMs = 150,
): Promise<Record<string, unknown>> {
  const cores = os.cpus().length || 1;
  const c0 = process.cpuUsage();
  const elu0 = performance.eventLoopUtilization();
  const t0 = Date.now();
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, sampleMs);
    (t as { unref?: () => void }).unref?.();
  });
  const d = process.cpuUsage(c0);
  const eluDelta = performance.eventLoopUtilization(elu0);
  const elapsedMs = Math.max(Date.now() - t0, 1);
  eld.disable();
  const cpuPercent = Math.min(
    100,
    Math.round(((d.user + d.system) / 1000 / elapsedMs) * 100),
  );
  const eventLoopMs = Math.round((eld.mean / 1e6) * 100) / 100 || 0;
  const mem = process.memoryUsage();
  const heapSpaces = v8.getHeapSpaceStatistics().map((s) => ({
    name: s.space_name,
    used: s.space_used_size,
    size: s.space_size,
  }));
  const resources = process.getActiveResourcesInfo();
  const byType: Record<string, number> = Object.create(null);
  for (const r of resources) byType[r] = (byType[r] ?? 0) + 1;
  return {
    ts: Date.now(),
    app: meta,
    instanceId: INSTANCE_ID,
    proc: PROC,
    uptime: process.uptime(),
    pid: process.pid,
    cpuPercent,
    cpuCount: cores,
    eventLoopMs,
    // ELU mesurée sur la fenêtre d'échantillon (réelle). Les changements de
    // contexte (ctx) restent live-only (delta sur intervalle) → null en snapshot.
    elu: {
      utilization: Math.round(eluDelta.utilization * 1000) / 1000,
      active: Math.round(eluDelta.active * 100) / 100,
      idle: Math.round(eluDelta.idle * 100) / 100,
    },
    ctx: null,
    loadavg: os.loadavg(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      heapLimit: HEAP_LIMIT,
      external: mem.external,
    },
    gc: null,
    heapSpaces,
    handles: { total: resources.length, byType },
  };
}

/**
 * Ticker temps réel **générique** branché sur un endpoint admin via le broker —
 * pousse périodiquement sur un canal le résultat d'un `fetch` asynchrone. Sert
 * la **santé ORM** (`orm:health` : état/ping/latence/stockage) ET le **flux ORM**
 * (`orm:flow` : débit/latence/slow) — même mécanique, sources différentes.
 *
 * SOURCE-AGNOSTIQUE : le `fetch` est branché par le controller sur l'endpoint
 * admin (`orm/connection/health`, `orm/flow`…) **via le broker** → Studio reste
 * générique (zéro dép directe à orm-core). 1ᵉʳ tick immédiat puis intervalle.
 * `setInterval` unref (cloud-native).
 *
 * @param fetch - producteur asynchrone du paquet (broker → endpoint).
 * @param publish - callback de publication (transport-agnostique).
 * @param channel - canal exact souscrit (granularité `:<ms>`).
 * @param intervalMs - cadence (défaut 5000 ms).
 * @returns dispose() — arrête le ticker.
 */
export function createBrokerTicker(
  fetch: () => Promise<unknown>,
  publish: Publish,
  channel: string,
  intervalMs = 5000,
): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const data = await fetch();
      // Publie sur le canal EXACT souscrit (granularité : `orm:health:<ms>`).
      if (!stopped && data) publish(channel, data);
    } catch {
      /* best-effort : un tick raté n'interrompt pas le flux */
    }
  };
  void tick(); // 1ᵉʳ paquet immédiat (pas d'attente de l'intervalle)
  const timer = setInterval(() => void tick(), intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
