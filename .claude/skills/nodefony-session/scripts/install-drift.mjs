/**
 * L'installation (`node_modules`) correspond-elle au verrou (`package-lock.json`) de la branche courante ?
 *
 * POURQUOI LE CONTENU, PAS LA DATE
 *
 * Travailler par branches fait changer de verrou sans rien réinstaller : passer de
 * la branche d'un ticket qui monte des dépendances à une branche partie de
 * `release/*` laisse un `node_modules` qui ne correspond plus à rien. L'ancienne
 * garde comparait des DATES (verrou plus récent que l'installation) et se
 * trompait dans les deux sens : `git switch` réécrit le verrou, donc revenir sur
 * la branche qui a FAIT l'installation la faisait sonner à tort, et une branche
 * au verrou plus ancien passait en silence. Vécu au passage #802 → #796 :
 * 140 écarts, aucun signalé.
 *
 * npm tient lui-même l'état installé dans `node_modules/.package-lock.json`, au
 * même format que le verrou : la comparaison porte sur ce que npm a posé, pas sur
 * ce que l'on croit.
 *
 * SEULE implémentation de la règle — la reprise de session et `ticket-start.mjs`
 * l'appellent, aucun ne la recopie.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Les écarts entre le verrou voulu et l'installation constatée — PUR.
 *
 * Un paquet `optional` absent n'est pas un écart : ce sont les binaires des
 * AUTRES plateformes (`@rollup/rollup-linux-x64-gnu` sur un Mac), que npm
 * n'installe jamais ici.
 *
 * @param {{ packages?: Record<string, { version?: string, optional?: boolean }> }} lock - `package-lock.json`
 * @param {{ packages?: Record<string, { version?: string }> }} installed - `node_modules/.package-lock.json`
 * @returns {string[]} un libellé par écart (`chemin a → b`, `chemin absent`, `chemin en trop`)
 */
export function installDrift(lock, installed) {
  const want = lock?.packages ?? {};
  const have = installed?.packages ?? {};
  const drift = [];
  for (const [key, wanted] of Object.entries(want)) {
    if (key === "") continue; // la racine du dépôt, absente du verrou caché par construction
    const got = have[key];
    if (got === undefined) {
      if (!wanted.optional) drift.push(`${key} absent`);
      continue;
    }
    if (wanted.version !== got.version)
      drift.push(`${key} ${got.version} → ${wanted.version}`);
  }
  for (const key of Object.keys(have)) {
    if (!(key in want)) drift.push(`${key} en trop`);
  }
  return drift;
}

/**
 * Lit le verrou et l'installation d'un dépôt et rend leurs écarts.
 *
 * @param {string} root - racine du dépôt
 * @returns {string[] | null} les écarts, ou `null` s'il n'y a rien à comparer (aucune installation)
 */
export function readInstallDrift(root) {
  const lockFile = path.join(root, "package-lock.json");
  const installedFile = path.join(root, "node_modules", ".package-lock.json");
  if (!fs.existsSync(lockFile) || !fs.existsSync(installedFile)) return null;
  return installDrift(
    JSON.parse(fs.readFileSync(lockFile, "utf8")),
    JSON.parse(fs.readFileSync(installedFile, "utf8")),
  );
}
