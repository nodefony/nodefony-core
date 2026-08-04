#!/usr/bin/env node
/**
 * Auto-contrôle de la sélection de passe — sur un historique FABRIQUÉ.
 *
 * Ce contrôle existe parce que le défaut qu'il attrape a été rendu par le banc
 * lui-même : trois répétitions de la tâche 26, trois FAIL — dont deux jugeaient
 * un commit de DÉCOR. Le diff accusé était celui que le harnais avait posé
 * AVANT l'agent. Rien ne le signalait : les verdicts étaient plausibles, et ils
 * confirmaient même ce qu'on attendait.
 *
 *   node lib/passes.selftest.mjs
 *   node lib/passes.selftest.mjs --prove   # remet le défaut : ce contrôle doit tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./passes.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const { indiceDeLaPasse, passesDe, commitsDuHarnais } = await import(MODULE);

// Trois répétitions de la tâche 26, telles que le banc les écrit — décor et
// remise à zéro compris, dans l'ordre de `git log` (plus récent d'abord).
const LOG = [
  "aaa3333 tâche 26",
  "bbb3333 Sécuriser la route — commit de l'agent lui-même",
  "ccc3333 décor de la tâche 26",
  "ddd3333 remise à zéro avant la tâche 26 — état initial",
  "aaa2222 tâche 26",
  "ccc2222 décor de la tâche 26",
  "ddd2222 remise à zéro avant la tâche 26 — état initial",
  "aaa1111 tâche 26",
  "ccc1111 décor de la tâche 26",
  "eee0000 état initial",
];

let defauts = 0;
const echec = (msg) => {
  defauts += 1;
  console.log(`  ❌ ${msg}`);
};
const hash = (i) => (i === -1 ? "(aucune)" : LOG[i].split(" ")[0]);

console.log(
  "• un commit de l'AGENT n'est pas une passe, même s'il en a le nom",
);
// Le cas RÉEL, relevé sur une passe complète : lâché dans un dépôt dont
// l'historique est fait de « tâche 10 », l'agent IMITE la convention et écrit
// son propre commit `tâche 10`. Le banc comptait alors quatre passes pour trois
// jouées — une passe jugée sur le commit partiel de l'agent, une comptée deux
// fois, la dernière jamais jugée.
const LOG_AVEC_AUTEURS = [
  "aaa3333\tbench\ttâche 10",
  "fff2222\tChristophe CAMENSULI\ttâche 10",
  "aaa2222\tbench\ttâche 10",
  "ddd2222\tbench\tremise à zéro avant la tâche 10 — état initial",
  "aaa1111\tbench\ttâche 10",
  "eee0000\tbench\tétat initial",
];
const duHarnais = commitsDuHarnais(LOG_AVEC_AUTEURS);
if (passesDe(duHarnais, 10).length !== 3) {
  echec(
    `${passesDe(duHarnais, 10).length} passes trouvées, 3 attendues — le commit ` +
      `de l'agent est compté comme une passe du harnais`,
  );
}
if (duHarnais.some((l) => l.includes("fff2222"))) {
  echec("le commit de l'agent a survécu au filtre d'auteur");
}
// La forme rendue doit rester celle qu'attend le reste du banc.
if (duHarnais[0] !== "aaa3333 tâche 10") {
  echec(`format inattendu après filtrage : « ${duHarnais[0]} »`);
}
// Un journal SANS auteur (rapport d'archive relu par --analyze-only) reste
// lisible : on ne jette pas des lignes qu'on ne sait pas qualifier.
if (commitsDuHarnais(LOG).length !== LOG.length) {
  echec("un journal sans colonne d'auteur a été amputé");
}

console.log("• un commit de DÉCOR n'est pas une passe");
const passes = passesDe(LOG, 26);
if (passes.length !== 3) {
  echec(
    `${passes.length} passes trouvées, 3 attendues — les commits « décor de la ` +
      `tâche 26 » sont comptés comme du travail d'agent`,
  );
}

console.log("• le rang chronologique désigne la bonne passe");
for (const [occurrence, attendu] of [
  [0, "aaa1111"],
  [1, "aaa2222"],
  [2, "aaa3333"],
]) {
  const obtenu = hash(indiceDeLaPasse(LOG, 26, occurrence));
  if (obtenu !== attendu) {
    echec(`passe n° ${occurrence} → ${obtenu}, attendu ${attendu}`);
  }
}

console.log("• sans rang, c'est la plus récente");
if (hash(indiceDeLaPasse(LOG, 26, null)) !== "aaa3333") {
  echec(`sans rang → ${hash(indiceDeLaPasse(LOG, 26, null))}, attendu aaa3333`);
}

console.log("• une passe qui n'existe pas se dit, elle ne se devine pas");
if (indiceDeLaPasse(LOG, 26, 3) !== -1) {
  echec("une 4ᵉ passe inexistante devrait rendre -1");
}
if (indiceDeLaPasse(LOG, 99, null) !== -1) {
  echec("une tâche jamais jouée devrait rendre -1");
}

console.log("• « tâche 2 » ne mord pas sur « tâche 26 »");
if (passesDe(["aaa tâche 26", "bbb tâche 2"], 2).length !== 1) {
  echec("le préfixe numérique confond deux tâches");
}

console.log(
  defauts === 0
    ? "\n━━ décor écarté, rang chronologique juste, passe absente signalée"
    : `\n━━ ${defauts} DÉFAUT(S)`,
);

// ─── --prove : remettre le défaut EXACT qui a produit deux verdicts faux ────
if (process.argv.includes("--prove") && MODULE === "./passes.mjs") {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "passes.mjs"), "utf8");
  const mutations = [
    {
      regle: "message EXACT (et non `endsWith`)",
      de: '.map((l, i) => (l.slice(l.indexOf(" ") + 1) === attendu ? i : -1))',
      vers: ".map((l, i) => (l.endsWith(attendu) ? i : -1))",
    },
    {
      regle: "rang compté depuis le plus ANCIEN",
      de: "return passes[passes.length - 1 - occurrence] ?? -1;",
      vers: "return passes[occurrence] ?? -1;",
    },
    {
      regle: "l'AUTEUR distingue le harnais de l'agent",
      de: 'if (an === auteur) retenus.push(`${hash} ${reste.join("\\t")}`);',
      vers: 'retenus.push(`${hash} ${reste.join("\\t")}`);',
    },
  ];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-passes-prove-"));
  let muets = 0;
  console.log("\n━━ --prove : remise du défaut");
  for (const [i, m] of mutations.entries()) {
    if (!source.includes(m.de)) {
      console.log(
        `  ⚠️ ${m.regle} — ancre introuvable, DÉBRANCHEMENT NON FAIT`,
      );
      muets += 1;
      continue;
    }
    const copie = path.join(tmp, `passes-${i}.mjs`);
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
  process.exit(defauts || muets ? 1 : 0);
}

process.exit(defauts ? 1 : 0);
