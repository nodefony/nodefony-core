import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

/**
 * Le SEUL fichier d'environnement que Nodefony charge : les valeurs du POSTE
 * (secrets de développement compris), jamais commité.
 *
 * C'est la convention Node — dotenv, `node --env-file`, et le `.gitignore` Node
 * officiel de GitHub (`.env`, `.env.*`, `!.env.example`). Sa notice, commitée et
 * jamais chargée, est `.env.example`. La production n'a PAS de fichier : ses
 * secrets viennent de l'orchestrateur ou du gestionnaire de secrets, ses réglages
 * non secrets de `nodefony.config.ts` (fonction `(ctx) => …` par environnement).
 */
export const ENV_FILE = ".env";

/**
 * Options de {@link loadEnv} — où lire, et quels noms de l'ancienne convention
 * signaler.
 */
export interface ILoadEnvOptions {
  /**
   * Mode RUNTIME (`"development"` | `"production"`) = NODE_ENV. Ne sélectionne
   * plus aucun fichier : il sert à NOMMER `.env.<runtimeEnv>` parmi les fichiers
   * de l'ancienne convention que {@link findLegacyEnvFiles} refuse.
   */
  runtimeEnv?: string;
  /**
   * Environnement de DÉPLOIEMENT (string libre : `staging` / `canary`…) =
   * APP_ENV / NF_ENV. Même rôle que `runtimeEnv` : nommer `.env.<appEnv>` parmi
   * les fichiers refusés.
   */
  appEnv?: string;
  /** Racine du projet où chercher les fichiers (défaut `process.cwd()`). */
  cwd?: string;
}

/**
 * Les fichiers chargés, du PLUS prioritaire au MOINS prioritaire.
 *
 * Source UNIQUE de cet ordre : la commande `nodefony env` l'affiche et le
 * générateur s'en sert pour lire l'infra déclarée. Il ne reste qu'un niveau,
 * `.env` ; la fonction demeure pour que personne ne recopie le nom du fichier.
 *
 * @param _opts - accepté pour la compatibilité d'appel ; n'influe plus sur l'ordre.
 * @returns les noms de fichiers, ordonnés ; ne dit pas lesquels existent.
 */
export function envFileOrder(
  _opts: Pick<ILoadEnvOptions, "runtimeEnv" | "appEnv"> = {},
): string[] {
  return [ENV_FILE];
}

/**
 * Les fichiers de l'ANCIENNE convention (Vite / Next.js) présents dans une
 * application : `.env.local`, `.env.<mode>`, `.env.<mode>.local`.
 *
 * Ils ne sont plus lus. Les ignorer en silence serait le pire des cas — une
 * variable posée là disparaîtrait sans un mot, et l'application démarrerait sur
 * un défaut. Le binaire refuse donc le démarrage tant qu'ils existent.
 *
 * Ne regarde QUE dans une application Nodefony (présence de
 * `nodefony.config.ts`) : `nodefony create app` lancé depuis un dossier
 * quelconque ne doit pas buter sur les fichiers d'un autre projet. `.env.example`
 * n'est jamais concerné, ni les fichiers d'autres outils (`.env.vault`,
 * `.env.keys`).
 *
 * @param opts - racine, et les noms de mode/déploiement à reconnaître.
 * @returns les noms trouvés, triés ; vide hors d'une application.
 */
export function findLegacyEnvFiles(opts: ILoadEnvOptions = {}): string[] {
  const { cwd = process.cwd(), runtimeEnv, appEnv } = opts;
  if (!existsSync(resolve(cwd, "nodefony.config.ts"))) return [];
  const modes = new Set(["development", "production", "test"]);
  if (runtimeEnv) modes.add(runtimeEnv);
  if (appEnv) modes.add(appEnv);
  let entries: string[];
  try {
    entries = readdirSync(cwd);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      if (!name.startsWith(".env.")) return false;
      if (name === ".env.local" || name.endsWith(".local")) return true;
      return modes.has(name.slice(".env.".length));
    })
    .sort();
}

/**
 * Le message qui accompagne le refus de {@link findLegacyEnvFiles} : ce qu'il
 * faut faire de chaque fichier, sans avoir à ouvrir la documentation.
 *
 * @param files - les fichiers trouvés.
 * @returns un texte multi-lignes, sans valeur de variable.
 */
export function legacyEnvMessage(files: readonly string[]): string {
  return [
    "Fichiers d'environnement qui ne sont plus lus :",
    ...files.map((f) => `  - ${f}`),
    "",
    "Nodefony ne charge plus que `.env` — vos valeurs de poste, secrets de",
    "développement compris, jamais commité. Sa notice est `.env.example`.",
    "",
    "  → recopiez leurs lignes ACTIVES dans `.env`, puis supprimez-les ;",
    "  → un réglage de production NON secret va dans nodefony.config.ts ;",
    "  → un secret de production vient de l'orchestrateur ou du gestionnaire",
    "    de secrets, jamais d'un fichier.",
  ].join("\n");
}

/**
 * L'environnement EFFECTIF d'un projet, sans toucher à `process.env`.
 *
 * Même lecture et même précédence que {@link loadEnv} — dont c'est le moteur —,
 * mais rendue plutôt qu'injectée. Elle sert à tout ce qui doit LIRE
 * l'environnement d'une application sans être cette application : un diagnostic
 * lancé depuis un poste voit ainsi ce que l'app verra, alors que `process.env`
 * nu ne montre que ce que le terminal a posé.
 *
 * @param base - l'environnement de départ, qui GAGNE sur le fichier.
 * @param opts - la racine où lire.
 * @returns un objet neuf ; ni `base` ni `process.env` ne sont modifiés.
 */
export function resolveEnvCascade(
  base: Record<string, string | undefined>,
  opts: ILoadEnvOptions = {},
): Record<string, string | undefined> {
  const { cwd = process.cwd() } = opts;
  const merged: Record<string, string | undefined> = { ...base };
  for (const file of envFileOrder(opts)) {
    let parsed: Record<string, string>;
    try {
      parsed = parseEnv(readFileSync(resolve(cwd, file), "utf8")) as Record<
        string,
        string
      >;
    } catch {
      continue; // fichier absent / illisible → niveau sauté
    }
    for (const key in parsed) {
      merged[key] ??= parsed[key];
    }
  }
  return merged;
}

/**
 * Charge `.env` dans `process.env`, SANS jamais écraser une variable déjà
 * présente : le shell et l'orchestrateur gagnent toujours.
 *
 * ```
 *   process.env   ← shell / orchestrateur / gestionnaire de secrets (gagne)
 *   > .env        ← valeurs du poste, jamais commité
 * ```
 *
 * Parse natif `node:util.parseEnv` → **zéro dépendance**. Un fichier absent ou
 * illisible est ignoré (il est optionnel : en production il n'existe pas).
 *
 * Appelé une seule fois au démarrage du bin CLI, **AVANT `new CliKernel()`** : les
 * configs de modules lisent `process.env` au boot, l'env doit donc être peuplé en
 * amont. Le refus des fichiers de l'ancienne convention se fait à côté, par
 * {@link findLegacyEnvFiles} : cette fonction reste pure de toute sortie.
 *
 * @param opts - {@link ILoadEnvOptions} (cwd).
 * @returns le nombre de variables effectivement injectées (diagnostic / tests).
 */
export function loadEnv(opts: ILoadEnvOptions = {}): number {
  const resolved = resolveEnvCascade(process.env, opts);
  let injected = 0;
  for (const key in resolved) {
    if (process.env[key] === undefined) {
      process.env[key] = resolved[key];
      injected++;
    }
  }
  return injected;
}
