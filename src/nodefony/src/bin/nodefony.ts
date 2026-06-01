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

const env = detectEnvironmentFromArgv(process.argv.slice(2));

// Peuple process.env depuis les .env du projet AVANT le boot : les configs de
// modules (REDIS_*, etc.) les lisent au moment de la construction du kernel.
loadEnv(env);

const kernel = new CliKernel(env).start().catch((e) => {
  exit(e.code || 1);
});
export default kernel;
