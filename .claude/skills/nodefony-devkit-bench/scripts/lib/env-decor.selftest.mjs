#!/usr/bin/env node
/**
 * Auto-contrôle de l'environnement d'un décor — sur un `process.env` FABRIQUÉ.
 *
 * Ce contrôle existe parce que le défaut qu'il attrape a condamné un agent sans
 * qu'aucune sonde ne puisse le dire : la tâche 6 du banc de découvrabilité
 * exige « 0 variable inconnue », et les variables du HARNAIS
 * (`NF_DEVKIT_BENCH_*`, `NF_MCP_TOKEN`) arrivaient dans l'application témoin par
 * héritage de `process.env`. Quoi que l'agent écrive, le verdict était FAIL —
 * constaté identique sur quatre agents, alors que la référence donne cette
 * tâche à PASS 3/3.
 *
 * Le second dégât est pire, parce qu'il ne se voit sur aucun run : le résultat
 * dépendait du SHELL qui lance le banc. Un poste sans `NF_*` rendait PASS, un
 * poste outillé rendait FAIL, et rien ne distinguait les deux.
 *
 *   node lib/env-decor.selftest.mjs
 *   node lib/env-decor.selftest.mjs --prove   # remet le défaut : ce contrôle doit tomber
 *
 * Sorties : 0 toutes les règles tiennent · 1 au moins une est muette.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./env-decor.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const { envDecor, nfEcartees } = await import(MODULE);

// Un poste RÉALISTE : les variables du harnais, un jeton MCP émis pour le
// serveur du DÉPÔT, une variable Nodefony de l'utilisateur — et du bruit qui
// n'a rien à voir et doit SURVIVRE (couper `PATH` casserait tout le décor).
const POSTE = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/dev",
  LANG: "fr_FR.UTF-8",
  NF_MCP_TOKEN: "eyJhbGciOiJFZERTQSJ9.jeton-du-depot",
  NF_DEVKIT_BENCH_AGENT: "gemini",
  NF_DEVKIT_BENCH_AGENT_ARGS: "--skip-trust -y -p",
  NF_DEVKIT_BENCH_MODEL: "",
  NF_DATABASE_URL: "postgres://poste-du-developpeur/db",
  NF_DEV_PORTS: "5151,5152",
};

const PORTS = { NF_PORT: "5371", NF_PORT_HTTPS: "5372" };

const original = process.env;
process.env = { ...POSTE };

const defauts = [];
// Le total se COMPTE, il ne s'écrit pas : un « 8/8 » en dur a déjà survécu à
// l'ajout d'une neuvième règle, et annonçait un compte faux sans que rien ne le
// signale. Ce qu'un contrôle affirme sur lui-même doit être mesuré comme le
// reste.
let regles = 0;
/**
 * @param {boolean} ok - la règle tient-elle ?
 * @param {string} regle - ce qui est éprouvé.
 * @param {string} preuve - ce qu'on a lu.
 */
function verifier(ok, regle, preuve) {
  regles += 1;
  if (!ok) defauts.push(`${regle} — ${preuve}`);
  console.log(`  ${ok ? "✅" : "❌"} ${regle}`);
}

const env = envDecor(PORTS);

verifier(
  env.NF_MCP_TOKEN === undefined,
  "le token MCP du POSTE n'entre pas dans le décor",
  `lu : ${env.NF_MCP_TOKEN}`,
);
verifier(
  Object.keys(env).every((c) => !c.startsWith("NF_DEVKIT_BENCH")),
  "aucune variable du HARNAIS n'entre dans le décor",
  Object.keys(env)
    .filter((c) => c.startsWith("NF_DEVKIT_BENCH"))
    .join(","),
);
verifier(
  env.NF_DATABASE_URL === undefined,
  "une NF_* de l'utilisateur n'entre pas non plus (le décor n'est pas son poste)",
  `lu : ${env.NF_DATABASE_URL}`,
);
verifier(
  env.NF_PORT === "5371" && env.NF_PORT_HTTPS === "5372",
  "ce que le banc POSE délibérément survit au filtrage",
  `NF_PORT=${env.NF_PORT} NF_PORT_HTTPS=${env.NF_PORT_HTTPS}`,
);
verifier(
  env.PATH === "/usr/bin:/bin" && env.HOME === "/Users/dev",
  "les variables non-Nodefony sont INTACTES",
  `PATH=${env.PATH} HOME=${env.HOME}`,
);
// Une couche postérieure GAGNE sur l'héritage. Deux cas, et le second seul est
// discriminant : reposer une `NF_*` réussirait même avec les couches appliquées
// en premier (le filtre a déjà vidé la place), alors qu'écraser une variable
// NON-Nodefony du poste — un foyer jetable, précisément ce que le banc fait
// pour Vibe et Codex — ne réussit QUE si les couches passent en dernier.
{
  const rendu = envDecor(PORTS, {
    NF_MCP_TOKEN: "jeton-du-banc",
    HOME: "/tmp/foyer-jetable",
  });
  verifier(
    rendu.NF_MCP_TOKEN === "jeton-du-banc" &&
      rendu.HOME === "/tmp/foyer-jetable",
    "une couche postérieure GAGNE — token du BANC, et foyer JETABLE sur le vrai `HOME`",
    `NF_MCP_TOKEN=${rendu.NF_MCP_TOKEN} HOME=${rendu.HOME}`,
  );
}
verifier(
  nfEcartees().join(",") ===
    [
      "NF_DATABASE_URL",
      "NF_DEVKIT_BENCH_AGENT",
      "NF_DEVKIT_BENCH_AGENT_ARGS",
      "NF_DEVKIT_BENCH_MODEL",
      "NF_DEV_PORTS",
      "NF_MCP_TOKEN",
    ].join(","),
  "ce qui est écarté est NOMMÉ (un décor s'énonce)",
  nfEcartees().join(","),
);

process.env = original;

for (const d of defauts) console.log(`     ${d}`);
console.log(
  defauts.length === 0
    ? `\n━━ ${regles}/${regles} : le décor part d'un environnement d'utilisateur, pas de l'atelier`
    : `\n━━ ${defauts.length} règle(s) en défaut`,
);

// ── Preuve négative : on REMET le défaut, ce contrôle doit tomber ────────────
if (process.argv.includes("--prove")) {
  console.log(
    "\n🔬 débranchement — le filtre retiré, ces règles doivent tomber",
  );
  const source = readFileSync(
    fileURLToPath(new URL("./env-decor.mjs", import.meta.url)),
    "utf8",
  );
  const tmp = mkdtempSync(path.join(os.tmpdir(), "env-decor-prove-"));
  const mutations = [
    {
      regle: "le filtre `NF_` retiré (l'ancien `{...process.env}`)",
      de: '.filter(([cle]) => !cle.startsWith("NF_")),',
      vers: ",",
    },
    {
      regle:
        "les couches appliquées AVANT l'héritage (le poste regagne son `HOME`)",
      de: "return Object.assign(heriteSansNf, ...couches);",
      vers: "return Object.assign({}, ...couches, heriteSansNf);",
    },
    {
      // Le correctif PARTIEL qu'on aurait pu écrire à la place : ne chasser que
      // les variables du harnais. Il aurait rendu la tâche 6 verte ICI, et
      // laissé passer le `NF_MCP_TOKEN` et le `NF_DATABASE_URL` du poste —
      // c'est-à-dire gardé le banc dépendant du shell qui le lance.
      regle: "filtre trop ÉTROIT (`NF_DEVKIT_BENCH` seul, pas tout `NF_`)",
      de: '!cle.startsWith("NF_")',
      vers: '!cle.startsWith("NF_DEVKIT_BENCH")',
    },
  ];
  let muets = 0;
  for (const [i, m] of mutations.entries()) {
    if (!source.includes(m.de)) {
      console.log(
        `  ⚠️ ${m.regle} — ancre introuvable, DÉBRANCHEMENT NON FAIT`,
      );
      muets += 1;
      continue;
    }
    const copie = path.join(tmp, `env-decor-${i}.mjs`);
    writeFileSync(copie, source.replace(m.de, m.vers));
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--module", copie],
      { encoding: "utf8" },
    );
    const mord = r.status !== 0;
    if (!mord) muets += 1;
    console.log(
      `  ${mord ? "✅" : "❌"} ${m.regle} → ce contrôle sort ${r.status}` +
        (mord ? "" : "  (IL NE MORD PAS)"),
    );
  }
  console.log(
    muets === 0
      ? `━━ les ${mutations.length} règles sont VUES rouges quand on les débranche`
      : `━━ ${muets} règle(s) NON PROUVÉE(S)`,
  );
  process.exit(defauts.length || muets ? 1 : 0);
}

process.exit(defauts.length ? 1 : 0);
