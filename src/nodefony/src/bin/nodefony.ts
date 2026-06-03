import { CliKernel, loadEnv } from "nodefony";
import type { EnvironmentType } from "nodefony";
import { exit } from "process";

/**
 * Détecte l'environment EN AMONT de `new CliKernel()` en scannant `process.argv`.
 *
 * Pourquoi : commander parse la sous-commande dans `kernel.start()`, donc sans
 * ce pré-parsing `this.environment` reste `undefined` pendant les ~9 premières
 * lignes du boot (avant `setEnv()`). Plusieurs branches conditionnelles
 * (notamment l'affichage du pid dans les logs) dépendent de cet environment —
 * elles ratent sans pré-détection.
 *
 * Coût : ~10 ns (scan linéaire d'un petit array de strings). Aucun changement
 * de logique commander : la sous-commande continue d'appeler `setEnv()` qui
 * confirme la valeur. Si on rate la détection (commande inconnue ou alias non
 * listé), on retombe sur `undefined` et le comportement legacy.
 */
function detectEnvironmentFromArgv(
  argv: string[],
): EnvironmentType | undefined {
  for (const a of argv) {
    if (a === "development" || a === "dev") return "development";
    if (a === "production" || a === "prod") return "production";
    // `cluster` est un runtime PROD (master + workers). Sans cette détection,
    // l'unique Kernel naissait en `development` (env non résolu au constructeur)
    // alors que les workers tournent en production → env incohérent.
    if (a === "cluster") return "production";
  }
  return undefined;
}

/**
 * Résout le **mode runtime** (dev/prod) AVANT le kernel, façon 12-factor : `NODE_ENV`
 * (ambient, posé par l'orchestrateur cloud) PRIME sur l'intention de la commande
 * (argv). Miroir pur de `Kernel.resolveRuntimeEnv`, mais sans instance (le bin tourne
 * avant `new CliKernel()`) et autorisé à rendre `undefined` (aucun `.env.<env>` chargé
 * si ni NODE_ENV ni commande connue — ex. `nodefony frontend:build` hors contexte env).
 */
function resolveRuntimeEnv(argv: string[]): EnvironmentType | undefined {
  const node = process.env.NODE_ENV;
  if (node === "dev" || node === "development") return "development";
  if (node === "prod" || node === "production") return "production";
  return detectEnvironmentFromArgv(argv);
}

const runtimeEnv = resolveRuntimeEnv(process.argv.slice(2));
// Axe DÉPLOIEMENT (string libre : staging/canary/prod-eu…) — distinct du mode runtime.
const appEnv = process.env.APP_ENV ?? process.env.NODEFONY_ENV;

// Canonise NODE_ENV tôt (idempotent si l'orchestrateur l'a déjà posé) : le mode
// runtime ne vit PLUS dans un `.env` committé (conv B + piège Next : un déploiement
// sans NODE_ENV ne doit pas hériter d'un `development` figé en dur). Les configs de
// modules lues au boot (qui lisent `process.env.NODE_ENV`) le voient ainsi résolu.
if (runtimeEnv) process.env.NODE_ENV = runtimeEnv;

// Peuple process.env depuis les .env du projet AVANT le boot : les configs de
// modules (REDIS_*, etc.) les lisent au moment de la construction du kernel.
loadEnv({ runtimeEnv, appEnv });

const kernel = new CliKernel(runtimeEnv).start().catch((e) => {
  exit(e.code || 1);
});
export default kernel;
