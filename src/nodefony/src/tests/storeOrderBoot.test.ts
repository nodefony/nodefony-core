import { describe, it } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toImportSpecifier } from "../kernel/resolveModuleEntry";
import { SysExit } from "../cli/sysexits";

/**
 * SPEC e2e — « le refus d'ordre des magasins est réellement CÂBLÉ dans le boot ».
 *
 * 🔴 CE QUE CE FICHIER GARDE. `storeManifest.test.ts` appelle la garde par ses
 * fonctions ; celui-ci lance le VRAI binaire sur une VRAIE application. Sans
 * lui, retirer l'appel dans `Kernel.loadModulesFromManifest` laisserait toute la
 * suite verte — et le défaut qu'il ferme est précisément de ceux qu'aucune suite
 * ne voit : un serveur qui démarre, écoute, répond `200`, et a perdu ses jetons,
 * ses passkeys, son audit et son second facteur.
 *
 * Le décor n'a besoin ni de MongoDB ni d'un ORM réel : la garde lit ce qu'un
 * paquet DÉCLARE (`nodefony.storeKind`, `nodefony.consumesStores`). Deux paquets
 * factices suffisent — et rendent le cas rejouable sur les trois plateformes,
 * sans conteneur.
 *
 * Le marqueur écrit par le faux ORM à sa construction est ce qui rend ce test
 * NON complaisant : un refus qui tomberait APRÈS le chargement laisserait le
 * marqueur dans la sortie, et la garde n'aurait rien préservé.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, "../.."); // src/nodefony
const BIN = path.join(CORE_ROOT, "bin", "nodefony");
const DIST = path.join(CORE_ROOT, "dist", "node", "index.js");

/** Écrit par le faux ORM à sa construction — absent si le refus tombe avant. */
const MARQUEUR_ORM = "FAUX-ORM-CONSTRUIT";
/** Idem côté consommateur. */
const MARQUEUR_CONSUMER = "FAUX-CONSUMER-CONSTRUIT";

interface Sortie {
  code: number | null;
  texte: string;
}

/** Lance le binaire dans `cwd`, rend le code de sortie et TOUTE la sortie. */
function lancer(args: string[], cwd: string): Promise<Sortie> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, NODE_ENV: "development" },
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

/** Écrit un paquet factice dans le `node_modules` de l'app jetable. */
function poserPaquet(
  racine: string,
  nom: string,
  declaration: Record<string, unknown>,
  marqueur: string,
): void {
  const dir = path.join(racine, "node_modules", nom);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: nom,
      version: "1.0.0",
      type: "module",
      main: "index.js",
      nodefony: declaration,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "index.js"),
    [
      `import { Module } from ${JSON.stringify(toImportSpecifier(DIST))};`,
      `export default class M extends Module {`,
      `  constructor(kernel) {`,
      `    super(${JSON.stringify(nom)}, kernel, import.meta.url, {});`,
      `    console.log(${JSON.stringify(marqueur)});`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
  );
}

/**
 * Monte une application jetable dont le manifeste `modules` porte l'ordre
 * demandé. Rend son dossier — à supprimer par l'appelant.
 */
function monterApp(ordre: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-store-order-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "nf-store-order-e2e",
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      dependencies: {
        nodefony: "^10.0.0",
        "faux-orm": "^1.0.0",
        "faux-consumer": "^1.0.0",
      },
    }),
  );
  // Marqueur de racine de projet (`findProjectRoot`).
  fs.writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};");
  poserPaquet(
    dir,
    "faux-orm",
    { storeKind: "durable", stores: ["session", "tokens"] },
    MARQUEUR_ORM,
  );
  poserPaquet(
    dir,
    "faux-consumer",
    { consumesStores: true },
    MARQUEUR_CONSUMER,
  );
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  // Le paquet est atteint par son URL `file://` — l'app jetable n'a pas le core
  // dans son `node_modules`, et un spécificateur d'import VOYAGE (axiome 3).
  fs.writeFileSync(
    path.join(dir, "dist", "index.js"),
    [
      `import { Module, defineConfig } from ${JSON.stringify(toImportSpecifier(DIST))};`,
      `const config = defineConfig({ modules: ${JSON.stringify(ordre)} });`,
      `export default class App extends Module {`,
      `  constructor(kernel) {`,
      `    super("app", kernel, import.meta.url, config);`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
  );
  return dir;
}

describe.skipIf(!fs.existsSync(DIST))(
  "e2e — l'ORDRE des magasins : le boot RÉEL tranche",
  () => {
    it("🔴 REFUSE un fournisseur durable déclaré APRÈS son consommateur", async () => {
      const dir = monterApp(["faux-consumer", "faux-orm"]);
      try {
        const r = await lancer(["inspect", "modules"], dir);
        assert.notStrictEqual(
          r.code,
          0,
          `un manifeste qui condamne les magasins durables ne doit PAS démarrer\n${r.texte}`,
        );
        // Une faute de CONFIGURATION, pas une erreur interne : un orchestrateur
        // doit les distinguer sans lire un journal.
        assert.strictEqual(
          r.code,
          SysExit.CONFIG,
          `le refus doit sortir en EX_CONFIG (${SysExit.CONFIG})\n${r.texte}`,
        );
        assert.ok(
          /Démarrage refusé — manifeste "modules"/.test(r.texte),
          `le refus doit être ANNONCÉ, pas déduit d'un code\n${r.texte}`,
        );
        assert.ok(
          r.texte.includes("faux-orm") && r.texte.includes("faux-consumer"),
          `le refus doit NOMMER les deux modules — sans eux, on sait qu'il y a ` +
            `un problème, pas quelle ligne déplacer\n${r.texte}`,
        );
        assert.ok(
          /Remède/.test(r.texte),
          `le refus doit dire le GESTE qui répare\n${r.texte}`,
        );
        // 🔴 CE QUI REND CE TEST NON COMPLAISANT. Le contrat n'est pas « refuser »,
        // c'est « refuser AVANT ». Une fois le consommateur construit, ses
        // magasins sont déjà retombés en mémoire : trancher après ne préserve
        // rien. Le marqueur est la seule chose qui distingue les deux.
        assert.ok(
          !r.texte.includes(MARQUEUR_CONSUMER),
          `le refus doit tomber AVANT le chargement du moindre module — ici le ` +
            `consommateur a été construit, donc la garde a mordu trop tard\n${r.texte}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);

    it("ACCEPTE l'ordre juste, et charge les deux modules", async () => {
      const dir = monterApp(["faux-orm", "faux-consumer"]);
      try {
        const r = await lancer(["inspect", "modules"], dir);
        assert.ok(
          !/Démarrage refusé — manifeste "modules"/.test(r.texte),
          `l'ordre juste ne doit RIEN refuser\n${r.texte}`,
        );
        // Témoin du décor : sans lui, un refus prononcé pour une tout autre
        // raison rendrait ce cas vert sans que rien n'ait été chargé.
        assert.ok(
          r.texte.includes(MARQUEUR_ORM) && r.texte.includes(MARQUEUR_CONSUMER),
          `les deux modules doivent être réellement construits — sinon ce cas ` +
            `ne prouve pas que la garde laisse passer\n${r.texte}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  },
);
