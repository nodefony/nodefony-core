#!/usr/bin/env node
/**
 * Auto-contrôle de la remise à zéro du décor — le mécanisme, AVANT de payer un
 * agent pour s'en apercevoir.
 *
 * La remise à zéro existe parce que le banc déroulait toutes ses tâches dans UNE
 * application : la tâche 6 posait une base de données injoignable — la bonne
 * réponse à son énoncé — et les gates des tâches suivantes rougissaient sur un
 * décor qu'elles n'avaient pas sali. Un mécanisme censé fermer ce canal ne vaut
 * que si on l'a vu FERMER quelque chose : ce contrôle salit un décor de six
 * façons distinctes, chacune correspondant à un canal réel de contamination,
 * puis vérifie que chacune a disparu.
 *
 * Il ne monte aucune application : il travaille sur un décor de run existant
 * (celui qu'on lui donne), ce qui le rend gratuit. Le décor est laissé remis à
 * zéro — il était de toute façon consommé.
 *
 *   node reinit-decor.selftest.mjs <runDir d'un run précédent>
 *
 * Sorties : 0 tous les canaux fermés · 1 au moins un résidu survit · 2 décor
 * inutilisable (pas d'application, pas d'« état initial ») — un contrôle qui
 * n'a rien pu éprouver ne se compte pas comme vert.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reinitialiserDecor } from "./bench-discoverability.mjs";

/**
 * Monte un décor JETABLE quand aucun run n'est donné.
 *
 * 🔴 Sans ce mode, ce contrôle n'était lancé par RIEN : le lot l'écartait faute
 * de `<runDir>`, aucun script npm ni étage de forge ne le nommait, et il fallait
 * penser à le taper. Un contrôle que personne ne lance ne garde rien — et
 * celui-ci garde exactement ce qui casse sans bruit : une tâche jugée sur la
 * saleté de la précédente.
 *
 * Ce qu'il faut au mécanisme, et rien de plus : un dépôt git, un commit
 * « état initial », et les motifs d'exclusion. Pas d'application Nodefony —
 * `reinitialiserDecor` ne fait que `npm run stop` (sans effet ici), un
 * `read-tree` et un `git clean`.
 *
 * ⚠️ Le `.gitignore` est COPIÉ du gabarit du produit, jamais réécrit de tête :
 * c'est lui qui décide de ce que `git clean -e /node_modules` épargne, donc
 * c'est lui que le contrôle éprouve. Un motif inventé ici rendrait un vert sur
 * une règle qui n'est pas celle que l'utilisateur reçoit.
 *
 * @returns {string} le runDir monté.
 */
function monterDecorJetable() {
  const racineDepot = path.dirname(
    path.dirname(
      path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
    ),
  );
  const gabarit = path.join(
    racineDepot,
    "src",
    "nodefony",
    "templates",
    "app",
    "base",
    "gitignore.tpl",
  );
  if (!existsSync(gabarit)) {
    console.error(
      `décor jetable impossible : le gabarit ${gabarit} est introuvable.\n` +
        "Ce contrôle refuse d'inventer les motifs d'exclusion qu'il doit éprouver.",
    );
    process.exit(2);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "reinit-decor-"));
  const a = path.join(dir, "app");
  mkdirSync(path.join(a, "nodefony"), { recursive: true });
  writeFileSync(path.join(a, ".gitignore"), readFileSync(gabarit, "utf8"));
  writeFileSync(
    path.join(a, "package.json"),
    `${JSON.stringify({ name: "decor-jetable", private: true, scripts: {} }, null, 2)}\n`,
  );
  writeFileSync(path.join(a, "nodefony", "Kernel.ts"), "export const k = 1;\n");
  // Le secret : c'est la moitié que la remise à zéro risque le plus d'emporter.
  writeFileSync(path.join(a, ".env.local"), "NF_SECRET=jetable\n");
  const g = (...args) =>
    execFileSync("git", ["-C", a, ...args], { encoding: "utf8" });
  g("init", "-q");
  g("add", "-A");
  g(
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@local",
    "commit",
    "-qm",
    "décor jetable — état initial",
  );
  return dir;
}

const donne = process.argv[2] !== undefined && process.argv[2] !== "";
const jetable = donne ? null : monterDecorJetable();
if (jetable) {
  console.log(`  · décor JETABLE monté (aucun run donné) : ${jetable}`);
}
const runDir = path.resolve(donne ? process.argv[2] : jetable);
const app = path.join(runDir, "app");
if (!existsSync(path.join(app, ".git"))) {
  console.error(`décor inutilisable : ${app} n'est pas un dépôt git`);
  process.exit(2);
}
const git = (...args) =>
  execFileSync("git", ["-C", app, ...args], { encoding: "utf8" }).trim();
if (!/état initial$/mu.test(git("log", "--format=%s"))) {
  console.error("décor inutilisable : aucun commit « état initial »");
  process.exit(2);
}

// ── Les six saletés, une par canal de contamination réellement observé ──────
const envLocal = path.join(app, ".env.local");
const secretInitial = existsSync(envLocal)
  ? readFileSync(envLocal, "utf8")
  : "";
// Un contrôle PRÉCÉDENT interrompu (ou joué sur un mécanisme débranché) laisse
// sa propre salissure dans le fichier ignoré. Le run suivant la relit comme si
// elle faisait partie de l'état initial, la « restaure » fidèlement, et conclut
// que le canal n'est pas fermé : un rouge parfaitement crédible, sur un
// mécanisme intact. On refuse de juger plutôt que d'accuser à tort.
if (/NF_SALE/u.test(secretInitial)) {
  console.error(
    "décor inutilisable : `.env.local` porte encore la salissure d'un contrôle\n" +
      "précédent (NF_SALE). Retire cette ligne, ou repars d'un décor neuf —\n" +
      "sinon le verdict porterait sur le résidu, pas sur le mécanisme.",
  );
  process.exit(2);
}
// Le manifeste n'existe que sur les runs postérieurs à la remise à zéro : on le
// fabrique pour que le contrôle porte AUSSI sur la restauration. Il est écrit
// comme le banc l'écrit — chemin relatif + contenu base64 — et surtout PAS
// selon une idée qu'on s'en ferait : c'est en le réinventant que le premier jet
// a rendu `.env.local` sous le nom `/env.local`.
const manifeste = path.join(runDir, "decor-initial.json");
if (secretInitial) {
  writeFileSync(
    manifeste,
    JSON.stringify(
      [
        {
          chemin: ".env.local",
          contenu: Buffer.from(secretInitial, "utf8").toString("base64"),
        },
      ],
      null,
      2,
    ),
  );
}

const salissures = [
  {
    nom: "fichier suivi ajouté par une tâche",
    salir: () =>
      writeFileSync(
        path.join(app, "nodefony", "Sale.ts"),
        "export const x = 1;\n",
      ),
    survit: () => existsSync(path.join(app, "nodefony", "Sale.ts")),
  },
  {
    nom: "fichier suivi MODIFIÉ par une tâche",
    salir: () => {
      const f = path.join(app, "package.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.description = "salissure du contrôle";
      writeFileSync(f, JSON.stringify(j, null, 2));
    },
    survit: () =>
      /salissure du contrôle/u.test(
        readFileSync(path.join(app, "package.json"), "utf8"),
      ),
  },
  {
    nom: "base de données semée (var/ ignoré)",
    salir: () => {
      mkdirSync(path.join(app, "var", "databases"), { recursive: true });
      writeFileSync(path.join(app, "var", "databases", "sale.db"), "x");
    },
    survit: () => existsSync(path.join(app, "var", "databases", "sale.db")),
  },
  {
    nom: "variable d'environnement écrite dans .env.local (ignoré)",
    salir: () =>
      writeFileSync(
        envLocal,
        `${secretInitial}\nNF_SALE=postgres://nulle-part\n`,
      ),
    // Défensif : après la remise à zéro le fichier peut avoir disparu — c'est
    // un autre défaut (le secret perdu), constaté plus bas, pas une exception.
    survit: () =>
      existsSync(envLocal) && /NF_SALE/u.test(readFileSync(envLocal, "utf8")),
  },
  {
    nom: "dist d'une autre tâche (dossier ignoré)",
    salir: () => {
      mkdirSync(path.join(app, "dist"), { recursive: true });
      writeFileSync(path.join(app, "dist", "sale.js"), "// périmé\n");
    },
    survit: () => existsSync(path.join(app, "dist", "sale.js")),
  },
  {
    // Le canal qui a coûté un verdict : `create module` fait naître un WORKSPACE
    // npm, donc un `node_modules/` À L'INTÉRIEUR du module, et son bundler y
    // dépose un `dist/node_modules/`. L'exclusion du nettoyage étant un motif
    // gitignore SANS ancrage, elle protégeait ces deux-là aussi — et git ne peut
    // pas supprimer un dossier dont il doit préserver le contenu. Le squelette
    // `modules/<nom>/` survivait donc à la remise à zéro, et la tâche suivante
    // se voyait refuser son propre générateur (« le module existe déjà »,
    // `scaffold/engine.ts:1381`) sans qu'aucune sonde ne le dise.
    nom: "module créé par une tâche (workspace + node_modules imbriqués)",
    salir: () => {
      const mod = path.join(app, "modules", "sale-module");
      mkdirSync(path.join(mod, "node_modules", "dep"), { recursive: true });
      mkdirSync(path.join(mod, "dist", "node_modules", "drizzle-orm"), {
        recursive: true,
      });
      writeFileSync(path.join(mod, "package.json"), '{"name":"@app/sale"}\n');
      writeFileSync(path.join(mod, "index.ts"), "export const x = 1;\n");
      writeFileSync(path.join(mod, "node_modules", "dep", "y.js"), "//\n");
      writeFileSync(
        path.join(mod, "dist", "node_modules", "drizzle-orm", "sel.js"),
        "//\n",
      );
    },
    survit: () => existsSync(path.join(app, "modules", "sale-module")),
  },
];

for (const s of salissures) s.salir();
git("add", "-A");
git(
  "-c",
  "user.name=bench",
  "-c",
  "user.email=bench@local",
  "commit",
  "-qm",
  "tâche 99",
  "--allow-empty",
);

const avant = salissures.filter((s) => s.survit());
if (avant.length !== salissures.length) {
  // Une salissure qui ne prend pas rendrait le vert final creux : on ne peut pas
  // prouver qu'on efface ce qui n'a jamais été écrit.
  console.error("  ✗ salissures non posées :");
  for (const s of salissures.filter((x) => !x.survit())) {
    console.error(`      ${s.nom}`);
  }
  if (jetable) rmSync(jetable, { recursive: true, force: true });
  process.exit(2);
}
console.log(`  · ${avant.length} salissures posées et constatées`);

reinitialiserDecor(app, runDir, 100);

const residus = salissures.filter((s) => s.survit());
for (const s of residus)
  console.log(`  ✗ SURVIT à la remise à zéro : ${s.nom}`);

// Le secret ne doit PAS avoir été emporté par le nettoyage : c'est la moitié
// que le mécanisme risque le plus de casser, et elle ne se voit pas — une app
// sans ses clés démarre encore, avec d'autres.
const secretRendu = existsSync(envLocal)
  ? readFileSync(envLocal, "utf8") === secretInitial
  : !secretInitial;
if (!secretRendu) {
  console.log(
    "  ✗ la configuration de machine (.env.local) n'a PAS été rendue à l'identique",
  );
}

// L'historique doit rester lisible par le juge : les commits des tâches déjà
// jouées restent atteignables par `git log`, sinon `judgeTask` ne trouve plus
// rien et déclare « tâche non jouée » sur du travail réel.
const historiqueIntact = /tâche 99$/mu.test(git("log", "--format=%s"));
if (!historiqueIntact) {
  console.log("  ✗ l'historique a perdu les commits de tâches déjà jouées");
}

rmSync(manifeste, { force: true });
// Un décor JETABLE se jette — mais seulement lui : celui qu'on nous a DONNÉ
// appartient à l'opérateur, et le contrôle le laisse remis à zéro, pas effacé.
if (jetable) rmSync(jetable, { recursive: true, force: true });
const defauts =
  residus.length + (secretRendu ? 0 : 1) + (historiqueIntact ? 0 : 1);
console.log(
  `\n━━ ${salissures.length - residus.length}/${salissures.length} canaux fermés` +
    `, configuration ${secretRendu ? "rendue" : "PERDUE"}` +
    `, historique ${historiqueIntact ? "intact" : "AMPUTÉ"}`,
);
process.exit(defauts ? 1 : 0);
