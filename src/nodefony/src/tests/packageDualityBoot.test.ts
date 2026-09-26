import { describe, it } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toImportSpecifier } from "../kernel/resolveModuleEntry";

/**
 * SPEC e2e — « le refus de dualité est réellement CÂBLÉ dans le boot ».
 *
 * 🔴 CE QUE CE FICHIER GARDE, et pourquoi il a fallu l'écrire. Les tests de
 * `packageInstances.test.ts` appellent la garde par ses méthodes ; celui-ci
 * lance le VRAI binaire sur une VRAIE application. Sans lui, retirer l'appel
 * dans `Kernel.loadApp` laissait toute la suite verte — un gate débranchable
 * sans qu'un test tombe ne garde rien.
 *
 * La seconde copie est SIMULÉE : l'application pousse une entrée dans le
 * registre global avant d'exporter son module. Charger deux copies physiques
 * du paquet coûterait une copie du `dist` à chaque run pour éprouver
 * exactement le même point de décision — le registre est l'unique entrée du
 * verdict, c'est donc lui qu'on garnit. La dualité RÉELLE, elle, est éprouvée
 * à la main (deux copies physiques, `NF_CLI_DELEGATED=1`).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, "../.."); // src/nodefony
const BIN = path.join(CORE_ROOT, "bin", "nodefony");
const DIST = path.join(CORE_ROOT, "dist", "node", "index.js");

/** URL de la copie fantôme — reconnaissable dans la sortie, donc assertable. */
const COPIE_FANTOME = "file:///copie-fantome/dist/node/Nodefony.js";

interface Sortie {
  code: number | null;
  texte: string;
}

/** Lance le binaire dans `cwd`, rend le code de sortie et TOUTE la sortie. */
function lancer(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<Sortie> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let texte = "";
    child.stdout.on("data", (d) => (texte += d.toString()));
    child.stderr.on("data", (d) => (texte += d.toString()));
    const minuteur = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`délai dépassé\n${texte}`));
    }, 90_000);
    child.on("error", (e) => {
      clearTimeout(minuteur);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(minuteur);
      resolve({ code, texte });
    });
  });
}

/**
 * Monte une application jetable dont le point d'entrée déclare une seconde
 * copie du paquet. Rend son dossier — à supprimer par l'appelant.
 */
function monterAppEnDualite(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-dualite-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "nf-dualite-e2e",
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      // Sans cette déclaration, le Kernel refuse le dossier avant d'avoir rien
      // chargé (« son package.json ne déclare pas la dépendance `nodefony` ») :
      // on mesurerait alors ce refus-là, pas celui de la dualité.
      dependencies: { nodefony: "^10.0.0" },
    }),
  );
  // Marqueur de racine de projet (`findProjectRoot`) — sans lui le binaire se
  // croit hors d'une application et ne boote pas.
  fs.writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};");
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  // Le paquet est atteint par son URL `file://` — l'app jetable n'a pas de
  // `node_modules`, et un spécificateur d'import VOYAGE : écrit en chemin natif,
  // `C:\…` part chez le chargeur ESM comme le protocole `c:` (axiome 3, vu
  // rouge sur les trois jobs Windows du run 34852052728). D'où `toImportSpecifier`,
  // l'unique implémentation de cette conversion — jamais un `pathToFileURL` recopié.
  // L'import s'évalue AVANT le push (hoisting), donc la vraie copie s'inscrit
  // d'abord et la fantôme ensuite — deux entrées, l'ordre que le boot rencontrerait.
  fs.writeFileSync(
    path.join(dir, "dist", "index.js"),
    [
      `import { Module, defineConfig } from ${JSON.stringify(toImportSpecifier(DIST))};`,
      `(globalThis[Symbol.for("nodefony.packageInstances")] ??= []).push(`,
      `  { url: ${JSON.stringify(COPIE_FANTOME)}, version: "0.0.1" },`,
      `);`,
      `const config = defineConfig({ modules: [] });`,
      `export default class App extends Module {`,
      `  constructor(kernel) {`,
      `    super("app", kernel, import.meta.url, config);`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
  );
  // Le spécificateur doit être une URL, sur TOUTE plateforme. Sans cette
  // ligne, un chemin natif passe inaperçu sur macOS et Linux — où il est
  // absolu donc toléré — et ne tombe que dans le job Windows, à distance du
  // geste qui l'a écrit. L'assertion se COMPOSE (axiome 10) : on ne littéralise
  // ni séparateur ni lettre de lecteur.
  const ecrit = fs.readFileSync(path.join(dir, "dist", "index.js"), "utf8");
  assert.ok(
    ecrit.startsWith('import { Module, defineConfig } from "file://'),
    `le paquet doit être importé par URL \`file://\`, pas par chemin natif :\n${ecrit.split("\n")[0]}`,
  );
  return dir;
}

describe.skipIf(!fs.existsSync(DIST))(
  "e2e — deux paquets `nodefony` : le boot RÉEL tranche",
  () => {
    it("hors développement, le binaire REFUSE et nomme la copie fantôme", async () => {
      const dir = monterAppEnDualite();
      try {
        const r = await lancer(["inspect", "modules", "--debug"], dir, {
          NODE_ENV: "production",
        });
        assert.notStrictEqual(
          r.code,
          0,
          `un boot en dualité ne doit PAS réussir\n${r.texte}`,
        );
        assert.ok(
          r.texte.includes("Démarrage refusé"),
          `le refus doit être ANNONCÉ, pas déduit d'un code\n${r.texte}`,
        );
        assert.ok(
          r.texte.includes(COPIE_FANTOME),
          `le refus doit NOMMER la copie surnuméraire — sans son chemin, ` +
            `celui qui lit sait qu'il a un problème mais pas lequel\n${r.texte}`,
        );
        // Le mode est CONSTATÉ, jamais supposé : `resolveRuntimeEnv` collapse
        // `test` et `staging` sur `production`, et annoncer un déploiement à
        // qui lançait ses tests envoie chercher au mauvais endroit.
        assert.ok(
          r.texte.includes("NODE_ENV=production"),
          `le message doit nommer le NODE_ENV constaté\n${r.texte}`,
        );
        // 🔴 CE QUI REND CE TEST NON COMPLAISANT. Le refus est câblé à DEUX
        // instants ; sans cette ligne, débrancher celui de `loadApp` laissait
        // le test vert — celui de `preRegister` mordait à sa place, plus tard.
        // Or refuser TÔT est le contrat : la dualité doit être tranchée avant
        // qu'un seul module ne soit construit à la frontière. Le cycle de vie
        // le dit sans qu'on ait à lire une pile d'appels.
        assert.ok(
          !r.texte.includes("onPreRegister"),
          `le refus doit tomber AVANT le chargement des modules — ici le boot ` +
            `a atteint onPreRegister, donc seul le second point de contrôle a ` +
            `mordu\n${r.texte}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);

    it("en développement, le binaire AVERTIT et poursuit son chemin", async () => {
      const dir = monterAppEnDualite();
      try {
        const r = await lancer(["inspect", "modules", "--debug"], dir, {
          NODE_ENV: "development",
        });
        assert.ok(
          r.texte.includes("copies du paquet"),
          `la dualité doit être DITE en développement aussi\n${r.texte}`,
        );
        assert.ok(
          r.texte.includes(COPIE_FANTOME),
          `l'avertissement doit nommer les chemins\n${r.texte}`,
        );
        assert.ok(
          !r.texte.includes("Démarrage refusé"),
          `en développement on démarre : celui qui lance lit son journal et ` +
            `a besoin de son serveur\n${r.texte}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  },
);
