/**
 * Garde de ligne de commande des scripts de pilotage — lit l'en-tête du script
 * appelant et applique {@link cliGate} : aide sur `--help`, refus (code 64)
 * d'une option que l'en-tête ne déclare pas.
 *
 * Adaptateur seulement (lecture du fichier, sortie du processus) : la règle
 * vit dans `session-lib.mjs`, où ses tests l'éprouvent.
 *
 * @usage    import { guardCli } from "./cli-guard.mjs"; guardCli(import.meta.url);
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cliGate } from "./session-lib.mjs";

/**
 * Applique le garde au script dont l'URL est donnée — rend la main seulement
 * si la ligne de commande est valide et ne demande pas l'aide.
 *
 * @param {string} scriptUrl - `import.meta.url` du script appelant.
 */
export function guardCli(scriptUrl) {
  const gate = cliGate(
    readFileSync(fileURLToPath(scriptUrl), "utf8"),
    process.argv.slice(2),
  );
  if (gate.action === "help") {
    console.log(gate.text);
    process.exit(0);
  }
  if (gate.action === "refuse") {
    console.error(gate.text);
    // 64 = EX_USAGE : la commande est à corriger, rien n'a été fait.
    process.exit(64);
  }
}
