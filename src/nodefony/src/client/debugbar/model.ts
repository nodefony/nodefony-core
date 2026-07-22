/**
 * État PUR de la debug bar — ingère les payloads des canaux realtime
 * (`nodefony:supervision`, `nodefony:syslog`) et expose une vue dénormalisée prête
 * à rendre (séries temporelles pour sparklines incluses). Aucune dépendance
 * DOM/réseau → unit-testable côté Node.
 *
 * Le rendu (DOM/Shadow/SVG) vit dans `DebugBar.ts` : ce modèle ne fait QUE de la
 * collecte/agrégation, exactement comme les providers serveur sont découplés du
 * transport. Découplage collecte / rendu.
 */
import type { RealtimeState } from "../realtime/RealtimeClient";
import Pdu, { type Severity } from "../../syslog/Pdu";
import { stripAnsi } from "./format";

/** Métadonnées applicatives statiques (env, branche git, version) — bloc `app`. */
export interface AppMeta {
  name?: string;
  version?: string;
  env?: string;
  debug?: boolean;
  branch?: string;
}

/** Payload du canal `nodefony:supervision` (cf studio `createStatsTicker`). */
export interface StatsPayload {
  ts: number;
  app?: AppMeta;
  instanceId?: string;
  uptime?: number;
  pid?: number;
  cpuPercent?: number;
  cpuCount?: number;
  eventLoopMs?: number;
  loadavg?: number[];
  memory?: {
    rss?: number;
    heapUsed?: number;
    heapTotal?: number;
    heapLimit?: number;
    external?: number;
  };
}

/**
 * Pdu sérialisé tel qu'il transite sur `nodefony:syslog` (JSON.stringify d'un
 * {@link Pdu} côté serveur). Le message vit dans `payload`, le producteur dans
 * `moduleName` — on réhydrate un vrai {@link Pdu} (même classe Core des 2 côtés).
 */
export interface LogEntry {
  payload?: unknown;
  severity?: number;
  severityName?: string;
  moduleName?: string;
  msgid?: string;
  msg?: string;
}

/** Payload coalescé du canal `nodefony:syslog` (cf studio `createSyslogBridge`). */
export interface SyslogPayload {
  logs?: LogEntry[];
  dropped?: number;
}

/** Log normalisé pour le feed du widget. */
export interface FeedLog {
  severity: number;
  name: string;
  text: string;
  module: string;
}

/** Vue dénormalisée consommée par le rendu. */
export interface DebugBarView {
  state: RealtimeState;
  /** Métadonnées app (env, branche git, version) — depuis le bloc `app` des stats. */
  appName: string;
  appVersion: string;
  env: string;
  debug: boolean;
  branch: string;
  cpuPercent: number;
  cpuPeak: number;
  cpuCount: number;
  eventLoopMs: number;
  eventLoopPeak: number;
  uptime: number;
  pid: number;
  instanceId: string;
  loadavg: number[];
  rss: number;
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  external: number;
  /** heapUsed / heapLimit en %, 0 si limite inconnue. */
  heapPercent: number;
  heapPeak: number;
  /** Séries temporelles (anciens → récents) pour les sparklines. */
  cpuSeries: number[];
  heapSeries: number[];
  loopSeries: number[];
  /** Total de logs reçus depuis le montage. */
  logTotal: number;
  /** Logs de sévérité ≤ 3 (ERROR/CRITIC/ALERT/EMERGENCY). */
  errorCount: number;
  /** Logs de sévérité === 4 (WARNING). */
  warnCount: number;
  /** Logs omis par le coalescing serveur (surcharge). */
  dropped: number;
  /** Derniers logs (récents en dernier), capés. */
  feed: FeedLog[];
}

/** Sévérité RFC 5424 : ≤ 3 = erreur, 4 = warning. */
const SEVERITY_ERROR_MAX = 3;
const SEVERITY_WARNING = 4;
/** Points conservés dans les séries de sparkline (~1 min à 1 tick/s). */
const SERIES_POINTS = 60;
/** Logs conservés dans le feed. */
const FEED_MAX = 40;

function pushCapped(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

function logText(pci: unknown): string {
  if (pci == null) return "";
  if (typeof pci === "string") return stripAnsi(pci);
  if (typeof pci === "number" || typeof pci === "boolean") return String(pci);
  try {
    return stripAnsi(JSON.stringify(pci));
  } catch {
    return String(pci);
  }
}

export class DebugBarModel {
  private _state: RealtimeState = "disconnected";
  private _stats: StatsPayload | null = null;
  private _cpuPeak = 0;
  private _heapPeak = 0;
  private _loopPeak = 0;
  private readonly _cpuSeries: number[] = [];
  private readonly _heapSeries: number[] = [];
  private readonly _loopSeries: number[] = [];
  private _logTotal = 0;
  private _errorCount = 0;
  private _warnCount = 0;
  private _dropped = 0;
  private readonly _feed: FeedLog[] = [];

  setState(state: RealtimeState): void {
    this._state = state;
  }

  /** Mémorise le dernier tick stats + alimente les séries/peaks. */
  ingestStats(payload: StatsPayload): void {
    this._stats = payload;
    const cpu = payload.cpuPercent ?? 0;
    const loop = payload.eventLoopMs ?? 0;
    const heapUsed = payload.memory?.heapUsed ?? 0;
    const heapLimit = payload.memory?.heapLimit ?? 0;
    const heapPct =
      heapLimit > 0 ? Math.round((heapUsed / heapLimit) * 100) : 0;
    pushCapped(this._cpuSeries, cpu, SERIES_POINTS);
    pushCapped(this._heapSeries, heapPct, SERIES_POINTS);
    pushCapped(this._loopSeries, loop, SERIES_POINTS);
    if (cpu > this._cpuPeak) this._cpuPeak = cpu;
    if (heapPct > this._heapPeak) this._heapPeak = heapPct;
    if (loop > this._loopPeak) this._loopPeak = loop;
  }

  /**
   * Comptabilise un batch de logs coalescés (compteurs cumulés + feed). Chaque
   * entrée est **réhydratée en {@link Pdu}** — la MÊME classe Core que côté
   * serveur (severityName/payload canoniques, pas de devinette de champ).
   */
  ingestSyslog(payload: SyslogPayload): void {
    const logs = payload.logs;
    if (logs) {
      for (let i = 0; i < logs.length; i++) {
        const entry = logs[i];
        if (typeof entry?.severity !== "number") continue;
        let pdu: Pdu;
        try {
          pdu = new Pdu(
            entry.payload,
            entry.severity as Severity,
            entry.moduleName ?? "nodefony",
            entry.msgid ?? "",
            entry.msg ?? "",
            // timeStamp absent → Date.now() ; on garde l'original s'il est fourni.
          );
        } catch {
          continue; // sévérité hors RFC 5424 → on ignore l'entrée
        }
        const sev = pdu.severity;
        this._logTotal++;
        if (sev <= SEVERITY_ERROR_MAX) this._errorCount++;
        else if (sev === SEVERITY_WARNING) this._warnCount++;
        this._feed.push({
          severity: sev,
          name: pdu.severityName,
          text: logText(pdu.payload),
          module: pdu.moduleName,
        });
      }
      if (this._feed.length > FEED_MAX)
        this._feed.splice(0, this._feed.length - FEED_MAX);
    }
    if (typeof payload.dropped === "number") this._dropped += payload.dropped;
  }

  get view(): DebugBarView {
    const s = this._stats;
    const mem = s?.memory;
    const app = s?.app;
    const heapUsed = mem?.heapUsed ?? 0;
    const heapLimit = mem?.heapLimit ?? 0;
    return {
      state: this._state,
      appName: app?.name ?? "",
      appVersion: app?.version ?? "",
      env: app?.env ?? "",
      debug: app?.debug ?? false,
      branch: app?.branch ?? "",
      cpuPercent: s?.cpuPercent ?? 0,
      cpuPeak: this._cpuPeak,
      cpuCount: s?.cpuCount ?? 0,
      eventLoopMs: s?.eventLoopMs ?? 0,
      eventLoopPeak: this._loopPeak,
      uptime: s?.uptime ?? 0,
      pid: s?.pid ?? 0,
      instanceId: s?.instanceId ?? "—",
      loadavg: s?.loadavg ?? [],
      rss: mem?.rss ?? 0,
      heapUsed,
      heapTotal: mem?.heapTotal ?? 0,
      heapLimit,
      external: mem?.external ?? 0,
      heapPercent: heapLimit > 0 ? Math.round((heapUsed / heapLimit) * 100) : 0,
      heapPeak: this._heapPeak,
      cpuSeries: this._cpuSeries,
      heapSeries: this._heapSeries,
      loopSeries: this._loopSeries,
      logTotal: this._logTotal,
      errorCount: this._errorCount,
      warnCount: this._warnCount,
      dropped: this._dropped,
      feed: this._feed,
    };
  }
}
