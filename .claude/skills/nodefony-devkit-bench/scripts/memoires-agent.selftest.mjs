#!/usr/bin/env node
/**
 * Auto-contrôle de la purge du cahier de mémoire que l'agent tient HORS du décor.
 *
 * Ce qu'il garde n'est pas la purge — c'est sa **borne**. La fonction désigne des
 * dossiers à SUPPRIMER dans le foyer de l'utilisateur : une borne trop large y
 * emporterait la mémoire d'un autre projet, et rien ne le dirait avant qu'elle
 * ne manque. Le disque n'est jamais touché ici : les accès sont injectés.
 *
 * `--prove` retire le filtre d'identité du run et exige que les cas tombent —
 * une borne qu'on n'a jamais vue mordre n'est pas une borne.
 *
 * Usage :
 *   node memoires-agent.selftest.mjs
 *   node memoires-agent.selftest.mjs --prove
 */
import path from "node:path";
import { memoiresAgentDuRun } from "./bench-discoverability.mjs";

const PROVE = process.argv.includes("--prove");

const RACINE = path.join("/foyer", ".claude", "projects");
const RUN = "/tmp/nodefony-devkit-bench/2026-09-17T21-52-30";
const CE_RUN = "-tmp-nodefony-devkit-bench-2026-09-17T21-52-30-app";
const AUTRE_PROJET = "-Users-cci-repository-nodefony-core";
const AUTRE_RUN = "-tmp-nodefony-devkit-bench-2026-09-12T00-39-40-app";

/** Un foyer de contrôle : trois projets, dont un seul appartient à ce run. */
const io = (entrees, avecMemoire = entrees) => ({
  racine: RACINE,
  lister: (d) => (d === RACINE ? entrees : []),
  existe: (p) =>
    p === RACINE ||
    avecMemoire.some((e) => p === path.join(RACINE, e, "memory")),
});

/**
 * La règle AMPUTÉE — sans le filtre d'identité du run. C'est l'écriture qu'on
 * obtient en « simplifiant » : elle purge le foyer entier, y compris la mémoire
 * du dépôt de travail de l'utilisateur.
 */
const debranchee = (runDir, e) =>
  e
    .lister(e.racine)
    .map((nom) => path.join(e.racine, nom, "memory"))
    .filter((p) => e.existe(p));

const regle = PROVE ? debranchee : memoiresAgentDuRun;

const cas = [
  {
    quoi: "retient le cahier de CE run",
    calcul: () => regle(RUN, io([CE_RUN])),
    attendu: [path.join(RACINE, CE_RUN, "memory")],
  },
  {
    quoi: "🔴 IGNORE la mémoire d'un autre projet — la borne",
    calcul: () => regle(RUN, io([AUTRE_PROJET])),
    attendu: [],
  },
  {
    quoi: "🔴 IGNORE le cahier d'un run ANTÉRIEUR du même banc",
    calcul: () => regle(RUN, io([AUTRE_RUN])),
    attendu: [],
  },
  {
    quoi: "trie : garde le sien, laisse les deux autres",
    calcul: () => regle(RUN, io([AUTRE_PROJET, CE_RUN, AUTRE_RUN])),
    attendu: [path.join(RACINE, CE_RUN, "memory")],
  },
  {
    quoi: "un projet de ce run SANS dossier memory n'est pas désigné",
    calcul: () => regle(RUN, io([CE_RUN], [])),
    attendu: [],
  },
  {
    quoi: "foyer absent → rien (l'agent n'a jamais écrit)",
    calcul: () =>
      regle(RUN, { racine: RACINE, lister: () => [], existe: () => false }),
    attendu: [],
  },
  {
    quoi: "🔴 un runDir VIDE ne désigne pas tout le foyer",
    calcul: () => regle("", io([AUTRE_PROJET, CE_RUN])),
    attendu: [],
    // Ce cas ne tombe PAS sous `--prove` : la règle amputée n'a plus de borne,
    // donc elle rend tout — c'est précisément ce qu'on veut lui voir faire.
    tombeSousProve: true,
  },
];

let verts = 0;
let rouges = 0;
for (const c of cas) {
  const obtenu = c.calcul();
  const ok = JSON.stringify(obtenu) === JSON.stringify(c.attendu);
  if (ok) verts += 1;
  else rouges += 1;
  process.stdout.write(`  ${ok ? "✅" : "❌"} ${c.quoi}\n`);
}

if (PROVE) {
  // Sans le filtre, tout cas qui attend une liste VIDE alors que le foyer porte
  // au moins un dossier `memory` doit tomber. Si aucun ne tombe, c'est qu'aucun
  // échantillon ne met un projet étranger dans le foyer — et la borne n'est
  // gardée par personne.
  const attendus = 4;
  if (rouges < attendus) {
    process.stdout.write(
      `\n❌ borne débranchée : ${rouges} cas tombé(s), ${attendus} attendus — ` +
        `aucun échantillon ne place un projet étranger dans le foyer\n`,
    );
    process.exit(2);
  }
  process.stdout.write(
    `\n✅ débranchée, la borne fait tomber ${rouges} cas — elle mord bien\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `\n━━ ${verts}/${cas.length} : la borne de purge du cahier de mémoire d'agent\n`,
);
process.exit(rouges === 0 ? 0 : 1);
