#!/usr/bin/env node
/**
 * Auto-contrôle de la règle « un `.cmd` Windows exige un shell ».
 *
 * Il tourne partout, y compris là où Windows n'existe pas : la plateforme et la
 * grammaire de chemins sont des ARGUMENTS. C'est le seul moyen d'éprouver les
 * deux branches sans machine Windows — et le défaut qu'elles corrigent n'a été
 * vu que sur un runner, après être passé sous le nez de trois systèmes.
 *
 * `--prove` ampute la règle et exige que les cas tombent : une sonde qui reste
 * verte débranchée n'éprouve rien.
 *
 * Usage :
 *   node lib/exec-portable.selftest.mjs
 *   node lib/exec-portable.selftest.mjs --prove
 */
import path from "node:path";
import { besoinDeShell } from "./exec-portable.mjs";

const PROVE = process.argv.includes("--prove");

/** La règle AMPUTÉE — ce qu'on écrivait avant, et qui rendait `ENOENT` sous Windows. */
const debranchee = () => false;

const regle = PROVE ? debranchee : besoinDeShell;

const cas = [
  {
    quoi: "`npm` sous Windows → shell (c'est un `.cmd`)",
    calcul: () => regle("npm", "win32", path.win32),
    attendu: true,
  },
  {
    quoi: "`npx` sous Windows → shell",
    calcul: () => regle("npx", "win32", path.win32),
    attendu: true,
  },
  {
    quoi: "un chemin ABSOLU sous Windows → pas de shell (vrai exécutable)",
    calcul: () =>
      regle("C:\\Program Files\\nodejs\\node.exe", "win32", path.win32),
    attendu: false,
  },
  {
    quoi: "`npm` sous linux → pas de shell",
    calcul: () => regle("npm", "linux", path.posix),
    attendu: false,
  },
  {
    quoi: "`npm` sous macOS → pas de shell",
    calcul: () => regle("npm", "darwin", path.posix),
    attendu: false,
  },
  {
    quoi: "un chemin absolu POSIX → pas de shell",
    calcul: () => regle("/usr/local/bin/node", "darwin", path.posix),
    attendu: false,
  },
];

let verts = 0;
let rouges = 0;
for (const c of cas) {
  const obtenu = c.calcul();
  const ok = obtenu === c.attendu;
  if (ok) verts += 1;
  else rouges += 1;
  process.stdout.write(`  ${ok ? "✅" : "❌"} ${c.quoi}\n`);
}

if (PROVE) {
  // Débranchée, la règle rend toujours `false` : les DEUX cas Windows doivent
  // tomber. S'ils passent quand même, c'est qu'aucun échantillon n'exerce la
  // branche Windows — et l'auto-contrôle ne garde rien.
  const attendus = 2;
  if (rouges < attendus) {
    process.stdout.write(
      `\n❌ règle débranchée : ${rouges} cas tombé(s), ${attendus} attendus — ` +
        `la branche Windows n'est pas exercée par les échantillons\n`,
    );
    process.exit(2);
  }
  process.stdout.write(
    `\n✅ débranchée, la règle fait tomber ${rouges} cas — elle mord bien\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `\n━━ ${verts}/${cas.length} : la règle du shell Windows\n`,
);
process.exit(rouges === 0 ? 0 : 1);
