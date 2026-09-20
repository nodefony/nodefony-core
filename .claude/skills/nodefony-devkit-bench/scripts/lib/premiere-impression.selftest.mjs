#!/usr/bin/env node
/**
 * Auto-contrôle du juge de première impression — sur des réponses FABRIQUÉES.
 *
 * Il ne lance aucun agent, et c'est le but : le juge doit être éprouvé AVANT de
 * payer un run. Les deux premiers cas sont des réponses RÉELLES, avant et après
 * les correctifs de l'accueil — c'est la paire qui a motivé ce banc, et un juge
 * qui ne les distingue pas ne mesure rien.
 *
 * 🔴 Le défaut que ce contrôle guette en priorité : un juge qui compte le SENS
 * du verdict. Le refus fondé sur un fait vrai est un succès ; le noter comme un
 * échec pousserait à taire les réserves du projet, donc à bien scorer en mentant.
 *
 *   node lib/premiere-impression.selftest.mjs
 *   node lib/premiere-impression.selftest.mjs --prove   # débranche chaque règle
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./premiere-impression.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  juger,
  mordSurLeDecor,
  MOTIFS_FAUX,
  extraireJson,
  decorDAvant,
  retirerLaDistinction,
} = await import(MODULE);

/** La réponse RÉELLE d'avant les correctifs — celle qui a motivé le banc. */
const AVANT =
  "Je ne partirais pas sur Nodefony pour un nouveau projet. Le problème n'est pas " +
  "que Nodefony soit mauvais. C'est plutôt que tu vas hériter de toute sa " +
  "complexité : migration 10.x, monorepo, CLI, ORM, Studio, nombreuses couches, " +
  "outillage IA, skills, conventions internes, branche dev. Pour un projet neuf, " +
  "cela représente un coût cognitif et technique important.";

/** La réponse RÉELLE d'après — mêmes questions, corpus corrigé. */
const APRES = `1. Nodefony est un framework Node.js fullstack en TypeScript strict où HTTP et
WebSocket partagent le même contexte de contrôleur, la même session et le même pare-feu.
2. Quatre dépendances de production : nodefony, @nodefony/http, @nodefony/framework, zod.
3. OUI — AGENTS.md renvoie aux jalons du dépôt, et compatibilite.md porte le contrat.
4. NON — préversion alpha publiée par un développeur solo bénévole, et seule la
dernière majeure reçoit des correctifs.`;

let defauts = 0;
const echec = (msg) => {
  defauts += 1;
  console.log(`  ❌ ${msg}`);
};
const ok = (msg) => console.log(`  ✅ ${msg}`);

console.log("━━ le juge distingue les deux réponses RÉELLES");
const avant = juger(AVANT);
const apres = juger(APRES);
if (avant.juste)
  echec("la réponse d'AVANT passe pour juste — le motif faux n'est pas vu");
else ok(`AVANT : motif faux vu (${avant.faux.map((f) => f.cause).join(", ")})`);
if (!apres.juste)
  echec(
    `la réponse d'APRÈS est jugée fausse (${apres.faux.map((f) => f.cause)})`,
  );
else ok("APRÈS : aucun motif faux");
if (apres.exactitude.points !== 3)
  echec(
    `APRÈS : ${apres.exactitude.points}/3 — manque ${apres.exactitude.manques.join(" · ")}`,
  );
else ok("APRÈS : 3/3 sur les faits attendus");

console.log("━━ le SENS du verdict ne compte pas");
if (apres.verdict !== "non")
  echec(`le verdict d'APRÈS devrait être « non », lu « ${apres.verdict} »`);
else if (!apres.juste) echec("un refus fondé est compté comme un échec");
else ok("un refus fondé sur des faits vrais reste JUSTE");
if (apres.vrais.length === 0)
  echec(
    "les motifs vrais ne sont pas relevés — le rapport ne dira pas que le refus est fondé",
  );
else ok(`motifs vrais relevés : ${apres.vrais.join(", ")}`);

console.log("━━ chaque motif faux est attrapé par une phrase qui le porte");
const PHRASES = {
  "herite-du-depot":
    "tu vas hériter du monorepo et de la migration, un coût important",
  "trop-de-dependances":
    "l'application installe trop de dépendances, vingt paquets",
  "doc-inatteignable": "la documentation n'est pas disponible hors ligne",
  "calendrier-absent": "aucun calendrier de sortie stable n'est publié",
};
for (const m of MOTIFS_FAUX) {
  const phrase = PHRASES[m.cause];
  if (!phrase) {
    echec(
      `aucune phrase d'épreuve pour la cause « ${m.cause} » — un motif non éprouvé peut être mort`,
    );
    continue;
  }
  const vu = juger(phrase).faux.some((f) => f.cause === m.cause);
  if (vu) ok(`${m.cause} : vu`);
  else echec(`${m.cause} : la phrase qui le porte n'est PAS attrapée`);
}

console.log("━━ une réponse saine ne déclenche aucun motif faux");
const SAINE =
  "Le framework met HTTP et WebSocket sur la même route. Une application minimale " +
  "porte quatre dépendances. Les jalons disent ce qui reste. OUI, ça vaut un essai.";
const saine = juger(SAINE);
if (saine.faux.length)
  echec(
    `faux positif sur une réponse saine : ${saine.faux.map((f) => f.cause)}`,
  );
else ok("aucun faux positif");

console.log("━━ le banc doit MORDRE sur le décor");
const mordant = mordSurLeDecor(apres, avant);
if (!mordant.mord)
  echec(`la comparaison sain/dégradé ne mord pas : ${mordant.pourquoi}`);
else ok(mordant.pourquoi);
const muet = mordSurLeDecor(apres, apres);
if (muet.mord)
  echec("deux verdicts IDENTIQUES sont annoncés comme une dégradation");
else ok("deux verdicts identiques ⇒ le banc se déclare muet");

console.log(
  "━━ la contre-épreuve RETIRE l'information, elle ne la déplace pas",
);
// 🔴 Ce cas existe parce que le banc, joué pour de vrai, n'a RIEN vu bouger : la
// contre-épreuve remontait la section « État » sans retirer la distinction, et
// l'agent retrouvait les mêmes faits dans le README. Une contre-épreuve qui
// réordonne rend un verdict de complaisance sur l'instrument lui-même.
const ACCUEIL = [
  "# AGENTS.md — dépôt",
  "",
  "Une phrase de rôle.",
  "",
  "---",
  "",
  "## Ce que fait le framework",
  "",
  "HTTP et WebSocket sur la même route.",
  "",
  "## Ce dépôt n'est pas ce qu'une application installe",
  "",
  "Quatre dépendances de production : nodefony, zod.",
  "",
  "## État",
  "",
  "Préversion alpha, une seule personne.",
  "",
  "## Carte du dépôt",
  "",
  "Des chemins.",
].join("\n");
const avantDecor = decorDAvant(ACCUEIL);
if (/d[ée]pendances de production/u.test(avantDecor))
  echec("le décor d'avant PORTE encore les dépendances — il ne dégrade rien");
else ok("le décor d'avant ne dit plus ce qu'une application installe");
if (avantDecor.indexOf("## État") > avantDecor.indexOf("## Ce que fait"))
  echec("l'état n'est pas remonté devant ce que fait le framework");
else ok("l'état repasse devant");
if (!avantDecor.includes("## Carte du dépôt"))
  echec("la mutation a perdu une section étrangère");
else ok("les autres sections restent");
// Une section renommée ne doit pas rendre la contre-épreuve MUETTE sans le dire.
const sansCible = retirerLaDistinction("# a\n\n## Rien de tel\n\ntexte");
if (sansCible !== "# a\n\n## Rien de tel\n\ntexte")
  echec("sans section cible, l'entrée devrait être rendue INCHANGÉE");
else ok("sans section cible ⇒ inchangé, et le banc le verra");

console.log("━━ le bloc JSON est lu, et c'est le DERNIER qui compte");
const deuxBlocs =
  'exemple : {"q4":{"verdict":"OUI"}} … ma réponse : {"q4":{"verdict":"NON"}}';
const lu = extraireJson(deuxBlocs);
if (lu?.q4?.verdict !== "NON")
  echec(`le dernier bloc n'est pas retenu (lu : ${JSON.stringify(lu)})`);
else ok("le dernier bloc équilibré est retenu");
if (extraireJson("aucun objet ici") !== null)
  echec("un texte sans JSON devrait rendre null");
else ok("texte sans JSON ⇒ null, et le texte entier sera jugé");

if (process.argv.includes("--prove")) {
  console.log(
    "━━ --prove : chaque règle, débranchée, doit faire tomber ce contrôle",
  );
  const mutations = [
    {
      regle: "le motif « hérite du dépôt »",
      de: /cause: "herite-du-depot"/,
      vers: 'cause: "herite-du-depot-DEBRANCHE"',
    },
    {
      regle: "le relevé des motifs vrais",
      de: /export const MOTIFS_VRAIS = \[/,
      vers: "export const MOTIFS_VRAIS = [].concat([",
    },
  ];
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const source = readFileSync(
    path.join(ICI, "premiere-impression.mjs"),
    "utf8",
  );
  let muets = 0;
  for (const m of mutations) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-prove-"));
    const cible = path.join(dir, "premiere-impression.mjs");
    const mute = source.replace(m.de, m.vers);
    if (mute === source) {
      console.log(
        `  ❌ ${m.regle} — la mutation n'a RIEN changé : elle ne prouve rien`,
      );
      muets += 1;
      continue;
    }
    writeFileSync(cible, mute);
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--module", cible],
      {
        encoding: "utf8",
      },
    );
    const mord = r.status !== 0;
    if (!mord) muets += 1;
    console.log(
      `  ${mord ? "✅" : "❌"} ${m.regle} → ce contrôle sort ${r.status}${mord ? "" : "  (IL NE MORD PAS)"}`,
    );
  }
  console.log(
    muets === 0
      ? `━━ les ${mutations.length} règles sont VUES rouges quand on les débranche`
      : `━━ ${muets} règle(s) NON PROUVÉE(S)`,
  );
  process.exit(defauts || muets ? 1 : 0);
}

console.log(
  defauts
    ? `━━ ${defauts} défaut(s)`
    : "━━ le juge distingue tout ce qu'il doit distinguer",
);
process.exit(defauts ? 1 : 0);
