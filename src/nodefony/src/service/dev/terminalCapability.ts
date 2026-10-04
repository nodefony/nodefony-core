/**
 * Le verdict sur le terminal : ce que le superviseur a CONSTATÉ, et qu'il
 * transmet au serveur par `NF_DEV_TERMINAL`. Cf ADR-0013 §1 et §3.
 *
 * Une capacité se constate, elle ne se déduit pas de `process.platform` :
 * le plein écran n'est accordé que si le terminal a RÉPONDU à la requête de
 * position du curseur, la sortie synchronisée que si DECRQM a vu le mode
 * 2026. Tout est pur ici — la sonde elle-même (écrire, attendre, lire) est
 * l'affaire de qui possède le terminal.
 */
import type { InputEvent } from "./inputDecoder";
import type { ScreenCharset } from "./startupScreen";

/** Variable d'environnement qui porte le verdict du superviseur au serveur. */
export const DEV_TERMINAL_ENV = "NF_DEV_TERMINAL";

/** Profondeur de couleur, en bits (cf `tty.WriteStream.getColorDepth`). */
export type ColorDepth = 1 | 4 | 8 | 24;

/** Ce que le superviseur sait du terminal. */
export interface ITerminalVerdict {
  readonly columns: number;
  readonly rows: number;
  readonly colorDepth: ColorDepth;
  /** Jeu de caractères de l'écran (règle du logo, `cli/brand.ts`). */
  readonly charset: ScreenCharset;
  /** `false` pour le serveur : il ne lit jamais le clavier. */
  readonly input: boolean;
  /** Le terminal a répondu à la requête de position du curseur. */
  readonly fullscreen: boolean;
  /** DECRQM a vu le mode 2026 (sortie synchronisée). */
  readonly synchronized: boolean;
}

/** Mode de la sortie synchronisée. */
const SYNCHRONIZED_OUTPUT_MODE = 2026;

/**
 * La sonde, à écrire sur le terminal en mode brut : DECRQM du mode 2026
 * d'abord, puis la requête de position du curseur. La réponse de position
 * arrive en DERNIER chez tous les terminaux qui répondent : elle sert de
 * sentinelle — reçue, la sonde est finie, que DECRQM ait répondu ou non.
 */
export const TERMINAL_PROBE = `\x1b[?${SYNCHRONIZED_OUTPUT_MODE}$p\x1b[6n`;

/** Ce que la sonde a établi. */
export interface IProbeResult {
  /** Une réponse de position du curseur est arrivée : plein écran utilisable. */
  fullscreen: boolean;
  /** DECRQM a reconnu le mode 2026. */
  synchronized: boolean;
  /** La sentinelle (position du curseur) est arrivée : plus rien à attendre. */
  complete: boolean;
}

/**
 * Interprète les évènements reçus pendant la sonde. Les autres évènements
 * (une frappe pendant l'attente) sont ignorés ici — à l'appelant de les
 * rejouer s'il le veut.
 *
 * @param events - ce que le décodeur d'entrée a rendu depuis l'envoi de la sonde.
 * @returns le constat.
 */
export function interpretProbe(events: readonly InputEvent[]): IProbeResult {
  const result: IProbeResult = {
    fullscreen: false,
    synchronized: false,
    complete: false,
  };
  for (const event of events) {
    if (event.kind !== "report") continue;
    if (event.report === "cursor-position") {
      result.fullscreen = true;
      result.complete = true;
    } else if (event.values[0] === SYNCHRONIZED_OUTPUT_MODE) {
      // DECRPM : 1 actif, 2 inactif, 3 actif en permanence — 0 et 4 = non pris en charge.
      const state = event.values[1] ?? 0;
      result.synchronized = state === 1 || state === 2 || state === 3;
    }
  }
  return result;
}

/**
 * Sérialise un verdict pour {@link DEV_TERMINAL_ENV}.
 *
 * @param verdict - le verdict.
 * @returns une chaîne JSON compacte.
 */
export function serializeTerminalVerdict(verdict: ITerminalVerdict): string {
  return JSON.stringify({
    columns: verdict.columns,
    rows: verdict.rows,
    colorDepth: verdict.colorDepth,
    charset: verdict.charset,
    input: verdict.input,
    fullscreen: verdict.fullscreen,
    synchronized: verdict.synchronized,
  });
}

/**
 * Entier strictement positif et borné, ou `null`.
 *
 * @param value - la valeur lue.
 * @returns l'entier, ou `null` s'il est invalide.
 */
function dimension(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 10_000
    ? value
    : null;
}

/**
 * Relit un verdict depuis un environnement DONNÉ — pur : aucun accès à
 * `process.env`. Toute valeur absente, illisible ou hors domaine rend
 * `null` en entier : un verdict à moitié faux ne vaut pas mieux que pas de
 * verdict, et l'appelant retombe alors sur ce qu'il constate lui-même.
 *
 * @param env - l'environnement à lire.
 * @returns le verdict, ou `null`.
 */
export function readTerminalVerdict(
  env: Readonly<Record<string, string | undefined>>,
): ITerminalVerdict | null {
  const raw = env[DEV_TERMINAL_ENV];
  if (raw === undefined || raw === "" || raw.length > 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  const columns = dimension(v.columns);
  const rows = dimension(v.rows);
  const colorDepth = v.colorDepth;
  if (columns === null || rows === null) return null;
  if (
    colorDepth !== 1 &&
    colorDepth !== 4 &&
    colorDepth !== 8 &&
    colorDepth !== 24
  ) {
    return null;
  }
  if (v.charset !== "unicode" && v.charset !== "ascii") return null;
  if (
    typeof v.input !== "boolean" ||
    typeof v.fullscreen !== "boolean" ||
    typeof v.synchronized !== "boolean"
  ) {
    return null;
  }
  return {
    columns,
    rows,
    colorDepth,
    charset: v.charset,
    input: v.input,
    fullscreen: v.fullscreen,
    synchronized: v.synchronized,
  };
}
