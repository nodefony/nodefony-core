import { styleText } from "node:util";

/**
 * Façade couleur ANSI **chainable** et **isomorphe** — remplace la dépendance
 * `cli-color` (retirée) en s'appuyant sur `util.styleText` natif (Node 22.13+).
 *
 * - **Node** : `clc.red("x")`, `clc.cyan.bgBlue("x")`, `clc.blueBright.bold("x")`
 *   rendent via `util.styleText` (les styles s'accumulent par accès de propriété,
 *   appliqués au moment de l'appel). `validateStream: false` → on émet toujours
 *   les codes ; le gate TTY/`NO_COLOR` est géré en amont (cf {@link setLogColor}
 *   dans `syslog/logColor.ts`), comme le faisait `cli-color`.
 * - **Navigateur** : `node:util` est aliasé vers le shim (`client/shim/util.ts`)
 *   dont le `styleText` est l'identité → jamais d'ANSI (parité ancien shim
 *   `cli-color` identity Proxy).
 *
 * `clc.reset` est la **chaîne brute** `\x1b[0m` (et non une fonction), pour la
 * parité avec `cli-color` (ex. `process.stdout.write(clc.reset)`).
 */

/** Noms de style reconnus (sous-ensemble `util.styleText` utilisé par Nodefony). */
type StyleName =
  | "reset"
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "inverse"
  | "strikethrough"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "blackBright"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright"
  | "bgBlack"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta"
  | "bgCyan"
  | "bgWhite"
  | "bgGray";

const VALID = new Set<string>([
  "reset",
  "bold",
  "dim",
  "italic",
  "underline",
  "inverse",
  "strikethrough",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
  "bgBlack",
  "bgRed",
  "bgGreen",
  "bgYellow",
  "bgBlue",
  "bgMagenta",
  "bgCyan",
  "bgWhite",
  "bgGray",
]);

/** Séquence ANSI de remise à zéro — exposée brute par `clc.reset` (parité cli-color). */
const RESET = "\x1b[0m";

/**
 * Fonction de coloration chainable : appelable (`fn(text)`) et indexable
 * (`fn.bold`, `fn.bgBlue`…), chaque accès renvoyant une nouvelle `ColorFn` aux
 * styles accumulés.
 */
export type ColorFn = ((s: string | number) => string) & {
  [K in StyleName]: ColorFn;
};

/** Racine `clc` : une {@link ColorFn} + la constante brute `reset`. */
export type Clc = ColorFn & { readonly reset: string };

/**
 * Construit une `ColorFn` figée pour la liste de styles donnée. Le Proxy ne
 * piège QUE l'accès de propriété (chaînage) — l'appel forward directement vers
 * la fonction cible (aucun surcoût de trap à l'invocation, hot path préservé).
 */
function make(styles: readonly string[]): ColorFn {
  const apply = (s: string | number): string => {
    const str = String(s);
    if (styles.length === 0) return str;
    try {
      return styleText(styles as Parameters<typeof styleText>[0], str, {
        validateStream: false,
      });
    } catch {
      return str;
    }
  };
  return new Proxy(apply, {
    get(target, prop, receiver) {
      if (prop === "reset") return RESET;
      if (typeof prop === "string" && VALID.has(prop)) {
        return make([...styles, prop]);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ColorFn;
}

const clc = make([]) as Clc;

export default clc;
