/**
 * Auto-contrôle du juge de la TÂCHE 0 — les quatre issues se distinguent-elles ?
 *
 * La raison d'être de ce juge est de SÉPARER quatre issues que rien d'autre ne
 * distingue. Un auto-contrôle qui se contenterait de vérifier « rouge quand
 * c'est mauvais » ne prouverait donc rien : ce qu'il faut éprouver, c'est que
 * chaque situation rend EXACTEMENT sa cause, et pas celle d'à côté.
 *
 * La règle est jouée sur `classerIssue`, qui est PURE — aucun décor, aucun
 * réseau, quelques millisecondes. Le banc a déjà payé des juges dont la règle ne
 * se vérifiait qu'en les jouant : un était mort depuis cinq jours.
 *
 * `--prove` mute le vrai module et exige que ce contrôle TOMBE.
 *
 * Usage : `node lib/gate-tache-zero.selftest.mjs [--prove]`
 * Sorties : `0` toutes les issues distinguées · `1` au moins un écart.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./gate-tache-zero.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const { classerIssue } = await import(MODULE);

const PROVE =
  process.argv.includes("--prove") && MODULE === "./gate-tache-zero.mjs";
let verts = 0;
const rouges = [];

/** Les faits d'une application irréprochable — chaque cas n'en change qu'un. */
const PARFAIT = Object.freeze({
  resolution: { ok: true, dir: "/vide/ma-messagerie" },
  demarre: true,
  testsLivres: { lances: true, verts: true, nb: 10, sortie: "" },
  statutAnonyme: 401,
  statutAdmin: 200,
});

/**
 * @param {string} nom - la situation jouée.
 * @param {object} faits - les faits, dérivés de PARFAIT.
 * @param {{code: number, cause: string, issue: string}} attendu - la table du juge.
 */
function situation(nom, faits, attendu) {
  const v = classerIssue({ ...PARFAIT, ...faits });
  if (
    v.code === attendu.code &&
    v.cause === attendu.cause &&
    v.issue === attendu.issue
  ) {
    verts += 1;
    return;
  }
  rouges.push(
    `${nom} → attendu ${attendu.code}/${attendu.cause} (issue ${attendu.issue}), ` +
      `obtenu ${v.code}/${v.cause} (issue ${v.issue})`,
  );
}

// ── Issue A — le cas conforme ────────────────────────────────────────────────
situation("tout est en ordre", {}, { code: 0, cause: "conforme", issue: "A" });

// Le refus opposé à l'anonyme vaut 401 OU 403 : exiger l'un recalerait un agent
// selon la zone où il a rangé sa route, ce qu'on ne mesure pas.
situation(
  "anonyme refusé en 403 (zone avec authentificateur anonyme)",
  { statutAnonyme: 403 },
  { code: 0, cause: "conforme", issue: "A" },
);
situation(
  "la ressource rend 204 à l'administrateur",
  { statutAdmin: 204 },
  { code: 0, cause: "conforme", issue: "A" },
);

// ── Issue D — n'a pas abouti ─────────────────────────────────────────────────
situation(
  "aucune application créée",
  {
    resolution: { ok: false, cause: "aucune-application", detail: "rien" },
    demarre: null,
    testsLivres: null,
    statutAnonyme: null,
    statutAdmin: null,
  },
  { code: 1, cause: "aucune-application", issue: "D" },
);

situation(
  "l'application existe mais ne démarre pas",
  { demarre: false },
  { code: 3, cause: "application-ne-demarre-pas", issue: "D" },
);

situation(
  "la ressource demandée n'a jamais été montée",
  { statutAnonyme: 404 },
  { code: 6, cause: "ressource-absente", issue: "D" },
);

// ── Issue C — a fait ce qu'on demandait ET cassé l'existant ──────────────────
// 🔴 LE cas qui justifie ce juge. Le 2026-09-12 : zone /api fermée en entier,
// dix tests livrés emportés, aucune mention dans le compte rendu de l'agent.
situation(
  "les tests LIVRÉS ne passent plus (zone /api fermée en entier)",
  { testsLivres: { lances: true, verts: false, nb: 10, sortie: "10 failed" } },
  { code: 5, cause: "tests-livres-casses", issue: "C" },
);

// L'ordre EST la règle : l'issue C se juge AVANT la protection. Un agent dont la
// route est impeccable mais qui a cassé la suite livrée a échoué — l'inverse
// laisserait passer un vert sur une application amputée.
situation(
  "tests livrés cassés ET ressource parfaite ⇒ C l'emporte",
  {
    testsLivres: { lances: true, verts: false, nb: 10, sortie: "" },
    statutAnonyme: 401,
    statutAdmin: 200,
  },
  { code: 5, cause: "tests-livres-casses", issue: "C" },
);

// ── Issue B — juste, mais inappelable ────────────────────────────────────────
// L'échec du 2026-09-10 : 33 min sur une route qu'aucune identité ne pouvait
// appeler. Rien ne la distingue d'une protection réussie SAUF l'identité.
situation(
  "la ressource refuse aussi le porteur du rôle",
  { statutAdmin: 403 },
  { code: 8, cause: "ressource-inappelable", issue: "B" },
);
situation(
  "la ressource refuse le porteur en 401",
  { statutAdmin: 401 },
  { code: 8, cause: "ressource-inappelable", issue: "B" },
);

// ── Protection absente ───────────────────────────────────────────────────────
situation(
  "un anonyme est servi",
  { statutAnonyme: 200 },
  { code: 10, cause: "ressource-ouverte-a-l-anonyme", issue: "A-manquée" },
);

// ── L'INSTRUMENT, jamais l'agent ─────────────────────────────────────────────
// Deux candidats : on refuse de trancher. Imputer ce cas à l'agent serait
// l'accuser d'une panne du banc — mode de défaillance n° 1 de ce banc.
situation(
  "deux applications candidates ⇒ instrument, verdict non rendu",
  {
    resolution: { ok: false, cause: "application-ambigue", detail: "a, b" },
    demarre: null,
    testsLivres: null,
    statutAnonyme: null,
    statutAdmin: null,
  },
  { code: 2, cause: "application-ambigue", issue: "instrument" },
);

// Frontière livré/ajouté illisible : on ne compte PAS l'issue C, on ne l'invente
// pas non plus — le juge poursuit sur ce qu'il peut mesurer.
situation(
  "tests livrés non mesurables ⇒ ne fabrique pas un rouge",
  { testsLivres: { lances: false, verts: true, nb: 0, sortie: "pas de git" } },
  { code: 0, cause: "conforme", issue: "A" },
);

// ── --prove : muter le vrai module, exiger que ce contrôle TOMBE ─────────────
if (PROVE) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "gate-tache-zero.mjs"), "utf8");
  const mutations = [
    {
      // Sans cette priorité, une application amputée de ses tests livrés sort
      // VERTE dès que la route de l'agent est correcte.
      regle: "l'issue C se juge AVANT la protection",
      de: "  if (testsLivres && testsLivres.lances && !testsLivres.verts) {",
      vers: "  if (false) {",
    },
    {
      // Confondre B (inappelable) avec A (conforme) efface l'échec du 09-10.
      regle: "l'administrateur doit obtenir un SUCCÈS",
      de: "  if (!estSucces(statutAdmin)) {",
      vers: "  if (false) {",
    },
    {
      // Exiger 401 recalerait un agent selon la zone où il range sa route.
      regle: "le refus anonyme vaut 401 OU 403",
      de: "  if (!estRefus(statutAnonyme)) {",
      vers: "  if (statutAnonyme !== 401) {",
    },
    {
      // Imputer l'ambiguïté à l'agent, c'est l'accuser d'une panne du banc.
      regle: "l'ambiguïté est imputée à l'INSTRUMENT",
      de: '    return resolution.cause === "application-ambigue"',
      vers: "    return false",
    },
  ];

  console.log(
    "\n━━ --prove : mutation de chaque règle (le contrôle doit TOMBER)",
  );
  const tmp = mkdtempSync(path.join(os.tmpdir(), "gtz-prove-"));
  const moi = fileURLToPath(import.meta.url);
  for (const m of mutations) {
    if (!source.includes(m.de)) {
      rouges.push(
        `[--prove] ancre introuvable pour « ${m.regle} » — mutation MORTE`,
      );
      continue;
    }
    const copie = path.join(tmp, `gate-tache-zero.${mutations.indexOf(m)}.mjs`);
    // La copie vit hors du dossier `lib/` : ses imports relatifs doivent
    // continuer de résoudre. On la pose donc À CÔTÉ de l'original.
    const voisine = path.join(ici, `.prove-${path.basename(copie)}`);
    writeFileSync(voisine, source.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [moi, "--module", voisine], {
      encoding: "utf8",
    });
    spawnSync("rm", ["-f", voisine]);
    if (r.status === 0) {
      rouges.push(`[--prove] « ${m.regle} » mutée : RIEN n'est tombé`);
      console.log(`  ❌ ${m.regle} — le contrôle reste vert, il ne garde rien`);
    } else {
      verts += 1;
      console.log(`  ✅ ${m.regle} — le contrôle tombe`);
    }
  }
}

console.log(
  rouges.length === 0
    ? `✅ gate-tache-zero.selftest — ${verts} cas, les quatre issues se distinguent`
    : `❌ gate-tache-zero.selftest — ${rouges.length} écart(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
