#!/usr/bin/env node
/**
 * Auto-contrôle du DÉPISTAGE — sans agent, sans décor, sans réseau.
 *
 * Le dépistage décide de ce qu'on rejoue et de ce qu'on croit sur parole : s'il
 * se trompe, il coûte soit des runs inutiles, soit une régression déclarée
 * stable. Les quatre règles qu'il porte sont donc éprouvées ici une par une, y
 * compris dans le sens où elles doivent MORDRE :
 *
 *  1. unanimité — 2/3 n'est pas un PASS ;
 *  2. asymétrie — une remontée (FAIL → PASS) se rejoue autant qu'une chute ;
 *  3. décor — modèle, nature du décor ou agent différents → REFUS, pas alerte ;
 *  4. fusion — enregistrer trois tâches n'efface pas les vingt-deux autres.
 *
 *   node lib/reference.selftest.mjs
 *   node lib/reference.selftest.mjs --prove   # ← et surtout : le voir ROUGE
 *
 * `--prove` DÉBRANCHE chaque règle à tour de rôle (dans une COPIE du module,
 * jamais dans le dépôt) et exige que ce contrôle tombe. Sans lui, on ne saurait
 * pas si ces cas passent parce que le module a raison ou parce qu'ils ne
 * mordent sur rien.
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Le module éprouvé est paramétrable : `--prove` relance ce même fichier sur
// des copies mutées. Une seule liste de cas, donc — la faire diverger ferait
// « prouver » à la mutation un contrôle qui n'est pas celui qu'on exécute.
const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./reference.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  comparerDecor,
  depister,
  fusionnerReference,
  NON_JUGEABLE,
  verdictAgrege,
} = await import(MODULE);

let defauts = 0;
const echec = (msg) => {
  defauts += 1;
  console.log(`  ❌ ${msg}`);
};

// ─── 1. Unanimité ──────────────────────────────────────────────────────────
console.log("• verdict agrégé — PASS seulement à l'unanimité");
for (const cas of [
  { v: ["PASS", "PASS", "PASS"], verdict: "PASS", stable: true },
  { v: ["PASS", "PASS", "FAIL"], verdict: "FAIL", stable: false },
  { v: ["FAIL", "PASS", "PASS"], verdict: "FAIL", stable: false },
  { v: ["FAIL", "FAIL", "FAIL"], verdict: "FAIL", stable: true },
  { v: ["PASS"], verdict: "PASS", stable: true },
]) {
  const r = verdictAgrege(cas.v);
  if (r.verdict !== cas.verdict || r.stable !== cas.stable) {
    echec(
      `${cas.v.join("/")} → ${r.verdict} (stable=${r.stable}), ` +
        `attendu ${cas.verdict} (stable=${cas.stable})`,
    );
  }
}
// Un verdict sans run n'existe pas — mieux vaut jeter que rendre "FAIL".
try {
  verdictAgrege([]);
  echec("aucun run devrait jeter, et rend un verdict");
} catch {
  /* attendu */
}

console.log("• un run NON JUGEABLE est écarté, jamais compté");
// Le cas qui a fabriqué un faux FAIL de référence : une gate rejouée sur l'app
// d'aujourd'hui rougit, et deux runs propres disaient PASS.
const ecarte = verdictAgrege([NON_JUGEABLE, "PASS", "PASS"]);
if (ecarte.verdict !== "PASS" || ecarte.total !== 2 || ecarte.ecartes !== 1) {
  echec(
    `NON JUGEABLE/PASS/PASS → ${ecarte.verdict} sur ${ecarte.total} retenus ` +
      `(${ecarte.ecartes} écartés) — attendu PASS sur 2 (1 écarté)`,
  );
}
// Mais il n'absout pas : un rouge OPPOSABLE reste un FAIL.
if (verdictAgrege([NON_JUGEABLE, "FAIL", "PASS"]).verdict !== "FAIL") {
  echec("NON JUGEABLE ne doit pas effacer un FAIL réel");
}
// Aucun run jugeable → aucun verdict. Un trou, pas un échec.
const aucun = verdictAgrege([NON_JUGEABLE, NON_JUGEABLE]);
if (aucun.verdict !== NON_JUGEABLE || aucun.total !== 0) {
  echec(
    `tous écartés → ${aucun.verdict}/${aucun.total}, attendu NON JUGEABLE/0`,
  );
}

// ─── 2. Asymétrie + classement ─────────────────────────────────────────────
console.log("• dépistage — chute, remontée, instable, inconnue");
const ref = {
  model: "haiku",
  decor: "isolé",
  agent: "claude",
  verdicts: {
    10: { verdict: "PASS", runs: 3 },
    11: { verdict: "PASS", runs: 3 },
    12: { verdict: "FAIL", runs: 3 },
    13: { verdict: "FAIL", runs: 1 },
  },
};
const d = depister(ref, [
  { id: 10, verdict: "PASS", passes: 1, total: 1 }, // stable
  { id: 11, verdict: "FAIL", passes: 0, total: 1 }, // CHUTE
  { id: 12, verdict: "PASS", passes: 1, total: 1 }, // REMONTÉE (le piège)
  { id: 13, verdict: "FAIL", passes: 0, total: 1 }, // stable
  { id: 99, verdict: "PASS", passes: 1, total: 1 }, // INCONNUE
]);
const ids = (l) => l.map((r) => r.id).join(",");
if (ids(d.stables) !== "10,13")
  echec(`stables = ${ids(d.stables)}, attendu 10,13`);
if (ids(d.chutes) !== "11") echec(`chutes = ${ids(d.chutes)}, attendu 11`);
if (ids(d.remontees) !== "12")
  echec(`remontées = ${ids(d.remontees)}, attendu 12`);
if (ids(d.inconnues) !== "99")
  echec(`inconnues = ${ids(d.inconnues)}, attendu 99`);
// LE point de la règle : la remontée n'échappe pas au rejeu parce qu'elle fait
// plaisir. Si un jour elle disparaît de `aRejouer`, c'est ici que ça tombe.
if (!d.aRejouer.includes(12)) {
  echec("une remontée FAIL → PASS doit être rejouée (asymétrie)");
}
if (d.aRejouer.includes(10) || d.aRejouer.includes(13)) {
  echec(`aRejouer = ${d.aRejouer} — un stable ne se rejoue pas`);
}

console.log("• dépistage — un run déjà joué 3× ne se re-rejoue pas");
const d3 = depister(ref, [{ id: 11, verdict: "FAIL", passes: 0, total: 3 }]);
if (d3.aRejouer.length) {
  echec(
    `3 runs unanimes déjà faits → aRejouer devrait être vide (${d3.aRejouer})`,
  );
}
const dPartage = depister(ref, [
  { id: 10, verdict: "FAIL", passes: 2, total: 3 },
]);
if (!dPartage.instables.length || dPartage.chutes.length) {
  echec("2/3 doit se classer INSTABLE, pas chute");
}

// ─── 3. Décor — refus, pas avertissement ───────────────────────────────────
console.log("• décor — un écart REFUSE la comparaison");
for (const [champ, valeur] of [
  ["model", "sonnet"],
  ["decor", "lié au checkout (--link)"],
  ["agent", "vibe"],
]) {
  const run = {
    model: "haiku",
    decor: "isolé",
    agent: "claude",
    [champ]: valeur,
  };
  const c = comparerDecor(ref, run);
  if (c.compatible) echec(`écart sur ${champ} non détecté`);
  try {
    fusionnerReference(ref, { ...run, results: [], date: "x" });
    echec(`fusion acceptée malgré un écart sur ${champ}`);
  } catch {
    /* attendu */
  }
}
// Le commit, lui, DOIT pouvoir différer : c'est ce qu'on mesure.
const cCommit = comparerDecor(
  { ...ref, commit: "aaaa" },
  { model: "haiku", decor: "isolé", agent: "claude", commit: "bbbb" },
);
if (!cCommit.compatible) {
  echec("un commit différent ne doit PAS empêcher la comparaison");
}
// Une référence ancienne, sans le champ `agent`, reste comparable.
const { agent: _sansAgent, ...refAncienne } = ref;
if (
  !comparerDecor(refAncienne, {
    model: "haiku",
    decor: "isolé",
    agent: "claude",
  }).compatible
) {
  echec("un champ absent de la référence ne doit pas compter comme un écart");
}

// ─── 4. Fusion — n'efface pas ce qu'elle n'a pas mesuré ────────────────────
console.log("• fusion — les tâches non jouées survivent");
const fusionnee = fusionnerReference(ref, {
  model: "haiku",
  decor: "isolé",
  agent: "claude",
  date: "2026-08-01T00:00:00.000Z",
  commit: "cafe",
  results: [{ id: 12, verdict: "PASS", passes: 3, total: 3 }],
});
if (Object.keys(fusionnee.verdicts).length !== 4) {
  echec(`fusion : ${Object.keys(fusionnee.verdicts)} — 4 tâches attendues`);
}
if (
  fusionnee.verdicts["12"].verdict !== "PASS" ||
  fusionnee.verdicts["12"].runs !== 3
) {
  echec("fusion : la tâche mesurée n'a pas été mise à jour");
}
if (fusionnee.verdicts["10"].runs !== 3) {
  echec("fusion : une tâche non jouée a été altérée");
}
// Amorçage : sans référence préalable, la fusion écrit sans rien exiger.
const amorce = fusionnerReference(null, {
  model: "haiku",
  decor: "isolé",
  agent: "claude",
  date: "d",
  results: [{ id: 1, verdict: "FAIL", passes: 0, total: 2 }],
});
if (amorce.verdicts["1"].runs !== 2) echec("amorçage sans référence cassé");

console.log(
  defauts === 0
    ? "\n━━ unanimité, asymétrie, refus de décor et fusion non destructive : vérifiés"
    : `\n━━ ${defauts} DÉFAUT(S)`,
);

// ─── --prove : chaque règle débranchée doit faire TOMBER ce contrôle ────────
// Les mutations s'appliquent à une COPIE, dans un répertoire temporaire : muter
// le fichier du dépôt le laisserait cassé à la première interruption.
if (process.argv.includes("--prove") && MODULE === "./reference.mjs") {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "reference.mjs"), "utf8");
  const mutations = [
    {
      regle: "unanimité",
      de: 'verdict: passes === retenus.length ? "PASS" : "FAIL",',
      vers: 'verdict: passes > 0 ? "PASS" : "FAIL",',
    },
    {
      regle: "asymétrie (la remontée se rejoue)",
      de: "const aRejouer = [...chutes, ...remontees, ...instables, ...inconnues]",
      vers: "const aRejouer = [...chutes, ...instables, ...inconnues]",
    },
    {
      regle: "refus de décor",
      de: "return { compatible: ecarts.length === 0, ecarts };",
      vers: "return { compatible: true, ecarts };",
    },
    {
      regle: "run non jugeable écarté",
      de: "const retenus = verdicts.filter((v) => v !== NON_JUGEABLE);",
      vers: "const retenus = verdicts;",
    },
    {
      regle: "fusion non destructive",
      de: "const verdicts = { ...ref?.verdicts };",
      vers: "const verdicts = {};",
    },
  ];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-reference-prove-"));
  let muets = 0;
  console.log("\n━━ --prove : débranchement de chaque règle");
  for (const [i, m] of mutations.entries()) {
    // Une ancre qui ne mord plus est un débranchement NON EFFECTUÉ, pas une
    // règle prouvée : le taire rendrait un ✅ pour un geste jamais fait.
    if (!source.includes(m.de)) {
      console.log(
        `  ⚠️ ${m.regle} — ancre introuvable, DÉBRANCHEMENT NON FAIT`,
      );
      muets += 1;
      continue;
    }
    const copie = path.join(tmp, `reference-${i}.mjs`);
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
