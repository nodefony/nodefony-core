import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

/**
 * Options de {@link loadEnv} — les deux axes d'environnement Nodefony (12-factor).
 */
export interface ILoadEnvOptions {
  /**
   * Mode RUNTIME (`"development"` | `"production"`) = NODE_ENV. Sélectionne
   * `.env.<runtimeEnv>` (+ `.env.<runtimeEnv>.local`). Omis → ces niveaux sont sautés.
   */
  runtimeEnv?: string;
  /**
   * Environnement de DÉPLOIEMENT (string libre : `staging` / `canary` / `prod-eu`…) =
   * APP_ENV / NF_ENV. Sélectionne `.env.<appEnv>` (+ `.env.<appEnv>.local`),
   * PLUS prioritaire que le mode runtime (plus spécifique). Omis ou égal à
   * `runtimeEnv` → ces niveaux sont sautés (pas de doublon).
   */
  appEnv?: string;
  /** Racine du projet où chercher les fichiers (défaut `process.cwd()`). */
  cwd?: string;
}

/**
 * Charge les fichiers `.env` du projet dans `process.env`, en cascade et SANS
 * jamais écraser une variable déjà présente.
 *
 * **Convention B (Vite / Next.js)** — règle : les fichiers `*.local` (gitignorés,
 * secrets/machine) priment TOUJOURS sur les committés ; à rang égal, le plus
 * spécifique gagne. Nodefony ajoute un 2ᵉ axe : `appEnv` (déploiement) est plus
 * spécifique que `runtimeEnv` (mode). Précédence, du PLUS fort au PLUS faible :
 *
 * ```
 *   process.env              ← shell / orchestrateur k8s (gagne TOUJOURS)
 *   > .env.<appEnv>.local     ┐ gitignorés (*.local)       ┐ si appEnv défini
 *   > .env.<runtimeEnv>.local │                            │ & ≠ runtimeEnv
 *   > .env.local              ┘                            │
 *   > .env.<appEnv>           ┐ committés (non-secrets)    ┘
 *   > .env.<runtimeEnv>       │
 *   > .env                    ┘ défauts communs (le + faible)
 * ```
 *
 * Mécanique : on lit du **plus** prioritaire au **moins** prioritaire et on
 * n'assigne QUE les clés encore absentes de `process.env`. Une variable déjà
 * posée — shell, orchestrateur, ou fichier plus prioritaire déjà traité — n'est
 * jamais réécrite → la précédence ci-dessus en découle naturellement.
 *
 * Parse natif `node:util.parseEnv` (Node ≥ 21) → **zéro dépendance**. Un fichier
 * absent ou illisible est ignoré silencieusement (tout `.env` est optionnel).
 *
 * Appelé une seule fois au démarrage du bin CLI, **AVANT `new CliKernel()`** : les
 * configs de modules lisent `process.env` au boot (ex. `REDIS_*` dans
 * `defineRedisConfig`), l'env doit donc être peuplé en amont.
 *
 * @param opts - {@link ILoadEnvOptions} (runtimeEnv / appEnv / cwd).
 * @returns le nombre de variables effectivement injectées (diagnostic / tests).
 */

/**
 * Les fichiers de la cascade, du PLUS prioritaire au MOINS prioritaire.
 *
 * Extrait de {@link loadEnv} pour être la source UNIQUE de cet ordre : la
 * commande `nodefony env` l'affiche, et un ordre affiché qui différerait de
 * l'ordre appliqué serait pire que pas d'affichage du tout — c'est exactement ce
 * qu'un utilisateur croirait sur parole en cherchant pourquoi sa variable est
 * ignorée.
 *
 * @param opts - `runtimeEnv` (mode) et `appEnv` (déploiement).
 * @returns les noms de fichiers, ordonnés ; ne dit pas lesquels existent.
 */
export function envFileOrder(
  opts: Pick<ILoadEnvOptions, "runtimeEnv" | "appEnv"> = {},
): string[] {
  const { runtimeEnv, appEnv } = opts;
  // `appEnv` n'est un niveau distinct que s'il diffère du mode runtime.
  const deployEnv = appEnv && appEnv !== runtimeEnv ? appEnv : undefined;
  const files: string[] = [];
  if (deployEnv) files.push(`.env.${deployEnv}.local`);
  if (runtimeEnv) files.push(`.env.${runtimeEnv}.local`);
  files.push(".env.local");
  if (deployEnv) files.push(`.env.${deployEnv}`);
  if (runtimeEnv) files.push(`.env.${runtimeEnv}`);
  files.push(".env");
  return files;
}

/**
 * L'environnement EFFECTIF d'un projet, sans toucher à `process.env`.
 *
 * Même cascade et même précédence que {@link loadEnv} — dont c'est désormais le
 * moteur —, mais rendue plutôt qu'injectée. Elle sert à tout ce qui doit LIRE
 * l'environnement d'une application sans être cette application : un diagnostic
 * lancé depuis un poste voit ainsi ce que l'app verra, alors que `process.env`
 * nu ne montre que ce que le terminal a posé.
 *
 * 🔴 C'est exactement le trou que `doctor` portait : le dialecte du connecteur
 * était déduit de `process.env` seul, donc une application dont l'URL vit dans
 * `.env.local` — le chemin que le gabarit PRESCRIT — voyait chacune de ses
 * entités accusée d'être écrite pour le mauvais moteur.
 *
 * @param base - l'environnement de départ, qui GAGNE sur les fichiers.
 * @param opts - la cascade à lire (racine, mode runtime, environnement de déploiement).
 * @returns un objet neuf ; ni `base` ni `process.env` ne sont modifiés.
 */
export function resolveEnvCascade(
  base: Record<string, string | undefined>,
  opts: ILoadEnvOptions = {},
): Record<string, string | undefined> {
  const { cwd = process.cwd() } = opts;
  const merged: Record<string, string | undefined> = { ...base };
  // Du PLUS prioritaire au MOINS prioritaire : le premier niveau qui définit
  // une clé gagne (après `base`, qui vient du shell).
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
      if (merged[key] === undefined) merged[key] = parsed[key];
    }
  }
  return merged;
}

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
