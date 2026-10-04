/**
 * La porte unique où le code constate « suis-je dans un terminal, et de quelle
 * taille ? ».
 *
 * Deux sources, dans cet ordre :
 *
 * 1. **Le verdict du superviseur de développement** ({@link DEV_TERMINAL_ENV}).
 *    Sous `nodefony development`, le serveur écrit dans un TUBE que le
 *    superviseur relaie au vrai terminal (cf ADR-0013 §1) : `isTTY` y vaut
 *    `undefined`, et le serveur se croirait hors terminal — ni couleur, ni
 *    barre, ni largeur. Le superviseur pose donc ce qu'il a CONSTATÉ ; la porte
 *    le lit une fois, le mémoïse, puis le RETIRE de `process.env` : un
 *    petit-enfant (`npm install`, une commande lancée depuis la console
 *    d'administration) n'en hérite pas et ne se croit pas en terminal. Le
 *    verdict ne vaut que pour la SORTIE : `isTerminal(process.stdin)` reste
 *    faux, aucune commande n'attend une saisie qu'elle ne recevra jamais.
 * 2. **Le flux lui-même** (`isTTY`, `columns`, `rows`).
 *
 * `@types/node` déclare `isTTY: boolean` sur `process.stdout`/`stderr`, mais la
 * propriété vaut `undefined` dès que la sortie est redirigée (tube, fichier,
 * intégration continue) : le type ment, et toute garde écrite contre lui passe
 * pour inutile au lint typé. L'élargissement vit donc ici, en UN seul endroit.
 *
 * Isomorphe : `process` est lu par `globalThis`, jamais au chargement du
 * module (le bundle navigateur importe le journal, qui consulte la porte).
 */
import {
  isDevResize,
  isTerminalDimension,
} from "../service/dev/devChannelBase";

/**
 * Variable posée par le superviseur de développement sur le serveur qu'il
 * relaie : le verdict du terminal, en JSON (cf {@link encodeTerminalVerdict}).
 */
export const DEV_TERMINAL_ENV = "NF_DEV_TERMINAL";

/** Ce que le superviseur a constaté du terminal qu'il possède. */
export interface ITerminalVerdict {
  /** Le serveur ne lit jamais le clavier : seul le superviseur le peut. */
  readonly input: false;
  readonly columns: number;
  readonly rows: number;
}

/** Dimensions d'un terminal — `undefined` quand le flux n'en est pas un. */
export interface ITerminalSize {
  readonly columns: number | undefined;
  readonly rows: number | undefined;
}

/** Ce que la porte lit d'un flux. */
interface IStreamLike {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

/** Appelé avec les nouvelles dimensions. */
export type TerminalResizeListener = (size: ITerminalSize) => void;

/**
 * L'état de la porte, PARTAGÉ par toutes les copies du module chargées dans
 * le processus. Le binaire `bin/nodefony` est un bundle qui embarque sa
 * propre copie : un mémo de module y lirait le verdict, le retirerait de
 * l'environnement — et la copie du noyau, lue ensuite, ne trouverait plus
 * rien (vécu : serveur relayé rendu en `plain`). Seul le registre global des
 * symboles réunit deux copies (cf `packageInstances.ts`).
 */
interface ITerminalGateState {
  /** Verdict mémoïsé : `undefined` = pas encore lu, `null` = aucun. */
  verdict: { columns: number; rows: number } | null | undefined;
  /** Écouteurs de redimensionnement sous verdict — alloués au premier. */
  resizeListeners: Set<TerminalResizeListener> | null;
}

/** Case partagée par toutes les copies. */
const STATE_KEY = Symbol.for("nodefony.terminalGate");

/** L'état partagé, créé par la première copie qui le demande. */
function gateState(): ITerminalGateState {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: ITerminalGateState;
  };
  holder[STATE_KEY] ??= { verdict: undefined, resizeListeners: null };
  return holder[STATE_KEY];
}

/** `process`, s'il existe (navigateur : non). */
function currentProcess(): NodeJS.Process | undefined {
  return (globalThis as { process?: NodeJS.Process }).process;
}

/**
 * Encode le verdict que le superviseur transmet au serveur.
 *
 * @param size - dimensions du terminal constatées par le superviseur.
 * @returns la valeur de {@link DEV_TERMINAL_ENV}.
 */
export function encodeTerminalVerdict(size: {
  columns: number;
  rows: number;
}): string {
  const value: ITerminalVerdict = {
    input: false,
    columns: size.columns,
    rows: size.rows,
  };
  return JSON.stringify(value);
}

/**
 * Lit un verdict transmis. Une valeur illisible est IGNORÉE (rendu hors
 * terminal, comme sans verdict) : un terminal annoncé sur une foi douteuse
 * peindrait des séquences dans un fichier de journal.
 *
 * @param raw - la valeur de {@link DEV_TERMINAL_ENV}.
 * @returns le verdict, ou `null`.
 */
export function parseTerminalVerdict(raw: string): ITerminalVerdict | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as { columns?: unknown; rows?: unknown };
  if (!isTerminalDimension(v.columns) || !isTerminalDimension(v.rows)) {
    return null;
  }
  return { input: false, columns: v.columns, rows: v.rows };
}

/**
 * Le verdict de ce processus, lu une seule fois puis retiré de
 * l'environnement ; l'écoute des redimensionnements relayés s'installe avec.
 */
function currentVerdict(): { columns: number; rows: number } | null {
  const state = gateState();
  if (state.verdict !== undefined) return state.verdict;
  const proc = currentProcess();
  const raw = proc?.env[DEV_TERMINAL_ENV];
  state.verdict = null;
  if (raw === undefined || proc === undefined) return null;
  Reflect.deleteProperty(proc.env, DEV_TERMINAL_ENV);
  const parsed = parseTerminalVerdict(raw);
  if (parsed === null) return null;
  const verdict = { columns: parsed.columns, rows: parsed.rows };
  state.verdict = verdict;
  listenToRelayedResize(proc, state);
  return verdict;
}

/**
 * Écoute les redimensionnements que le superviseur relaie par le canal IPC.
 * Le canal est relâché : cette écoute ne garde pas, à elle seule, le
 * processus en vie.
 */
function listenToRelayedResize(
  proc: NodeJS.Process,
  state: ITerminalGateState,
): void {
  if (typeof proc.send !== "function") return;
  proc.on("message", (message: unknown) => {
    const current = state.verdict;
    if (!isDevResize(message) || !current) return;
    current.columns = message.columns;
    current.rows = message.rows;
    if (state.resizeListeners === null) return;
    const size: ITerminalSize = {
      columns: current.columns,
      rows: current.rows,
    };
    for (const listener of state.resizeListeners) listener(size);
  });
  proc.channel?.unref();
}

/** Ce flux est-il une sortie du processus (`stdout` ou `stderr`) ? */
function isProcessOutput(proc: NodeJS.Process | undefined, stream: unknown) {
  return (
    proc !== undefined && (stream === proc.stdout || stream === proc.stderr)
  );
}

/**
 * Dit si un flux est relié à un terminal — ou, sous le superviseur de
 * développement, si la sortie qu'il relaie y aboutit.
 *
 * @param stream - le flux à interroger (`process.stdout`, `process.stderr`…).
 * @returns `true` seulement si le flux est (ou aboutit à) un terminal.
 */
export function isTerminal(stream: IStreamLike | undefined): boolean {
  if (stream === undefined) return false;
  const proc = currentProcess();
  if (currentVerdict() !== null) {
    if (isProcessOutput(proc, stream)) return true;
    if (stream === proc?.stdin) return false;
  }
  return stream.isTTY ?? false;
}

/**
 * Dimensions du terminal où aboutit un flux : le verdict du superviseur (et
 * le dernier redimensionnement relayé) pour les sorties du processus, sinon
 * ce que le flux déclare.
 *
 * @param stream - le flux ; `process.stdout` par défaut.
 * @returns les dimensions, `undefined` hors terminal.
 */
export function terminalSize(stream?: IStreamLike): ITerminalSize {
  const proc = currentProcess();
  const target: IStreamLike | undefined = stream ?? proc?.stdout;
  const current = currentVerdict();
  if (current !== null && isProcessOutput(proc, target)) {
    return { columns: current.columns, rows: current.rows };
  }
  return { columns: target?.columns, rows: target?.rows };
}

/**
 * S'abonne aux redimensionnements du terminal de sortie : ceux que relaie le
 * superviseur sous verdict, sinon l'évènement `resize` de `process.stdout`.
 *
 * @param listener - appelé avec les nouvelles dimensions.
 * @returns la désinscription.
 */
export function onTerminalResize(listener: TerminalResizeListener): () => void {
  const proc = currentProcess();
  if (currentVerdict() !== null) {
    const state = gateState();
    state.resizeListeners ??= new Set();
    state.resizeListeners.add(listener);
    return () => {
      state.resizeListeners?.delete(listener);
    };
  }
  const stdout = proc?.stdout;
  if (stdout === undefined) return () => {};
  const onResize = (): void => listener(terminalSize(stdout));
  stdout.on("resize", onResize);
  return () => {
    stdout.removeListener("resize", onResize);
  };
}
