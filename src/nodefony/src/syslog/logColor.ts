import clc from "cli-color";

/**
 * Gate de couleur ANSI des logs — résolue **une seule fois au boot**
 * ({@link Kernel.initializeLog}), pas par log.
 *
 * Problème résolu : plusieurs loggers (Kernel, Context, request-logger…) bakent
 * des codes ANSI DANS le `payload`/`msgid` d'un `Pdu` (ex. `clc.cyan("URL")`).
 * Ces Pdu voyagent jusqu'au `FileTransport` JSON → l'ANSI polluait le `.jsonl`
 * queryable (et le pipe stdout → collecteur en prod). Stripper à l'écriture =
 * un `.replace()` PAR log sur le hot path (refusé, coût). À la place, un flag
 * global gate la couleur à la SOURCE.
 *
 * Critère (résolu au boot) : couleur ON si `stdout` est un **TTY** (un humain
 * regarde un terminal) ; OFF si pipe/fichier/redirection (prod, collecteur,
 * conteneur) → payloads bruts → JSONL et stdout propres.
 *
 * Perf : les slots ci-dessous sont MUTÉS une fois (`setLogColor`) — le hot path
 * appelle directement `identity` (OFF) ou la fonction `cli-color` (ON), **sans
 * test booléen par log**. Reproduire `clc.x.y` ici garde le chaînage hors du
 * hot path (une fonction figée, pas une chaîne de getters par appel).
 *
 * Isomorphe : au navigateur, `cli-color` est remplacé par le shim identité
 * (alias rollup) → ON ≡ OFF, jamais d'ANSI quoi qu'il arrive.
 */

// Accepte aussi `number` : certains loggers colorent un statusCode/close code
// brut (ex. `logColor.magenta(statusCode)`), comme le faisait `cli-color`.
type ColorFn = (s: string | number) => string;

/** Combinaisons `cli-color` réellement utilisées par les loggers Nodefony. */
const KEYS = [
  "cyan",
  "magenta",
  "red",
  "green",
  "yellow",
  "blue",
  "blackBright",
  "yellowBold",
  "redBold",
  "cyanBold",
  "blueBrightBold",
  "cyanBgBlue",
  "cyanBgBlack",
] as const;

type ColorKey = (typeof KEYS)[number];
type ColorMap = Record<ColorKey, ColorFn>;

// OFF = zéro coût : retourne l'entrée telle quelle (un number sera coercé par
// le template literal côté appelant, exactement comme `cli-color` l'aurait fait).
const identity: ColorFn = (s) => s as string;

/** Implémentation colorée (TTY) — résolue 1× à l'import (chaînage figé). */
const COLORS: ColorMap = {
  cyan: clc.cyan,
  magenta: clc.magenta,
  red: clc.red,
  green: clc.green,
  yellow: clc.yellow,
  blue: clc.blue,
  blackBright: clc.blackBright,
  yellowBold: clc.yellow.bold,
  redBold: clc.red.bold,
  cyanBold: clc.cyan.bold,
  blueBrightBold: clc.blueBright.bold,
  cyanBgBlue: clc.cyan.bgBlue,
  cyanBgBlack: clc.cyan.bgBlack,
};

/**
 * Helper de couleur partagé — référence STABLE, propriétés mutées par
 * {@link setLogColor}. Les call-sites font `logColor.cyan("URL")`.
 */
export const logColor: ColorMap = { ...COLORS };

let _enabled = false;

/**
 * Active/désactive la couleur ANSI des logs — à appeler **une fois au boot**.
 * Swap les fonctions des slots ; aucun coût par log ensuite.
 *
 * @param enabled - `true` = couleur (TTY interactif), `false` = brut (pipe/fichier).
 */
export function setLogColor(enabled: boolean): void {
  _enabled = enabled;
  for (const k of KEYS) logColor[k] = enabled ? COLORS[k] : identity;
}

/** `true` si la couleur ANSI est active (gate boot-time). */
export function isLogColorEnabled(): boolean {
  return _enabled;
}

// Défaut au chargement : couleur si stdout est un TTY. Lu via `globalThis` pour
// rester isomorphe (navigateur : pas de `process` → OFF). Re-confirmé au boot
// par Kernel.initializeLog (et override programmatique possible via setLogColor).
const _proc = (globalThis as { process?: { stdout?: { isTTY?: boolean } } })
  .process;
setLogColor(_proc?.stdout?.isTTY === true);
