/**
 * Auto-contrôle de `lockstepSiblings` — les frères de train d'une pair épinglée.
 *
 * Le défaut qu'il garde : le gate des fronts épinglait `@angular/core` sur le
 * dépôt (22.2.2) et laissait `@angular/common`, `@angular/compiler-cli` monter
 * au dernier patch du registre (22.2.3). La famille exige des versions
 * identiques : `ERESOLVE`, gate rouge sur les deux jobs Linux, sans un mot du
 * code généré.
 *
 * Décor jetable sous le dossier temporaire du système, supprimé en sortie.
 *
 * Usage : `node lib/isolation.selftest.mjs`
 * Sorties : `0` vert · `1` un écart.
 *
 * @module
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lockstepSiblings } from "./isolation.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "nf-lockstep-"));
const repo = path.join(root, "repo");
const app = path.join(root, "app");

const installe = (name, version) => {
  const dir = path.join(repo, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version }),
  );
};

let ecarts = 0;
const verifier = (ce, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? "✓" : "✗"} ${ce}`);
  if (!ok) {
    console.log(`    attendu ${JSON.stringify(attendu)}`);
    console.log(`    obtenu  ${JSON.stringify(obtenu)}`);
    ecarts++;
  }
};

try {
  installe("@angular/core", "22.2.2");
  installe("@angular/common", "22.2.2");
  installe("@angular/compiler-cli", "22.2.2");
  installe("@angular/build", "22.2.1"); // sa propre ligne de versions
  installe("@other/core", "22.2.2"); // autre scope, même version : coïncidence
  installe("rxjs", "22.2.2"); // sans scope : jamais un frère
  mkdirSync(app, { recursive: true });
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({
      dependencies: {
        "@angular/core": "~22.2.2",
        "@angular/common": "~22.2.2",
        "@other/core": "^22.0.0",
        rxjs: "^22.0.0",
      },
      devDependencies: {
        "@angular/compiler-cli": "~22.2.2",
        "@angular/build": "~22.2.1",
        "@angular/animations": "~22.2.2", // absent du dépôt : laissé libre
      },
    }),
  );

  verifier(
    "les frères du scope à la même version suivent la pair",
    lockstepSiblings(repo, app, { "@angular/core": "22.2.2" }),
    { "@angular/common": "22.2.2", "@angular/compiler-cli": "22.2.2" },
  );
  verifier(
    "une pair hors scope n'entraîne personne",
    lockstepSiblings(repo, app, { rxjs: "22.2.2" }),
    {},
  );
  verifier(
    "une pair déjà épinglée n'est pas redite",
    lockstepSiblings(repo, app, {
      "@angular/core": "22.2.2",
      "@angular/common": "22.2.2",
    }),
    { "@angular/compiler-cli": "22.2.2" },
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.exit(ecarts === 0 ? 0 : 1);
