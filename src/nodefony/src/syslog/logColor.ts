import clc from "../colors";

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

/**
 * Applique les conventions d'environnement couleur PAR-DESSUS un signal `isTTY`
 * **déjà résolu** — au boot on passe `Kernel.isTTY` (qui honore déjà `NF_NO_TTY`),
 * sans re-lire `process.stdout`. Conventions :
 *
 * - **`NO_COLOR`** (no-color.org) : présent **et non vide** → couleur OFF, quelle
 *   que soit sa valeur. Priorité absolue (refus explicite de l'utilisateur).
 * - **`FORCE_COLOR`** : non vide et ≠ `"0"` → couleur ON (override pipe/non-TTY,
 *   ex. CI qui veut des logs colorés capturés).
 * - sinon → couleur = `isTTY`.
 *
 * Isomorphe : `env` lu via `globalThis.process` (navigateur : pas de `process`).
 *
 * @param isTTY - signal TTY déjà résolu (ex. `Kernel.isTTY`, NF_NO_TTY-aware).
 */
export function resolveColorEnabled(isTTY: boolean): boolean {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {};
  if (typeof env.NO_COLOR === "string" && env.NO_COLOR !== "") return false;
  if (
    typeof env.FORCE_COLOR === "string" &&
    env.FORCE_COLOR !== "" &&
    env.FORCE_COLOR !== "0"
  )
    return true;
  return isTTY;
}

// Défaut à l'IMPORT (le kernel n'existe pas encore → on lit process une fois, en
// honorant NF_NO_TTY comme le fait Kernel.isTTY). Re-confirmé au boot par
// Kernel.initializeLog avec `this.isTTY` (cf resolveColorEnabled).
const _importProc = (
  globalThis as {
    process?: {
      stdout?: { isTTY?: boolean };
      env?: Record<string, string | undefined>;
    };
  }
).process;
const _importIsTTY = _importProc?.env?.NF_NO_TTY
  ? false
  : _importProc?.stdout?.isTTY === true;
setLogColor(resolveColorEnabled(_importIsTTY));
