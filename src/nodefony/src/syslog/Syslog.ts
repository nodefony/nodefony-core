import { inspect } from "node:util";

import { extend } from "../Tools";
import Pdu, { Severity, ModuleName, Msgid, Message, Pci } from "./Pdu";
import { DebugType, EnvironmentType } from "../types/globals";
import Event from "../Event";
import { ISyslog } from "../types/ISyslog";
import type { ITransport } from "../types/ITransport";
import { logColor, isLogColorEnabled } from "./logColor";

// Couleurs du préfixe console (timestamp/severity/msgid) — gatées au boot par
// logColor (OFF hors TTY → stdout pipe/fichier propre). Indirection minime hors
// hot path d'affichage ; le rendu console n'est appelé que par ligne écrite.
const yellow = (s: string): string => logColor.yellowBold(s);
const red = (s: string): string => logColor.redBold(s);
const cyan = (s: string): string => logColor.cyanBold(s);
const blue = (s: string): string => logColor.blueBrightBold(s);
const green = (s: string): string => logColor.green(s);

// ── Sink stdout/stderr isomorphe ────────────────────────────────────────────
// Node : écrit direct sur process.stdout/stderr (perf, pas d'overhead console).
// Navigateur (Core isomorphe — pas de process.stdout) : retombe sur console.*
// avec ANSI strippé. Accès via `globalThis` (pas `process`) pour compiler sous
// tsconfigClient `types: []`. `_proc` résolu 1× au load → coût/log négligeable.
interface ProcStream {
  write(s: string): void;
  isTTY?: boolean;
}
interface ProcLike {
  stdout?: ProcStream;
  stderr?: ProcStream;
  on?(event: string, cb: (...args: unknown[]) => void): void;
}
const _proc = (globalThis as { process?: ProcLike }).process;
// eslint-disable-next-line no-control-regex
const _stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

// ── Bufférisation de la sortie (process-global — un seul stdout) ─────────────
// PROBLÈME : 1 log/requête → 1 write() stdout SYNCHRONE/requête. À 2000+ RPS,
// ça sature l'event-loop (le pipeline lui-même fait 0.66 ms/req — le goulet
// est l'observabilité synchrone). FIX : en mode bufférisé, on accumule les
// lignes d'un même tick et on les écrit en 1 SEUL write() (1 syscall) au tick
// suivant via `setImmediate`. Lossless (flush chaque tick), 0 sampling.
//
// `"auto"` (défaut) bufférise si stdout N'EST PAS un TTY : un humain qui regarde
// un terminal veut chaque ligne maintenant (+ spinner) ; un pipe/fichier
// (prod/container/collecteur) veut le débit. `isTTY` = LE signal « interactif ».
// stderr (ERROR+) reste TOUJOURS immédiat (rare, critique, durable même crash).
type BufferMode = "auto" | "on" | "off";
let _bufferMode: BufferMode = "auto";
let _bufferOn: boolean | null = null; // cache résolu (null = à recalculer)
let _outChunks: string[] | null = null; // lazy alloc au 1er log bufférisé
let _outBytes = 0;
let _flushScheduled = false;
const FLUSH_BYTES = 64 * 1024; // cap : flush anticipé si un tick logue beaucoup
// setImmediate via globalThis (Node-only) — isomorphe : compile sous
// tsconfigClient `types: []` et reste `undefined` au navigateur. Pas de
// scheduler ⇒ jamais bufférisé (cf _resolveBufferOn) → le client retombe sur
// le write direct / console.*, exactement comme avant.
const _setImmediate = (
  globalThis as { setImmediate?: (cb: () => void) => void }
).setImmediate;

const _resolveBufferOn = (): boolean => {
  if (_bufferOn !== null) return _bufferOn;
  _bufferOn = !_setImmediate
    ? false // navigateur / pas de scheduler → jamais bufférisé (isomorphe)
    : _bufferMode === "on"
      ? true
      : _bufferMode === "off"
        ? false
        : !_proc?.stdout?.isTTY; // "auto" → bufférise hors TTY
  return _bufferOn;
};

// ── Driver de sink (LB.W — write enfichable) ─────────────────────────────────
// Le sink FINAL (où partent les lignes après coalescing) est un DRIVER
// enfichable. Défaut = stdout (comportement historique EXACT, isomorphe). Un
// worker cluster peut basculer sur `file` (fd async PAR worker → pas de contention
// d'inode) ou `null` (bench). Le ring/coalescing par tick (writeOut ci-dessous)
// reste DEVANT, inchangé — et c'est LUI le levier mesuré (×19-25 sur les syscalls
// write) ; le fd-par-worker n'est qu'un garde-fou pour le cas « buffer de tick
// désactivé ». Rejouer : skill nodefony-load-test, `log-sink-contention.mjs`. Câblé par Kernel.initializeLog
// ← config.log.driver. Voir le plan « Log Backplane » phase LB.W.
export interface ILogSink {
  readonly name: string;
  /** Chunk classe-stdout (déjà coalescé par tick). NON bloquant si possible. */
  writeOut(s: string): void;
  /** Chunk classe-stderr (sévérité ≤ 3 — durable). */
  writeErr(s: string): void;
  /** Flush SYNCHRONE de secours (process `exit`). Best-effort, JAMAIS async. */
  flushSync(): void;
  /** Libère les ressources (fd…). Idempotent. */
  close(): void;
}

// Sink par défaut : stdout/stderr direct (isomorphe — navigateur : console.* +
// ANSI strip). = comportement HISTORIQUE EXACT → 0 régression quand non configuré.
// Utilisé hors buffer et par le flush.
const _stdoutSink: ILogSink = {
  name: "stdout",
  writeOut(s: string): void {
    if (_proc?.stdout) _proc.stdout.write(s);
    else console.log(_stripAnsi(s).replace(/\n$/, ""));
  },
  writeErr(s: string): void {
    if (_proc?.stderr) _proc.stderr.write(s);
    else console.error(_stripAnsi(s).replace(/\n$/, ""));
  },
  flushSync(): void {},
  close(): void {},
};

/** Sink `/dev/null` : noop total (bench — mesure du plafond sans I/O de log). */
export const NULL_LOG_SINK: ILogSink = {
  name: "null",
  writeOut(): void {},
  writeErr(): void {},
  flushSync(): void {},
  close(): void {},
};

let _sink: ILogSink = _stdoutSink;

// Mute à chaud du sink texte (toggle dev/diagnostic — ex. couper la console sans
// redémarrer ni changer la config). Préserve le NOM du sink (≠ bascule vers NULL) :
// `logSinkName` reste « stdout »/« file », seul `sinkEnabled` passe à false. Défaut
// false → 0 surcoût (un test booléen par ligne, le sink écrit normalement).
let _sinkMuted = false;

// Écriture immédiate (hors buffer / flush) — route vers le driver actif.
const _writeStdoutNow = (s: string): void => {
  if (!_sinkMuted) _sink.writeOut(s);
};
const _writeStderrNow = (s: string): void => {
  if (!_sinkMuted) _sink.writeErr(s);
};

const _flushOut = (): void => {
  _flushScheduled = false;
  if (_outChunks && _outChunks.length > 0) {
    _writeStdoutNow(_outChunks.join("")); // N lignes → 1 write
    _outChunks.length = 0;
    _outBytes = 0;
  }
};

const _setBufferMode = (mode: boolean | "auto"): void => {
  _flushOut(); // ne pas abandonner de lignes en attente lors d'un switch
  _bufferMode = mode === true ? "on" : mode === false ? "off" : "auto";
  _bufferOn = null; // forcer la ré-résolution (override/isTTY)
};

// Bascule du driver de sink. Flush les lignes en attente PUIS close l'ancien
// driver (libère le fd d'un FileSink) avant de switcher. `null` → stdout.
const _setLogSink = (sink: ILogSink | null): void => {
  _flushOut();
  if (_sink !== sink && _sink !== _stdoutSink && _sink !== NULL_LOG_SINK) {
    _sink.close();
  }
  _sink = sink ?? _stdoutSink;
};

const writeOut = (s: string): void => {
  if (!_resolveBufferOn()) {
    _writeStdoutNow(s);
    return;
  }
  if (_outChunks === null) _outChunks = [];
  _outChunks.push(s);
  _outBytes += s.length;
  if (_outBytes >= FLUSH_BYTES) {
    _flushOut(); // cap atteint → borne la rétention mémoire d'un tick
    return;
  }
  if (!_flushScheduled && _setImmediate) {
    _flushScheduled = true;
    _setImmediate(_flushOut); // 1 seul setImmediate/tick quel que soit le nb de logs
  }
};

const writeErr = (s: string): void => {
  // Flush stdout d'abord → ordre causal préservé en sortie mergée (`2>&1`).
  if (_outChunks && _outChunks.length > 0) _flushOut();
  _writeStderrNow(s);
};

// Filet anti-perte : vide le buffer tick PUIS flush SYNC le driver en sortie de
// process (exit normal, process.exit, boucle vide, ou après un crash non géré —
// Node imprime la stack puis émet `exit`). On NE pose PAS de handler SIGTERM/
// SIGINT/uncaughtException ici (core chargé partout → casserait Ctrl+C et
// masquerait les crashes) : le shutdown kernel sort via process.exit → `exit`.
// SIGKILL/OOM = non-interceptable → perte bornée ≤ 1 tick, inhérente.
if (_proc?.on) {
  const _onExit = (): void => {
    _flushOut();
    _sink.flushSync();
  };
  _proc.on("exit", _onExit);
  _proc.on("beforeExit", _onExit);
}

type Operator = "<" | ">" | "<=" | ">=" | "==" | "===" | "!=" | "RegExp";
type Condition = "&&" | "||";

// Data est intentionnellement hétérogène : severity (number|string|array),
// msgid (string|RegExp|array), date (Date|string|number).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

interface LogicCondition {
  "&&": (myConditions: ConditionSetting, pdu: Pdu) => boolean;
  "||": (myConditions: ConditionSetting, pdu: Pdu) => boolean;
}

interface Conditions {
  severity: (pdu: Pdu, condition: ConditionSetting) => boolean;
  msgid: (pdu: Pdu, condition: ConditionSetting) => boolean;
  date: (pdu: Pdu, condition: ConditionSetting) => boolean;
  [key: string]: (pdu: Pdu, condition: ConditionSetting) => boolean;
}

export interface ConditionSetting {
  operator?: Operator;
  data: Data;
  [key: string]: Data;
}

export interface conditionsInterface {
  severity?: ConditionSetting;
  msgid?: ConditionSetting;
  data?: Data;
  checkConditions?: Condition;
  [key: string]: Data;
}

export interface SyslogDefaultSettings {
  moduleName?: ModuleName;
  msgid?: Msgid;
  maxStack?: number;
  rateLimit?: boolean | number;
  burstLimit?: number;
  defaultSeverity?: Severity;
  checkConditions?: Condition;
  async?: boolean;
  overrideConsole?: boolean;
}

export interface WrapperResult {
  logger: (...args: unknown[]) => void;
  text: string;
}

type ComparisonOperator = (
  ele1: number | string,
  ele2: number | string | RegExp,
) => boolean;

interface Operators {
  "<": ComparisonOperator;
  ">": ComparisonOperator;
  "<=": ComparisonOperator;
  ">=": ComparisonOperator;
  "==": ComparisonOperator;
  "===": ComparisonOperator;
  "!=": ComparisonOperator;
  RegExp: ComparisonOperator;
}

export type CallbackFunction = (pdu: Pdu) => void;
type CallbackArray = Pdu[];
type Callback = CallbackFunction | CallbackArray | null;

// O(1) circular ring buffer — replaces Array.shift() which is O(n)
class CircularBuffer<T> {
  private buf: Array<T | undefined>;
  private head = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    if (this._size === this.capacity) {
      // Overwrite oldest slot, advance head past it
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    } else {
      const tail = (this.head + this._size) % this.capacity;
      this.buf[tail] = item;
      this._size++;
    }
  }

  get length(): number {
    return this._size;
  }

  last(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[(this.head + this._size - 1) % this.capacity] as T;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }

  // Returns elements in FIFO order (oldest first, newest last)
  toArray(): T[] {
    const result = new Array<T>(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity] as T;
    }
    return result;
  }
}

const formatDebug = function (debug: DebugType): DebugType {
  if (typeof debug === "boolean") return debug;
  if (typeof debug === "string") {
    if (["false", "undefined", "null"].includes(debug)) return false;
    if (debug === "true" || debug === "*") return true;
    const mytab = debug.split(/,| /);
    return mytab[0] === "*" ? true : mytab;
  }
  if (Array.isArray(debug)) {
    return (debug as string[])[0] === "*" ? true : debug;
  }
  return false;
};

const conditionOptions = function (
  environment: string,
  debug: DebugType = false,
): conditionsInterface {
  debug = formatDebug(debug);
  let obj: conditionsInterface;
  if (environment === "development") {
    obj = {
      severity: {
        operator: "<=",
        data: debug === false ? 6 : 7,
      },
    };
  } else {
    obj = {
      severity: {
        operator: "<=",
        data: debug ? 7 : 6,
      },
    };
  }
  if (typeof debug === "object") {
    obj.msgid = {
      operator: "==",
      data: debug,
    };
  }
  return obj;
};

const defaultSettings: SyslogDefaultSettings = {
  moduleName: "SYSLOG",
  msgid: "",
  maxStack: 100,
  rateLimit: false,
  burstLimit: 3,
  defaultSeverity: "DEBUG",
  checkConditions: "&&",
  async: false,
};

const sysLogSeverity = Pdu.sysLogSeverity();

const operators: Operators = {
  "<": (ele1, ele2) => ele1 < ele2,
  ">": (ele1, ele2) => ele1 > ele2,
  "<=": (ele1, ele2) => ele1 <= ele2,
  ">=": (ele1, ele2) => ele1 >= ele2,
  "==": (ele1, ele2) => ele1 == ele2,
  "===": (ele1, ele2) => ele1 === ele2,
  "!=": (ele1, ele2) => ele1 !== ele2,
  RegExp: (ele1, ele2) => (ele2 as RegExp).test(ele1 as string),
};

const conditionsObj: Conditions = {
  severity: (pdu: Pdu, condition: ConditionSetting) => {
    for (const sev in condition.data) {
      if (
        condition.operator &&
        operators[condition.operator](pdu.severity, condition.data[sev])
      ) {
        return true;
      }
    }
    return false;
  },
  msgid: (pdu: Pdu, condition: ConditionSetting) => {
    if (condition.data instanceof RegExp) {
      return condition.data.test(pdu.msgid);
    }
    for (const sev in condition.data) {
      if (condition.operator && operators[condition.operator](pdu.msgid, sev)) {
        return true;
      }
    }
    return false;
  },
  date: (pdu: Pdu, condition: ConditionSetting) =>
    condition.operator
      ? operators[condition.operator](pdu.timeStamp, condition.data)
      : false,
};

const logicCondition: LogicCondition = {
  "&&": (myConditions: ConditionSetting, pdu: Pdu): boolean => {
    let res = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (!res) break;
    }
    return res;
  },
  "||": (myConditions: ConditionSetting, pdu: Pdu): boolean => {
    let res = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (res) break;
    }
    return res;
  },
};

const checkFormatSeverity = (ele: unknown): string[] | number[] => {
  let res: Array<string | number>;
  switch (typeof ele) {
    case "object":
      if (Array.isArray(ele)) {
        res = ele as Array<string | number>;
      } else {
        throw new Error(`checkFormatSeverity bad format type: object`);
      }
      break;
    case "string":
      res = (ele as string).split(/,| /);
      break;
    case "number":
      res = [ele as number];
      break;
    default:
      throw new Error(`checkFormatSeverity bad format type : ${typeof ele}`);
  }
  return res as string[] | number[];
};

const checkFormatDate = function (ele: Date | string): number {
  if (ele instanceof Date) return ele.getTime();
  if (typeof ele === "string") return new Date(ele).getTime();
  throw new Error(`checkFormatDate bad format : ${String(ele)}`);
};

const checkFormatMsgId = function (ele: unknown): RegExp | Array<unknown> {
  if (typeof ele === "string") return ele.split(/,| /);
  if (typeof ele === "number") return [ele];
  if (ele instanceof RegExp) return ele;
  if (Array.isArray(ele)) return ele;
  throw new Error(`checkFormatMsgId bad format ${typeof ele} : ${String(ele)}`);
};

type ConditionFilter = ((pdu: Pdu) => void) | Pdu[];

const wrapperCondition = function (
  this: Syslog,
  conditions: conditionsInterface,
  callback: Callback | CallbackArray,
): ConditionFilter {
  let myFuncCondition: (
    conditions: ConditionSetting,
    pdu: Pdu,
  ) => boolean = () => false;

  if (
    conditions.checkConditions &&
    conditions.checkConditions in logicCondition
  ) {
    myFuncCondition = logicCondition[conditions.checkConditions];
    delete conditions.checkConditions;
  } else if (this.settings.checkConditions) {
    myFuncCondition = logicCondition[this.settings.checkConditions];
  }

  const Conditions = sanitizeConditions(conditions);

  if (typeof callback === "function") {
    return (pdu: Pdu) => {
      const res = myFuncCondition(Conditions as ConditionSetting, pdu);
      if (res) {
        (callback as CallbackFunction)(pdu);
      }
    };
  }

  if (Array.isArray(callback)) {
    const tab: Pdu[] = [];
    for (const pdu of callback as CallbackArray) {
      const res = myFuncCondition(Conditions as ConditionSetting, pdu);
      if (res) {
        tab.push(pdu);
      }
    }
    return tab;
  }

  throw new Error("Bad wrapper");
};

const sanitizeConditions = function (
  settingsCondition: conditionsInterface,
): boolean | ConditionSetting {
  if (typeof settingsCondition !== "object" || settingsCondition === null) {
    return false;
  }
  for (const ele in settingsCondition) {
    if (!(ele in conditionsObj)) {
      return false;
    }
    const condi: ConditionSetting = settingsCondition[ele];

    if (condi.operator && !(condi.operator in operators)) {
      throw new Error(`Contitions bad operator : ${condi.operator}`);
    }
    if (condi.data) {
      switch (ele) {
        case "severity": {
          if (!condi.operator) {
            condi.operator = "==";
          }
          const res = checkFormatSeverity(condi.data);
          condi.data = {};
          for (let i = 0; i < res.length; i++) {
            const mySeverity = Pdu.severityToString(res[i] as number);
            if (mySeverity) {
              condi.data[mySeverity as Severity] =
                sysLogSeverity[mySeverity as Severity];
            } else {
              return false;
            }
          }
          break;
        }
        case "msgid": {
          if (!condi.operator) {
            condi.operator = "==";
          }
          const res = checkFormatMsgId(condi.data);
          if (Array.isArray(res)) {
            condi.data = {};
            for (let i = 0; i < res.length; i++) {
              condi.data[String(res[i])] = "||";
            }
          } else {
            condi.data = res;
          }
          break;
        }
        case "date": {
          const res = checkFormatDate(condi.data as Date | string);
          if (res) {
            condi.data = res;
          } else {
            return false;
          }
          break;
        }
        default:
          return false;
      }
    } else {
      return false;
    }
  }
  return settingsCondition as unknown as ConditionSetting;
};

const createPDU = function (
  this: Syslog,
  payload: Pci,
  severity?: Severity,
  moduleName?: ModuleName,
  msgid?: Message,
  msg?: Message,
): Pdu {
  return new Pdu(
    payload,
    severity || this.settings.defaultSeverity,
    moduleName,
    msgid,
    msg,
  );
};

/**
 * Hub central de logs structurés de Nodefony — conforme RFC 5424.
 *
 * Reçoit des {@link Pdu} via {@link log}, les pousse dans un ring buffer (`CircularBuffer`,
 * O(1)), applique les filtres ({@link listenWithConditions}), et fire `"onLog"` pour les
 * transports branchés (console, file, JSON, SSE Studio).
 *
 * Hérite d'{@link Event} (EventEmitter étendu) → toute brique du framework peut s'abonner.
 *
 * Modes :
 * - **rateLimit** + **burstLimit** : protection anti-flood (ex: boucle qui log 10k/s)
 * - **async** : fire `"onLog"` sur next tick (libère le hot path) ou inline
 * - **overrideConsole** : intercepte `console.log/warn/error/debug/info` → pipe vers Syslog
 *
 * @example
 * ```ts
 * const syslog = new Syslog({ moduleName: "MyApp", defaultSeverity: "INFO" });
 * syslog.on("onLog", (pdu: Pdu) => console.log(pdu.toString()));
 * syslog.log("hello world", "INFO");
 * ```
 *
 * @remarks Utilisé par défaut par chaque {@link Service} via `this.syslog`. Pour les apps
 *   complexes, partager un Syslog unique entre services évite de dupliquer les buffers.
 */
class Syslog extends Event implements ISyslog {
  public settings: SyslogDefaultSettings;
  private _ring: CircularBuffer<Pdu>;
  public burstPrinted: number;
  public missed: number;
  public invalid: number;
  public valid: number;
  /**
   * Cumul monotone des logs de classe ERREUR (sévérité 0–3 : ERROR/CRITIC/ALERT/EMERGENCY)
   * acceptés depuis la construction. Compteur entier O(1) bumpé dans le seul point de passage
   * {@link pushStack} (0 alloc) → sonde « erreurs par worker » de la santé
   * pod (cf `IInstanceErrorHealth`). Débit dérivé côté lecteur (delta `errorTotal`/ts).
   */
  public errorTotal: number;
  /** Sous-ensemble CRITIQUE (sévérité 0–2 : CRITIC/ALERT/EMERGENCY). Cumul monotone. */
  public criticTotal: number;
  public start: number;
  private _async: boolean = false;
  private _transports: ITransport[] = [];
  /**
   * Transports désactivés à chaud (par `setTransportEnabled`) — **lazy** (`null`
   * tant qu'aucun toggle). Garde la réf hors de `_transports` pour pouvoir la
   * remonter. Un transport désactivé est PHYSIQUEMENT retiré de la boucle de fire
   * → **0 surcoût hot path** (pas de test `enabled` par log). Outil dev/diagnostic.
   */
  private _disabledTransports: Map<string, ITransport> | null = null;
  /**
   * Stockage des Pdu dans le ring buffer (relecture mémoire). `false` = on ne
   * garde plus rien en mémoire (l'Explorer « mémoire » et `buffered` tombent à 0)
   * — outil avancé perf/mémoire (très haut débit). Les compteurs (valid/error)
   * restent comptés. Coût hot path : un test booléen par log.
   */
  private _ringEnabled: boolean = true;
  /**
   * Diffusion temps réel active (bus `nodefony:syslog` Studio). `false` = le pont de
   * diffusion (`createSyslogBridge`) n'accumule ni ne publie rien → l'onglet Live se
   * grise. N'affecte NI l'écriture (transports/sink) NI la relecture. Coupé = on
   * cesse juste de POUSSER en live ; les logs continuent d'être générés et écrits.
   */
  private _streamEnabled: boolean = true;
  /**
   * T2 (profil delta vs Express) — gate d'ENTRÉE par sévérité. `null` (défaut) =
   * pas de gate (comportement historique : tout Pdu est créé + poussé au ring,
   * le filtrage de sévérité n'a lieu qu'au LISTENER d'impression — un DEBUG en
   * prod coûtait createPDU + pushStack pour rien, ~1,7 % du profil CPU/req).
   * Valeur numérique N = un log de sévérité STRICTEMENT supérieure à N (moins
   * grave) est court-circuité AVANT toute allocation. Posé par {@link init}
   * (production sans debug → 6 = DEBUG gaté), **re-résoluble à chaud** via
   * {@link setSeverityThreshold} (vision « audit à chaud » : élever la
   * verbosité prod sur une fenêtre bornée sans redémarrer). Une sévérité
   * INCONNUE (`-1`) passe toujours — c'est `createPDU` qui la refuse, et le
   * gate ne doit pas transformer une erreur d'usage en silence. Compteur
   * {@link gated} pour l'introspection.
   */
  private _severityThreshold: number | null = null;
  /** Pdu singleton retourné par un log gaté (contrat `log(): Pdu`, 1 alloc lazy). */
  private _gatedPdu: Pdu | null = null;
  /** Nombre de logs court-circuités par le gate de sévérité (T2). */
  public gated: number = 0;
  /**
   * Overrides de seuil PAR MODULE (clé = `msgid` du Pdu, qui vaut le nom du
   * Service émetteur par défaut — cf `Service.log`). `null` par défaut → 0 coût
   * sur le hot path tant qu'aucun debug ciblé n'est actif (RÈGLE perf : lazy
   * null). Posé à chaud par {@link setDebugOverride} (env `NF__DEBUG` au boot,
   * endpoint admin, toggle Studio) : élève la verbosité d'UN module sous gate
   * prod sans toucher les autres ni redémarrer. Consulté dans {@link log} APRÈS
   * le gate global, AVANT toute allocation.
   */
  private _debugOverrides: Map<string, number> | null = null;
  /**
   * Timers d'auto-extinction des overrides (clé = même `msgid`). `null` tant
   * qu'aucun override temporisé n'est armé. Garde-fou anti-oubli : un debug
   * ciblé ne reste JAMAIS allumé indéfiniment. Timers `unref` (ne tiennent pas
   * la boucle d'événements en vie) + purgés par {@link clearDebugOverride} /
   * {@link reset} (RÈGLE perf : pas de timer sans cleanup).
   */
  private _debugOverrideTimers: Map<
    string,
    ReturnType<typeof setTimeout>
  > | null = null;
  /**
   * Échéance (epoch ms) de chaque override TEMPORISÉ — pour exposer le « s'éteint
   * dans X » au panneau Studio. `null` tant qu'aucun override temporisé ; un
   * override permanent (sans ttl) n'y figure pas. Nettoyé en miroir du timer.
   */
  private _debugOverrideExpiry: Map<string, number> | null = null;

  /**
   * Construit le Syslog avec settings (merge default + override user).
   *
   * @param settings - config (`moduleName`, `maxStack`, `rateLimit`, `burstLimit`,
   *   `defaultSeverity`, `async`, `overrideConsole`).
   */
  constructor(settings?: SyslogDefaultSettings) {
    super(settings);
    this.settings = extend({}, defaultSettings, settings || {});
    this._ring = new CircularBuffer<Pdu>(this.settings.maxStack ?? 100);
    this.burstPrinted = 0;
    this.missed = 0;
    this.invalid = 0;
    this.valid = 0;
    this.errorTotal = 0;
    this.criticTotal = 0;
    this.start = 0;
    this._async = (this.settings.async as boolean) || false;
    if (this.settings.overrideConsole) {
      Syslog.overrideConsole(this);
    }
  }

  // ringStack returns elements in FIFO order (oldest first, newest last)
  get ringStack(): Pdu[] {
    return this._ring.toArray();
  }

  /**
   * Capacité MAX du ring buffer (`settings.maxStack`) — nombre de Pdu que la
   * mémoire peut relire. `ringStack.length` = remplissage courant ; ce getter =
   * le plafond. Lecture seule, 0 allocation (introspection data plane Studio).
   */
  get bufferCapacity(): number {
    return this._ring.capacity;
  }

  /** `true` si les Pdu sont stockés dans le ring (relecture mémoire active). */
  get ringEnabled(): boolean {
    return this._ringEnabled;
  }

  /**
   * Active/désactive le stockage mémoire (ring) à chaud — outil avancé perf/mémoire.
   * Désactiver = l'Explorer « mémoire » et `buffered` retombent à 0 (les logs ne
   * sont plus gardés en RAM) ; les compteurs santé restent comptés. Vide le ring
   * quand on coupe (libère la RAM tout de suite). Idempotent.
   *
   * @param enabled - `true` = stocker dans le ring ; `false` = ne plus stocker.
   * @returns `true` si l'état a changé.
   */
  setRingEnabled(enabled: boolean): boolean {
    if (this._ringEnabled === enabled) return false;
    this._ringEnabled = enabled;
    if (!enabled) this._ring.clear();
    return true;
  }

  /** `true` si la diffusion temps réel (`nodefony:syslog`) est active. */
  get streamEnabled(): boolean {
    return this._streamEnabled;
  }

  /**
   * Active/désactive la diffusion temps réel (bus `nodefony:syslog`) à chaud. Coupé =
   * le pont Studio cesse de pousser des frames (onglet Live grisé) ; l'écriture et la
   * relecture froide ne sont PAS touchées. Idempotent.
   *
   * @param enabled - `true` = diffuser ; `false` = couper la diffusion live.
   * @returns `true` si l'état a changé.
   */
  setStreamEnabled(enabled: boolean): boolean {
    if (this._streamEnabled === enabled) return false;
    this._streamEnabled = enabled;
    return true;
  }

  /**
   * Redimensionne le ring buffer (capacité de relecture en mémoire) en
   * **préservant** les Pdu déjà présents (tronqués aux `max` plus récents si on
   * rétrécit). Destiné au **boot uniquement** (lu depuis `config.log.maxStack`) —
   * recrée le buffer, donc à ne pas appeler dans le hot path. No-op si `max`
   * invalide ou inchangé.
   *
   * @param max - nouvelle capacité (> 0).
   */
  setMaxStack(max: number): void {
    if (!Number.isFinite(max) || max <= 0 || max === this.settings.maxStack) {
      return;
    }
    const kept = this._ring.toArray().slice(-max);
    this.settings.maxStack = max;
    this._ring = new CircularBuffer<Pdu>(max);
    for (const pdu of kept) this._ring.push(pdu);
  }

  static formatDebug(debug: DebugType): DebugType {
    return formatDebug(debug);
  }

  /**
   * Initialise le pipeline Syslog selon environnement + debug. Idempotent — purge les
   * listeners `"onLog"` existants avant d'en ajouter un.
   *
   * @param environment - `"development"` / `"production"` / `"test"`.
   * @param debug - active sévérité DEBUG (`+7`).
   * @param options - conditions de filtrage Syslog custom (override des conditions par env).
   */
  init(
    environment: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface,
  ): void {
    // Idempotent : on réinitialise les listeners "onLog" avant d'en ajouter un.
    // Évite l'accumulation quand init() est appelé plusieurs fois (Cli + CliKernel ctors).
    this.removeAllListeners("onLog");
    this.listenWithConditions(
      options || conditionOptions(environment, debug),
      (pdu: Pdu) => Syslog.normalizeLog(pdu),
    );
    // T2 — le gate d'entrée n'est PAS posé ici : `init()` est appelé tôt avec
    // un environment défaut "production" (Service.initSyslog sans args, ctor
    // CliKernel) AVANT la résolution réelle de l'env → signal pollué (gâterait
    // les DEBUG en dev). Le seuil est posé par le KERNEL (composition root,
    // env réel résolu — même zone que le câblage du sink/driver) via
    // {@link setSeverityThreshold}.
  }

  /**
   * T2 — résout une sévérité (nom ou numérique) en valeur RFC 5424. Inconnue →
   * `-1` (passe toujours le gate : fail-open, `createPDU` jettera comme avant).
   * `sysLogSeverity` est un enum numérique TS → la reverse-map mêle string et
   * number, d'où le narrowing explicite.
   */
  private static toSeverityNumber(severity: Severity | number): number {
    if (typeof severity === "number") {
      return severity;
    }
    const v = sysLogSeverity[severity];
    return typeof v === "number" ? v : -1;
  }

  /**
   * Valide STRICTEMENT une sévérité d'ENTRÉE (nom RFC 5424 ou numérique 0-7) →
   * numéro, ou `null` si invalide. Pour les surfaces d'entrée (endpoint admin,
   * env) : un niveau inconnu doit être REJETÉ, jamais silencieusement
   * réinterprété (≠ {@link toSeverityNumber}, fail-open `-1` pour le hot path).
   *
   * @param level - nom (`"DEBUG"`) ou numéro (`7` / `"7"`).
   * @returns le numéro 0-7, ou `null` si hors plage / nom inconnu.
   */
  static severityFromInput(level: string | number): number | null {
    if (typeof level === "number") {
      return Number.isInteger(level) && level >= 0 && level <= 7 ? level : null;
    }
    if (typeof level === "string") {
      if (/^\d+$/.test(level)) {
        const n = Number(level);
        return n >= 0 && n <= 7 ? n : null;
      }
      const v = sysLogSeverity[level as Severity];
      return typeof v === "number" ? v : null;
    }
    return null;
  }

  /**
   * Parse une spec `NF__DEBUG` (env runtime) en directives de debug ciblé.
   * Tokens séparés par virgule/espace :
   * - `*` → debug GLOBAL (lève le gate de sévérité, tout passe) ;
   * - `MODULE` → override `MODULE` à DEBUG ;
   * - `MODULE:LEVEL` → override `MODULE` au niveau `LEVEL` (nom/numérique ;
   *   inconnu → DEBUG, tolérant : un typo d'env ne doit pas crasher le boot).
   *
   * Pur (statique, sans état) → testable seul ; appliqué par le Kernel au boot
   * via {@link setSeverityThreshold} / {@link setDebugOverride}.
   *
   * @param spec - valeur brute de `NF__DEBUG` (ex. `"FIREWALL,SESSION:NOTICE"`).
   * @returns `{ global, overrides }`.
   */
  static parseDebugSpec(spec: string): {
    global: boolean;
    overrides: Array<{ module: string; level: number }>;
  } {
    const result: {
      global: boolean;
      overrides: Array<{ module: string; level: number }>;
    } = { global: false, overrides: [] };
    if (typeof spec !== "string") {
      return result;
    }
    for (const token of spec.split(/[,\s]+/)) {
      if (!token) {
        continue;
      }
      if (token === "*") {
        result.global = true;
        continue;
      }
      const sep = token.indexOf(":");
      if (sep === -1) {
        result.overrides.push({ module: token, level: 7 });
        continue;
      }
      const module = token.slice(0, sep);
      if (!module) {
        continue;
      }
      // Niveau inconnu → DEBUG (tolérant : un typo d'env ne crashe pas le boot).
      const lvl = Syslog.severityFromInput(token.slice(sep + 1)) ?? 7;
      result.overrides.push({ module, level: lvl });
    }
    return result;
  }

  /**
   * T2 — règle (ou lève) le gate d'entrée par sévérité À CHAUD, sans reboot.
   * `null` = plus de gate (tout est créé/poussé, comportement historique) ;
   * `"DEBUG"`/7 = tout passe en restant gateable ; `"INFO"`/6 = défaut prod.
   * Levier de la fenêtre « audit à chaud » : élever temporairement la
   * verbosité prod puis restaurer.
   *
   * @param threshold - sévérité max acceptée (nom ou numérique RFC 5424), ou `null`.
   */
  setSeverityThreshold(threshold: Severity | number | null): void {
    this._severityThreshold =
      threshold === null ? null : Syslog.toSeverityNumber(threshold);
  }

  /**
   * T2 — un log de cette sévérité franchirait-il le gate d'entrée ? À utiliser
   * aux call sites du hot path AVANT de construire un message coûteux
   * (template string, JSON) — pattern L1 « ne jamais formater au-dessus du
   * niveau actif ».
   *
   * @param severity - sévérité à tester (nom ou numérique).
   * @returns `true` si un log de cette sévérité serait accepté.
   */
  severityEnabled(severity: Severity | number): boolean {
    if (this._severityThreshold === null) {
      return true;
    }
    return Syslog.toSeverityNumber(severity) <= this._severityThreshold;
  }

  /**
   * Élève à chaud le seuil de verbosité d'UN module (debug ciblé), sans reboot et
   * sans toucher aux autres modules. `module` = `msgid` du Pdu (par défaut le nom
   * du Service émetteur, cf `Service.log`). Effet : tant que l'override est actif,
   * un log de ce module passe le gate d'entrée jusqu'à `level` (ex. `"DEBUG"`)
   * alors que le reste reste au seuil global (ex. `"INFO"` en prod).
   *
   * Garde-fou : si `ttlMs > 0`, l'override s'auto-éteint après ce délai (timer
   * `unref`). (Re)poser le même module ré-arme proprement le timer. Sans gate
   * global actif (`_severityThreshold === null`, ex. dev) l'override est sans
   * effet — tout passe déjà.
   *
   * @param module - identité du module (`msgid` / nom du Service).
   * @param level - sévérité max laissée passer pour ce module (nom ou numérique).
   * @param ttlMs - durée de vie en ms (auto-extinction). Omis/≤0 = permanent (déconseillé en prod).
   */
  setDebugOverride(
    module: string,
    level: Severity | number,
    ttlMs?: number,
  ): void {
    if (this._debugOverrides === null) {
      this._debugOverrides = new Map();
    }
    this._debugOverrides.set(module, Syslog.toSeverityNumber(level));
    this.clearOverrideTimer(module);
    if (ttlMs !== undefined && ttlMs > 0) {
      if (this._debugOverrideTimers === null) {
        this._debugOverrideTimers = new Map();
      }
      const timer = setTimeout(() => {
        this.clearDebugOverride(module);
      }, ttlMs);
      timer.unref();
      this._debugOverrideTimers.set(module, timer);
      if (this._debugOverrideExpiry === null) {
        this._debugOverrideExpiry = new Map();
      }
      this._debugOverrideExpiry.set(module, Date.now() + ttlMs);
    } else if (this._debugOverrideExpiry !== null) {
      // (re)pose PERMANENTE → retire une échéance antérieure éventuelle.
      this._debugOverrideExpiry.delete(module);
      if (this._debugOverrideExpiry.size === 0) {
        this._debugOverrideExpiry = null;
      }
    }
  }

  /**
   * Retire l'override de debug ciblé d'un module (et son timer d'auto-extinction).
   * Retombe à `null` quand le dernier override part (RÈGLE perf : 0 coût hot path).
   *
   * @param module - identité du module (`msgid`).
   * @returns `true` si un override existait et a été retiré.
   */
  clearDebugOverride(module: string): boolean {
    this.clearOverrideTimer(module);
    if (this._debugOverrideExpiry !== null) {
      this._debugOverrideExpiry.delete(module);
      if (this._debugOverrideExpiry.size === 0) {
        this._debugOverrideExpiry = null;
      }
    }
    if (this._debugOverrides === null) {
      return false;
    }
    const had = this._debugOverrides.delete(module);
    if (this._debugOverrides.size === 0) {
      this._debugOverrides = null;
    }
    return had;
  }

  /** Retire TOUS les overrides de debug ciblé + leurs timers (retour à 0 coût). */
  clearAllDebugOverrides(): void {
    if (this._debugOverrideTimers !== null) {
      for (const timer of this._debugOverrideTimers.values()) {
        clearTimeout(timer);
      }
      this._debugOverrideTimers = null;
    }
    this._debugOverrides = null;
    this._debugOverrideExpiry = null;
  }

  /**
   * Snapshot des overrides de debug ciblé actifs (introspection — endpoint admin,
   * toggle Studio). Cold path. `{}` si aucun.
   *
   * @returns map `module → seuil numérique` (copie, pas la structure interne).
   */
  getDebugOverrides(): Record<string, number> {
    if (this._debugOverrides === null) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [module, threshold] of this._debugOverrides) {
      out[module] = threshold;
    }
    return out;
  }

  /**
   * Échéances (epoch ms) des overrides TEMPORISÉS (introspection — countdown
   * Studio « s'éteint dans X »). `{}` si aucun ; un override permanent (sans ttl)
   * n'y figure pas.
   *
   * @returns map `module → epoch ms d'extinction` (copie).
   */
  getDebugOverrideExpiry(): Record<string, number> {
    if (this._debugOverrideExpiry === null) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [module, at] of this._debugOverrideExpiry) {
      out[module] = at;
    }
    return out;
  }

  /** Annule + retire le timer d'auto-extinction d'un module (si présent). */
  private clearOverrideTimer(module: string): void {
    if (this._debugOverrideTimers === null) {
      return;
    }
    const timer = this._debugOverrideTimers.get(module);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._debugOverrideTimers.delete(module);
      if (this._debugOverrideTimers.size === 0) {
        this._debugOverrideTimers = null;
      }
    }
  }

  get async(): boolean {
    return this._async;
  }

  set async(value: boolean) {
    this._async = value;
  }

  /**
   * Alias de {@link reset} — purge ring buffer + listeners.
   */
  clean(): this {
    return this.reset();
  }

  /**
   * Reset complet — vide le ring buffer ET retire tous les listeners.
   *
   * @returns `this` pour chaînage.
   */
  reset(): this {
    this._ring.clear();
    this.removeAllListeners();
    this.clearAllDebugOverrides();
    return this;
  }

  /**
   * Vide uniquement le ring buffer (conserve les listeners attachés).
   */
  clearLogStack(): void {
    this._ring.clear();
  }

  /**
   * Push manuel d'un Pdu dans le ring buffer + incrémente compteur `valid`.
   *
   * @param pdu - Pdu à enregistrer.
   * @returns nouvelle taille du ring buffer après push.
   */
  pushStack(pdu: Pdu): number {
    if (this._ringEnabled) this._ring.push(pdu);
    this.valid++;
    // Sonde « erreurs par worker » : 2 incréments entiers gardés.
    // 0–3 = ERROR/CRITIC/ALERT/EMERGENCY ; 0–2 = sous-ensemble CRITIQUE. 0 alloc, hot path.
    const sev = pdu.severity;
    if (sev >= 0 && sev <= 3) {
      this.errorTotal++;
      if (sev <= 2) this.criticTotal++;
    }
    return this._ring.length;
  }

  /**
   * Crée un Pdu et le diffuse dans le pipeline (rate-limit → push → fire `"onLog"`).
   *
   * **Protection rate limit** : si `settings.rateLimit > 0`, ne fire `"onLog"` que pour les
   * `burstLimit` premiers Pdu de la fenêtre. Les suivants incrémentent `missed`.
   *
   * **Mode async** : si `this.async === true`, fire `"onLog"` sur `setImmediate()` (libère
   * le hot path du caller).
   *
   * @param payload - contenu (string, Error, objet — narrower côté lecteur).
   * @param severity - sévérité RFC 5424 (`"INFO"`, `"ERROR"`, ...) ou numérique (6, 3, ...).
   * @param msgid - catégorie de message (`"AUTH"`, `"ROUTER"`). Défaut = `settings.msgid`.
   * @param msg - détail libre optionnel.
   * @returns le `Pdu` créé (utile pour audit/tests).
   */
  log(
    payload: Pci,
    severity?: Severity,
    msgid?: ModuleName,
    msg?: Message,
  ): Pdu {
    // T2 — gate d'ENTRÉE par sévérité (résolu au boot, re-résoluble à chaud) :
    // sous le seuil → AUCUN Pdu créé, RIEN au ring/transports/listeners.
    // Une sévérité INCONNUE (`-1`) passe toujours : `createPDU` la refuse
    // ensuite, comme avant. Coût hot path : 1 test null + 1 lookup map.
    if (this._severityThreshold !== null) {
      const sev =
        payload instanceof Pdu
          ? payload.severity
          : Syslog.toSeverityNumber(
              severity ?? this.settings.defaultSeverity ?? "DEBUG",
            );
      // Seuil EFFECTIF : global par défaut, ÉLEVÉ pour un module sous debug
      // ciblé ({@link setDebugOverride}). Lazy : tout le bloc est sauté tant
      // qu'aucun override n'est posé (0 coût hot path). Clé = msgid (= nom du
      // Service émetteur par défaut).
      let threshold = this._severityThreshold;
      if (this._debugOverrides !== null) {
        const key =
          payload instanceof Pdu ? payload.msgid : msgid || this.settings.msgid;
        // Override spécifique au module, sinon override GLOBAL `*` (« debug
        // tout » — réutilise le TTL/auto-extinction des overrides par-module).
        const eff =
          this._debugOverrides.get(key as string) ??
          this._debugOverrides.get("*");
        if (eff !== undefined) {
          threshold = eff;
        }
      }
      if (sev > threshold) {
        this.gated++;
        if (this._gatedPdu === null) {
          this._gatedPdu = createPDU.call(
            this,
            "GATED",
            "DEBUG",
            this.settings.moduleName,
            msgid || this.settings.msgid,
          );
          this._gatedPdu.status = "DROPPED";
        }
        return this._gatedPdu;
      }
    }
    let pdu: Pdu | undefined;
    if (this.settings.rateLimit !== false) {
      const rate = this.settings.rateLimit as number;
      const now = Date.now();
      this.start = this.start || now;
      if (now > this.start + rate) {
        this.burstPrinted = 0;
        this.missed = 0;
        this.start = 0;
      }
      if (
        this.settings.burstLimit &&
        this.settings.burstLimit > this.burstPrinted
      ) {
        try {
          pdu =
            payload instanceof Pdu
              ? payload
              : createPDU.call(
                  this,
                  payload,
                  severity,
                  this.settings.moduleName,
                  msgid || this.settings.msgid,
                  msg,
                );
        } catch (e) {
          console.error(e);
          this.invalid++;
          pdu = pdu ?? createPDU.call(this, e, "ERROR");
          pdu.status = "INVALID";
          return pdu;
        }
        this.pushStack(pdu);
        pdu.status = "ACCEPTED";
        if (this.listenerCount("onLog") > 0) {
          this.fire("onLog", pdu);
        }
        if (this._transports.length > 0) this._fireTransports(pdu);
        this.burstPrinted++;
        return pdu;
      }
      this.missed++;
      pdu = pdu ?? createPDU.call(this, "DROPPED", "WARNING");
      pdu.status = "DROPPED";
      return pdu;
    }

    try {
      pdu =
        payload instanceof Pdu
          ? payload
          : createPDU.call(
              this,
              payload,
              severity,
              this.settings.moduleName,
              msgid || this.settings.msgid,
              msg,
            );
    } catch (e) {
      console.error(e);
      this.invalid++;
      pdu = pdu ?? createPDU.call(this, e, "ERROR");
      pdu.status = "INVALID";
      return pdu;
    }
    this.pushStack(pdu);
    pdu.status = "ACCEPTED";
    if (this.listenerCount("onLog") > 0) {
      this.fire("onLog", pdu);
    }
    if (this._transports.length > 0) this._fireTransports(pdu);
    return pdu;
  }

  getLogStack(
    start?: number,
    end?: number,
    condition?: conditionsInterface,
  ): Pdu[] | Pdu {
    // Fast path: no arguments → last entry without building full array
    if (arguments.length === 0) {
      return this._ring.last() as Pdu;
    }
    let stack: Pdu[];
    if (condition) {
      stack = this.getLogs(condition);
    } else {
      stack = this.ringStack;
    }
    if (!end) {
      return stack.slice(start);
    }
    if (start === end) {
      return stack[stack.length - (start as number) - 1];
    }
    return stack.slice(start, end);
  }

  getLogs(conditions: conditionsInterface, stack: Pdu[] | null = null): Pdu[] {
    if (conditions) {
      return wrapperCondition.call(
        this,
        conditions,
        stack || this.ringStack,
      ) as Pdu[];
    }
    return this.ringStack;
  }

  logToJson(
    conditions: conditionsInterface,
    stack: Pdu[] | null = null,
  ): string {
    const res = conditions ? this.getLogs(conditions, stack) : this.ringStack;
    return JSON.stringify(res);
  }

  loadStack(
    stack: Pdu[] | string,
    doEvent = false,
    beforeConditions: ((pdu: Pdu, stackItem: Pdu) => void) | null = null,
  ): Pdu[] {
    if (!stack) {
      throw new Error("syslog loadStack : not stack in arguments ");
    }
    if (typeof stack === "string") {
      return this.loadStack(
        JSON.parse(stack) as Pdu[],
        doEvent,
        beforeConditions,
      );
    }
    if (Array.isArray(stack) || typeof stack === "object") {
      for (const stackItem of stack as Pdu[]) {
        const pdu = new Pdu(
          stackItem.payload,
          stackItem.severity as Severity | undefined,
          stackItem.moduleName || this.settings.moduleName,
          stackItem.msgid,
          stackItem.msg,
          stackItem.timeStamp,
        );
        this.pushStack(pdu);
        if (doEvent) {
          if (beforeConditions) {
            beforeConditions.call(this, pdu, stackItem);
          }
          this.fire("onLog", pdu);
        }
      }
      return stack as Pdu[];
    }
    throw new Error("syslog loadStack : bad stack in arguments type");
  }

  filter(conditions: conditionsInterface, callback: CallbackFunction): void {
    if (!conditions) {
      throw new Error("filter conditions not found ");
    }
    conditions = extend(true, {}, conditions) as conditionsInterface;
    const wrapper = wrapperCondition.call(this, conditions, callback);
    if (wrapper) {
      super.on("onLog", wrapper as CallbackFunction);
    }
  }

  listenWithConditions(
    conditions: conditionsInterface,
    callback: CallbackFunction,
  ): void {
    return this.filter(conditions, callback);
  }

  error(data: Pci): Pdu {
    return this.log(data, "ERROR");
  }

  warn(data: Pci): Pdu {
    return this.log(data, "WARNING");
  }

  info(data: Pci): Pdu {
    return this.log(data, "INFO");
  }

  debug(data: Pci): Pdu {
    return this.log(data, "DEBUG");
  }

  trace(data: Pci, ...args: unknown[]): Pdu {
    return this.log(data, "NOTICE", ...(args as [ModuleName?, Message?]));
  }

  print(...args: Pci[]): Pdu {
    const payload: Pci = args.length === 1 ? args[0] : args;
    return this.log(payload, this.settings.defaultSeverity);
  }

  logMultiple(severity: Severity, ...args: Pci[]): Pdu {
    const payload: Pci = args.length === 1 ? args[0] : args;
    return this.log(payload, severity);
  }

  addTransport(transport: ITransport): this {
    // Dédup par NAME (identité du transport dans le système : `listTransports` et
    // `setTransportEnabled` indexent par name → l'invariante est « 1 transport par
    // name »). La dédup par référence seule NE SUFFIT PAS : deux `FileTransport`
    // DISTINCTS vers le même fichier ont `name === "file"` et doublonnaient
    // l'écriture quand un même syslog (ressource partagée) est ré-initialisé par
    // DEUX Kernels — cas cluster : le worker boote 2 cycles development→production,
    // et `_mountedLogTransports` (état du Kernel) ne traque pas les transports
    // montés par un Kernel précédent → ils s'accumulaient (ratio JSONL ~2.0). On
    // REMPLACE l'existant → destination la plus récente, jamais de doublon.
    // Boot-only (hors hot path : le dispatch `_fireTransports` est inchangé).
    const idx = this._transports.findIndex((t) => t.name === transport.name);
    if (idx === -1) {
      this._transports.push(transport);
    } else if (this._transports[idx] !== transport) {
      this._transports[idx] = transport;
    }
    return this;
  }

  removeTransport(transport: ITransport): this {
    const idx = this._transports.indexOf(transport);
    if (idx !== -1) this._transports.splice(idx, 1);
    return this;
  }

  /**
   * Nombre de transports d'écriture branchés (introspection — data plane Studio,
   * tests d'idempotence). Lecture seule, 0 allocation.
   */
  get transportCount(): number {
    return this._transports.length;
  }

  /**
   * Liste polymorphe des transports d'écriture — chaque entrée porte le `name` de
   * l'`ITransport` (`console`, `file`, `loki`, `syslog`…) et son état `enabled`.
   * C'est l'axe **WRITE** du Log Backplane : l'écriture est un **fan-out** (1 log →
   * N transports actifs), orthogonal à l'axe READ (1 driver queryable). Sert au data
   * plane Studio pour afficher les vraies destinations (et non les inférer des drivers
   * de relecture, ce qui masquait les transports write-only console/syslog/http).
   *
   * Inclut les transports désactivés à chaud (`enabled:false`) pour que l'UI puisse
   * les ré-activer. Chemin FROID (introspection admin) : alloue à l'appel, jamais
   * dans le hot path du log.
   *
   * @returns un tableau `{ name, enabled }` (montés `true` d'abord, puis désactivés).
   */
  listTransports(): { name: string; enabled: boolean }[] {
    const out = this._transports.map((t) => ({ name: t.name, enabled: true }));
    if (this._disabledTransports) {
      for (const name of this._disabledTransports.keys()) {
        out.push({ name, enabled: false });
      }
    }
    return out;
  }

  /**
   * Active/désactive un transport d'écriture **à chaud, par nom** (outil dev /
   * diagnostic — ex. couper la console pour un bench, ou remonter un transport).
   * Désactiver = retirer le transport de la boucle de fire (réf gardée dans
   * {@link _disabledTransports}) → **0 surcoût hot path**. Activer = le remonter.
   *
   * Réversible et idempotent : un toggle vers l'état déjà courant renvoie `false`.
   * N'instancie RIEN : ne peut réactiver qu'un transport préalablement désactivé
   * (un transport jamais monté — ex. `loki` sans URL — exige sa config, pas ce toggle).
   *
   * @param name - `ITransport.name` ciblé.
   * @param enabled - `true` = remonter, `false` = retirer.
   * @returns `true` si l'état a changé, `false` sinon (déjà dans l'état / introuvable).
   */
  setTransportEnabled(name: string, enabled: boolean): boolean {
    if (enabled) {
      const t = this._disabledTransports?.get(name);
      if (!t) return false;
      this._disabledTransports!.delete(name);
      if (this._disabledTransports!.size === 0) this._disabledTransports = null;
      this.addTransport(t);
      return true;
    }
    const idx = this._transports.findIndex((t) => t.name === name);
    if (idx === -1) return false;
    const [t] = this._transports.splice(idx, 1);
    (this._disabledTransports ??= new Map()).set(name, t);
    return true;
  }

  private _fireTransports(pdu: Pdu): void {
    for (const t of this._transports) {
      t.send(pdu).catch((err: unknown) =>
        this.fire("onTransportError", err, pdu),
      );
    }
  }

  // Native console methods captured before any possible override — prevents recursion
  private static readonly _nativeConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    trace: console.trace.bind(console),
    table: console.table.bind(console),
    dir: console.dir.bind(console),
  };

  private static _savedConsole: typeof Syslog._nativeConsole | null = null;

  /** Largeur fixe du champ `severityName` — couvre `WARNING` (7). */
  private static readonly SEVERITY_WIDTH = 7;
  /** Largeur fixe du champ `msgid` — couvre 95% des cas, déborde proprement pour les longs. */
  private static readonly MSGID_WIDTH = 18;

  static wrapper(pdu: Pdu): WrapperResult {
    if (!pdu) {
      throw new Error("Syslog pdu not defined");
    }
    const d = new Date(pdu.timeStamp);
    // Format `HH:MM:SS.mmm` local — résolution ms pour mesurer les phases du
    // boot (les `toDateString()` + locale renvoyaient une seconde de granularité
    // et 30 chars de prefix redondants à chaque ligne).
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const dateStr = `${h}:${m}:${s}.${ms}`;
    // padEnd AVANT la couleur — les codes ANSI ne sont pas comptés comme chars
    // par les TTY, padder après coloriage casserait l'alignement visuel.
    const sev = pdu.severityName.padEnd(Syslog.SEVERITY_WIDTH);
    const id = pdu.msgid.padEnd(Syslog.MSGID_WIDTH);
    const msgid = green(id);

    switch (pdu.severity) {
      case 0:
      case 1:
      case 2:
      case 3:
        return {
          logger: Syslog._nativeConsole.error,
          text: `${dateStr} ${red(sev)} ${msgid} : `,
        };
      case 4:
        return {
          logger: Syslog._nativeConsole.warn,
          text: `${dateStr} ${yellow(sev)} ${msgid} : `,
        };
      case 5:
        return {
          logger: Syslog._nativeConsole.log,
          text: `${dateStr} ${red(sev)} ${msgid} : `,
        };
      case 6:
        return {
          logger: Syslog._nativeConsole.info,
          text: `${dateStr} ${blue(sev)} ${msgid} : `,
        };
      case 7:
        return {
          logger: Syslog._nativeConsole.debug,
          text: `${dateStr} ${cyan(sev)} ${msgid} : `,
        };
      default:
        return {
          logger: Syslog._nativeConsole.log,
          text: `${dateStr} ${cyan(sev)} ${msgid} : `,
        };
    }
  }

  /**
   * Transport console par défaut — formate un Pdu et l'écrit vers `process.stdout` ou
   * `process.stderr` selon sévérité (ERROR+ vers stderr).
   *
   * Format : `HH:MM:SS.mmm SEVERITY MSGID : payload` avec coloration ANSI.
   *
   * @param pdu - Pdu à imprimer.
   * @param pid - PID préfixé (vide en dev mono-process pour réduire le bruit).
   * @returns le Pdu (chaînable).
   */
  static normalizeLog(pdu: Pdu, pid: string = ""): Pdu {
    if (pdu.payload === "" || pdu.payload === undefined) {
      Syslog._nativeConsole.warn(
        `${pdu.severityName} ${pdu.msgid} : logger message empty !!!!`,
      );
      Syslog._nativeConsole.trace(pdu);
      return pdu;
    }
    const message = pdu.payload;
    const wrap = Syslog.wrapper(pdu);
    // Préfixe pid seulement si fourni — en dev mono-process il est vide et un
    // espace seul polluait le début de chaque ligne.
    const prefix = pid ? `${pid} ` : "";
    wrap.logger(`${prefix}${wrap.text}`, message);
    return pdu;
  }

  // process.stdout/stderr direct — single write(), no console overhead
  static rawLog(pdu: Pdu, pid: string = ""): Pdu {
    if (pdu.payload === "" || pdu.payload === undefined) return pdu;
    const write = pdu.severity <= 3 ? writeErr : writeOut;
    const { text } = Syslog.wrapper(pdu);
    const msg =
      typeof pdu.payload === "string" || typeof pdu.payload === "number"
        ? String(pdu.payload)
        : inspect(pdu.payload, {
            depth: 3,
            colors: isLogColorEnabled(),
            breakLength: Infinity,
          });
    // Préfixe pid seulement si fourni — voir commentaire normalizeLog.
    const prefix = pid ? `${pid} ` : "";
    write(`${prefix}${text}${msg}\n`);
    return pdu;
  }

  /**
   * Mode de bufférisation de la sortie console — **process-global** (un seul
   * `process.stdout`). Câblé par {@link Kernel.initializeLog} depuis `config.log.buffered`.
   *
   * - `"auto"` (défaut) : bufférise si stdout n'est PAS un TTY (pipe/fichier =
   *   prod/collecteur → débit) ; immédiat sur TTY (dev interactif → feedback + spinner).
   * - `true` : toujours bufférisé (ex. bench dans un terminal).
   * - `false` : jamais (ex. `tail -f` non bufférisé en debug prod).
   *
   * Bufférisé = coalesce les écritures d'un même tick en 1 `write()` (1 syscall).
   * stderr (ERROR+) reste TOUJOURS immédiat. Flush les lignes en attente avant de switcher.
   *
   * @param mode - `true` | `false` | `"auto"`.
   */
  static setOutputBuffering(mode: boolean | "auto"): void {
    _setBufferMode(mode);
  }

  /** Vide immédiatement (synchrone) le buffer stdout en attente. Idempotent. */
  static flushOutput(): void {
    _flushOut();
  }

  /**
   * Bascule le DRIVER de sink (LB.W — où partent les lignes après coalescing).
   * `null` → stdout (défaut isomorphe). Câblé par {@link Kernel.initializeLog}
   * depuis `config.log.driver`. Flush + close l'ancien driver avant de switcher.
   *
   * @param sink - driver `ILogSink` (ex. `FileSink`, `NULL_LOG_SINK`) ou `null`.
   */
  static setLogSink(sink: ILogSink | null): void {
    _setLogSink(sink);
  }

  /** Nom du driver de sink actif (`"stdout"` | `"null"` | `"file"` | custom). */
  static get logSinkName(): string {
    return _sink.name;
  }

  /** `true` si le sink texte écrit (non muté). Coupé = plus de console/fichier .log. */
  static get sinkEnabled(): boolean {
    return !_sinkMuted;
  }

  /**
   * Mute/démute le sink texte **à chaud, sans changer la config ni le driver**
   * (outil dev/diagnostic — ex. couper la console en `npx nodefony dev`). Le nom
   * du sink est préservé ; seul {@link sinkEnabled} bascule. Process-global (un seul
   * sink texte par process). Idempotent.
   *
   * @param enabled - `true` = le sink écrit ; `false` = mute (rien n'est écrit).
   * @returns `true` si l'état a changé.
   */
  static setSinkEnabled(enabled: boolean): boolean {
    const muted = !enabled;
    if (_sinkMuted === muted) return false;
    _sinkMuted = muted;
    return true;
  }

  /**
   * Intercepte `console.log/warn/error/debug/info` → pipe vers le Syslog passé.
   *
   * **Side effect global** : modifie l'objet `console` du process. À utiliser avec parcimonie
   * (un seul appel par process). {@link restoreConsole} restaure les méthodes originales.
   *
   * @param instance - Syslog cible (recevra tous les console.* du process).
   */
  static overrideConsole(instance: Syslog): void {
    if (Syslog._savedConsole !== null) {
      instance.log("Syslog.overrideConsole: already active", "WARNING");
      return;
    }
    Syslog._savedConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
      trace: console.trace.bind(console),
      table: console.table.bind(console),
      dir: console.dir.bind(console),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Console interface requires dynamic assignment
    const con = console as any;
    con.log = (...data: unknown[]) => instance.print(...(data as Pci[]));
    con.info = (...data: unknown[]) =>
      instance.logMultiple("INFO", ...(data as Pci[]));
    con.warn = (...data: unknown[]) =>
      instance.logMultiple("WARNING", ...(data as Pci[]));
    con.error = (...data: unknown[]) =>
      instance.logMultiple("ERROR", ...(data as Pci[]));
    con.debug = (...data: unknown[]) =>
      instance.logMultiple("DEBUG", ...(data as Pci[]));
    con.table = (data: unknown) => instance.logMultiple("INFO", data as Pci);
    con.dir = (obj: unknown) => instance.logMultiple("DEBUG", obj as Pci);
  }

  /**
   * Restaure `console.log/warn/error/debug/info` à leurs valeurs originales.
   * Annule un {@link overrideConsole} précédent.
   */
  static restoreConsole(): void {
    if (Syslog._savedConsole === null) return;
    Object.assign(console, Syslog._savedConsole);
    Syslog._savedConsole = null;
  }
}

export default Syslog;
