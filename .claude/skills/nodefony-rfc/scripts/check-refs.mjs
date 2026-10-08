#!/usr/bin/env node
/**
 * Joue les deux contrôles de fraîcheur du corpus des normes et rend UN verdict.
 *
 * Le problème qu'il ferme : `check-amont.mjs` (specs vivantes, par SHA) et
 * `check-rfc-status.mjs` (RFC rendues obsolètes) répondent à deux questions
 * distinctes, et une seule commande ne posait que la première. Les enchaîner
 * par `&&` tairait le second dès que le premier signale une dérive, et `;`
 * n'existe pas sous `cmd.exe` : d'où ce lanceur, qui les joue TOUS LES DEUX.
 *
 * Codes de sortie : ceux des deux scripts, le plus grave l'emporte — un code
 * inattendu (plantage) avant `78` (impossible de savoir), avant `3` (dépassé ou
 * dérivé), avant `0`. Un réseau muet ne se lit jamais comme « à jour ».
 *
 * @module
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKS = ["check-amont.mjs", "check-rfc-status.mjs"];

/** Rang de gravité d'un code de sortie : plus il est haut, plus il l'emporte. */
function severity(code) {
  if (code === 0) return 0;
  if (code === 3) return 1;
  if (code === 78) return 2;
  return 3;
}

let worst = 0;
for (const script of CHECKS) {
  console.log(`\n── ${script}`);
  const { status, error } = spawnSync(
    process.execPath,
    [path.join(HERE, script)],
    { stdio: "inherit" },
  );
  if (error) console.error(`✗  ${script} — ${error.message}`);
  const code = status ?? 1;
  if (severity(code) > severity(worst)) worst = code;
}
process.exit(worst);
