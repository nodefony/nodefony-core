import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

/**
 * Charge les fichiers `.env` du projet dans `process.env`, en cascade et SANS
 * jamais écraser une variable déjà présente.
 *
 * Précédence (du plus fort au plus faible) :
 *
 * ```
 *   process.env       (shell / orchestrateur k8s) ── gagne TOUJOURS
 *   > .env            (gitignoré — secrets locaux)
 *   > .env.local      (gitignoré — overrides machine)
 *   > .env.<env>      (versionné, non-secret — défauts par environment)
 * ```
 *
 * Mécanique : on lit les fichiers du **plus** prioritaire au **moins** prioritaire
 * et on n'assigne QUE les clés encore absentes de `process.env`. Une variable déjà
 * posée — par le shell, l'orchestrateur, ou un fichier plus prioritaire déjà
 * traité — n'est jamais réécrite → la précédence ci-dessus en découle naturellement.
 *
 * Parse natif `node:util.parseEnv` (Node ≥ 21) → **zéro dépendance**. Un fichier
 * absent ou illisible est ignoré silencieusement (tout `.env` est optionnel).
 *
 * Appelé une seule fois au démarrage du bin CLI, **AVANT `new CliKernel()`** : les
 * configs de modules lisent `process.env` au boot (ex. `REDIS_*` dans
 * `defineRedisConfig`), l'env doit donc être peuplé en amont.
 *
 * @param environment - environment détecté (`development` / `production` / …) ;
 *   sélectionne le fichier `.env.<environment>`. Omis → ce niveau est sauté.
 * @param cwd - racine du projet où chercher les fichiers (défaut `process.cwd()`).
 * @returns le nombre de variables effectivement injectées (diagnostic / tests).
 */
export function loadEnv(
  environment?: string,
  cwd: string = process.cwd(),
): number {
  // Du PLUS prioritaire au MOINS prioritaire : le premier fichier qui définit une
  // clé gagne (après le shell, déjà présent dans process.env).
  const files = [".env", ".env.local"];
  if (environment) files.push(`.env.${environment}`);

  let injected = 0;
  for (const file of files) {
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
      if (process.env[key] === undefined) {
        process.env[key] = parsed[key];
        injected++;
      }
    }
  }
  return injected;
}
