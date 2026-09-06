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
  deriveTours,
  empreinteTache,
  fichiersDuVerdict,
  fusionnerReference,
  medianeTours,
  NON_JUGEABLE,
  PLANCHER_DERIVE_TOURS,
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

console.log("• dépistage — un énoncé RÉÉCRIT ne se compare pas");
// La tâche 26 a changé de route en cours de session : tout ce que l'agent doit
// écrire en dépend. Sans ce classement, le dépistage aurait annoncé une chute
// ou une remontée en comparant deux réponses à deux questions différentes.
const refEmpreinte = {
  model: "haiku",
  decor: "isolé",
  agent: "claude",
  verdicts: { 26: { verdict: "FAIL", runs: 3, empreinte: "aaaaaaaaaaaa" } },
};
const dReecrit = depister(refEmpreinte, [
  { id: 26, verdict: "PASS", passes: 1, total: 1, empreinte: "bbbbbbbbbbbb" },
]);
if (!dReecrit.modifiees.length || dReecrit.remontees.length) {
  echec("un énoncé réécrit doit se classer MODIFIÉ, jamais en remontée");
}
if (!dReecrit.aRejouer.includes(26)) {
  echec("un énoncé réécrit doit être rejoué — sa référence ne vaut plus");
}
// Empreinte identique → comparaison normale. Et une référence ANCIENNE, écrite
// avant que l'empreinte existe, reste comparable : on ne périme pas tout un
// fichier de mesures pour un champ ajouté après coup.
const dMeme = depister(refEmpreinte, [
  { id: 26, verdict: "PASS", passes: 1, total: 1, empreinte: "aaaaaaaaaaaa" },
]);
if (!dMeme.remontees.length)
  echec("même empreinte → la comparaison doit avoir lieu");
const dSansEmpreinte = depister(
  { ...refEmpreinte, verdicts: { 26: { verdict: "FAIL", runs: 3 } } },
  [{ id: 26, verdict: "PASS", passes: 1, total: 1, empreinte: "bbbbbbbbbbbb" }],
);
if (!dSansEmpreinte.remontees.length) {
  echec(
    "référence sans empreinte → comparaison maintenue, pas de faux « modifié »",
  );
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

// ─── 7. La MÉDIANE de tours — ce que le verdict binaire jette ─────────────
console.log("• médiane de tours — jamais le dernier run, jamais la moyenne");
// Les trois runs RÉELS de la tâche 13 : le dernier seul dirait 88 et
// raconterait une tâche deux fois plus lourde qu'elle n'est.
if (medianeTours([{ tours: 52 }, { tours: 54 }, { tours: 88 }]) !== 54) {
  echec("52/54/88 → médiane attendue 54");
}
// La moyenne vaudrait 64,7 : un run parti en boucle la tirerait à lui seul.
if (medianeTours([{ tours: 10 }, { tours: 12 }, { tours: 400 }]) !== 12) {
  echec("10/12/400 → médiane attendue 12 (la moyenne serait 141)");
}
// Nombre PAIR de runs : la moyenne des deux du milieu, arrondie.
if (medianeTours([{ tours: 52 }, { tours: 55 }]) !== 54) {
  echec("52/55 → médiane attendue 54");
}
// Rien de mesuré → rien d'inventé. Un 0 se comparerait ensuite comme un chiffre.
if (medianeTours([]) !== null || medianeTours([null, {}]) !== null) {
  echec("sans mesure, la médiane doit être null — jamais 0");
}

console.log("• dérive de tours — signalée au-delà du seuil, muette en dessous");
// Le cas qui justifie tout : le verdict ne bouge pas, l'effort si.
const alourdie = deriveTours(54, 88);
if (!alourdie.signale || alourdie.sens !== "alourdie") {
  echec(
    `54→88 tours devrait être signalé « alourdie », rendu ${alourdie.sens}`,
  );
}
const allegee = deriveTours(88, 54);
if (!allegee.signale || allegee.sens !== "allegee") {
  echec(`88→54 tours devrait être signalé « allegee », rendu ${allegee.sens}`);
}
// Sous le seuil relatif : du bruit de modèle non déterministe, pas un signal.
if (deriveTours(50, 55).signale) {
  echec("50→55 tours (+10 %) est du bruit, il ne doit rien signaler");
}
// Sous le PLANCHER absolu : +50 % pour deux tours d'écart ne dit rien.
if (deriveTours(4, 6).signale) {
  echec("4→6 tours est sous le plancher absolu, il ne doit rien signaler");
}
// Mais franchir le plancher par le haut reste un signal.
if (!deriveTours(7, PLANCHER_DERIVE_TOURS * 3).signale) {
  echec("7→24 tours franchit le plancher et doit être signalé");
}
// Sans référence mesurée, aucune dérive : on ne compare pas à rien.
if (deriveTours(null, 88).signale || deriveTours(54, null).signale) {
  echec("une dérive sans les deux bornes ne se signale pas");
}

console.log("• le dépistage classe les dérives SANS les rejouer");
const bilanDerive = depister(
  { verdicts: { 13: { verdict: "FAIL", runs: 3, passes: 0, tours: 88 } } },
  [{ id: 13, verdict: "FAIL", passes: 0, total: 3, tours: 54 }],
);
if (bilanDerive.allegees.length !== 1) {
  echec(
    "une tâche au verdict stable mais allégée doit être classée « allegee »",
  );
}
// LA règle qui compte : elle ne coûte RIEN. La rejouer rendrait au dépistage le
// coût qu'il existe précisément pour éviter.
if (bilanDerive.aRejouer.length !== 0) {
  echec("une dérive de tours ne se rejoue pas — elle se regarde");
}

// La référence GARDE la médiane : sans elle, plus rien à comparer au run suivant.
const refAvecTours = fusionnerReference(null, {
  model: "m",
  decor: "d",
  agent: "a",
  date: "2026-01-01",
  commit: "abc",
  sources: ["run"],
  results: [{ id: 13, verdict: "FAIL", passes: 2, total: 3, tours: 54 }],
});
if (refAvecTours.verdicts["13"].tours !== 54) {
  echec("la référence doit garder la médiane de tours");
}

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
      de: "    ...remontees,\n",
      vers: "",
    },
    {
      regle: "énoncé réécrit → non comparable",
      de: "if (ref0?.empreinte && r.empreinte && ref0.empreinte !== r.empreinte) {",
      vers: "if (false) {",
    },
    {
      // L'état exact d'AVANT ce correctif : l'empreinte ignorait le code des
      // juges. Trois juges corrigés et un mort cinq jours n'avaient invalidé
      // aucune référence.
      regle: "le CODE du juge entre dans l'empreinte",
      de: "    sondes,\n    juges,\n",
      vers: "    sondes,\n",
    },
    {
      // Sans la coupe au repère `.claude/`, l'empreinte porte la racine de la
      // machine — et un dépôt cloné ailleurs voit toutes ses tâches « réécrites ».
      regle: "l'empreinte ne dépend pas de la racine du dépôt",
      de: '.replace(/(?:[A-Za-z]:)?\\/[^\\s"\'`]*?(\\.claude\\/)/gu, "<repo>/$1")',
      vers: "",
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
      regle: "médiane (et non dernier run / moyenne)",
      de: "  const milieu = Math.floor(tours.length / 2);",
      vers: "  const milieu = tours.length - 1;",
    },
    {
      regle: "seuil de dérive (le bruit ne se signale pas)",
      de: "  if (Math.abs(ecart) < SEUIL_DERIVE_TOURS) return muet;",
      vers: "  if (false) return muet;",
    },
    {
      regle: "plancher absolu de dérive",
      // Ancre SANS mise en forme : la précédente citait la ligne entière, `return`
      // et indentation compris — un passage de prettier l'a coupée en deux, et le
      // débranchement ne se faisait plus. Le selftest le disait (« ancre
      // introuvable »), mais la règle n'était plus prouvée pour autant. Une ancre
      // de mutation vise l'EXPRESSION, jamais la ligne.
      de: "avant < PLANCHER_DERIVE_TOURS && apres < PLANCHER_DERIVE_TOURS",
      vers: "false",
    },
    {
      regle: "une dérive ne se REJOUE pas",
      de: "      stables.push(entree);",
      vers: "      stables.push(entree);\n      chutes.push(entree);",
    },
    {
      regle: "la référence garde la médiane",
      de: "      tours: r.tours ?? null,",
      vers: "",
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

// ─── 8. L'EMPREINTE couvre ce qui rend le verdict, et ne dépend pas de la machine
// 🔴 Elle ne couvrait que l'énoncé, le `prepare` et les NOMS des sondes. Corriger
// un juge n'invalidait donc rien : trois juges qui punissaient une protection
// légitime ont été corrigés, un quatrième était mort cinq jours, et pas une
// référence n'a bougé — on opposait des verdicts rendus par un juge disparu.
console.log("\n• empreinte — le CODE du juge en fait partie");
{
  const { existsSync, mkdirSync, rmSync } = await import("node:fs");
  const ICI = path.dirname(fileURLToPath(import.meta.url));
  // Un juge à NOUS, dans le dossier où l'empreinte va le chercher. Créer un
  // fichier plutôt que muter un juge réel : un selftest ne touche pas au produit.
  const NOM = `tmp-juge-selftest-${process.pid}.mjs`;
  const CHEMIN = path.join(ICI, NOM);
  const tache = {
    prompt: "énoncé figé",
    prepare: "npm run build",
    probes: [
      {
        kind: "gate",
        name: "un fait quelconque",
        cmd: ["sh", "-c", `node ${CHEMIN}; exit $?`],
      },
    ],
  };
  try {
    writeFileSync(CHEMIN, "export const SEUIL = 1;\n");
    const avant = empreinteTache(tache);

    if (!fichiersDuVerdict(tache).includes(NOM))
      echec(`le juge ${NOM} n'est pas reconnu comme fichier du verdict`);

    // Le geste exact que l'énoncé demande : toucher UNE ligne du juge.
    writeFileSync(CHEMIN, "export const SEUIL = 2;\n");
    const apres = empreinteTache(tache);
    if (apres === avant)
      echec(
        "toucher le code du juge ne change PAS l'empreinte — la référence " +
          "continuerait d'opposer des verdicts d'un juge qui n'existe plus",
      );

    // Un COMMENTAIRE seul compte aussi : refuser à tort coûte un run nommé,
    // comparer à tort coûte la mesure entière et ne se voit pas.
    writeFileSync(CHEMIN, "// note\nexport const SEUIL = 2;\n");
    if (empreinteTache(tache) === apres)
      echec("un commentaire ajouté au juge laisse l'empreinte inchangée");

    // Mais une simple REMISE EN FORME ne doit rien invalider : sinon un passage
    // du formateur ferait repayer toutes les tâches.
    writeFileSync(CHEMIN, "// note\n\n\nexport const SEUIL   =   2;\n");
    if (empreinteTache(tache) !== empreinteTache(tache))
      echec("l'empreinte n'est pas déterministe");

    // Restauration : l'empreinte doit REVENIR. Une empreinte qui ne revient pas
    // dépendrait d'autre chose que du contenu.
    writeFileSync(CHEMIN, "export const SEUIL = 1;\n");
    if (empreinteTache(tache) !== avant)
      echec("l'empreinte ne revient pas quand le juge est restauré");
  } finally {
    if (existsSync(CHEMIN)) rmSync(CHEMIN, { force: true });
  }

  // Une référence est VERSIONNÉE : elle doit valoir pour qui la relit ailleurs.
  // Mesuré avant correction : la même tâche rendait deux empreintes selon la
  // racine du dépôt, et le dépistage aurait annoncé « tâche réécrite » sur un
  // dépôt simplement cloné sous un autre chemin.
  const mk = (prefixe) => ({
    prompt: "énoncé figé",
    prepare: `node ${prefixe} && npm run build`,
    probes: [{ name: "a" }],
  });
  const racines = [
    "/Users/qui/repo/.claude/skills/s/scripts/lib/prep.mjs",
    "/home/runner/work/repo/repo/.claude/skills/s/scripts/lib/prep.mjs",
    "D:\\a\\repo\\.claude\\skills\\s\\scripts\\lib\\prep.mjs",
  ].map((r) => empreinteTache(mk(r)));
  if (new Set(racines).size !== 1)
    echec(
      `l'empreinte dépend de la racine du dépôt : ${racines.join(" ≠ ")} — ` +
        "une référence versionnée doit valoir sur les trois plateformes",
    );

  // Et le SOURCE d'une sonde de lecture compte : deux `observe` différents sous
  // le même nom jugeaient la même chose aux yeux de l'empreinte.
  const avecObserve = (fn) => ({
    prompt: "énoncé figé",
    probes: [{ name: "identique", observe: fn }],
  });
  if (
    empreinteTache(avecObserve(() => true)) ===
    empreinteTache(avecObserve(() => false))
  )
    echec(
      "deux `observe` différents sous le même nom rendent la même empreinte",
    );

  if (defauts === 0)
    console.log(
      "  ✓ juge touché → empreinte changée · restauré → revenue · " +
        "3 racines → 1 empreinte · `observe` distingué",
    );
}

process.exit(defauts ? 1 : 0);
