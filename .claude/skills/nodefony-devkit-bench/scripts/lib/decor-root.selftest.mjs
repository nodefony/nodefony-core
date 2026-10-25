/**
 * Auto-contrôle de l'EMPLACEMENT du décor partagé par les deux bancs.
 *
 * Le défaut qu'il ferme : `verify-generated` et `verify-runtime` écrivaient
 * chacun le chemin du décor ; le premier l'a déplacé, le second a continué de
 * lire l'ancien — et rendait un verdict vert sur une AUTRE application que
 * celle qu'on venait de générer. Ce contrôle exige que les deux bancs passent
 * par `decorRoot`, et qu'aucun ne réécrive le nom du dossier en dur.
 *
 * Usage : `node lib/decor-root.selftest.mjs`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decorRoot } from "./decor-root.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const BANCS = ["verify-generated.mjs", "verify-runtime.mjs"];
let verts = 0;
const rouges = [];
const regle = (nom, ok, detail = "") => {
  if (ok) verts += 1;
  else rouges.push(`${nom}${detail ? ` — ${detail}` : ""}`);
};

const tmp = path.join(path.sep, "t");
regle(
  "lié et isolé ne partagent pas de dossier",
  decorRoot({ linked: true, tmp }) !== decorRoot({ linked: false, tmp }),
);
regle(
  "sqlite garde le nom nu, un autre moteur le suffixe",
  decorRoot({ linked: false, tmp }) ===
    path.join(tmp, "nodefony-devkit-verify") &&
    decorRoot({ linked: true, database: "postgres", tmp }) ===
      path.join(tmp, "nodefony-devkit-verify-link-postgres"),
);
for (const banc of BANCS) {
  const source = readFileSync(path.join(ICI, "..", banc), "utf8");
  regle(
    `${banc} calcule son décor par decorRoot`,
    /const ROOT = decorRoot\(/u.test(source),
  );
  regle(
    `${banc} n'écrit pas le nom du dossier en dur`,
    // Les deux noms de dossier qu'a portés le décor ; pas `nf-devkit-verify-*`,
    // qui nomme des conteneurs.
    !/["'`](nodefony-devkit-verify[^"'`]*|devkit-verify)["'`]/u.test(source),
  );
}

for (const r of rouges) process.stdout.write(`  ❌ ${r}\n`);
process.stdout.write(
  `decor-root : ${verts} règle(s) tenue(s), ${rouges.length} écart(s)\n`,
);
process.exit(rouges.length === 0 ? 0 : 1);
