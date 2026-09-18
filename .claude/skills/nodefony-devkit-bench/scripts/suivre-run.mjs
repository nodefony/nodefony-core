#!/usr/bin/env node
/**
 * Suit un run du banc PENDANT qu'il se joue, au lieu d'attendre son rapport.
 *
 * 🔴 **La source affichée ici n'est PAS celle du verdict.** Le banc lance
 * l'agent par `spawnSync` et capture sa sortie standard : elle n'existe qu'à la
 * FIN de la tâche, et c'est elle qui devient `task-<n>.transcript.jsonl`, donc
 * elle seule qui est jugée. Ce script lit une AUTRE source — le journal que
 * l'agent tient pour lui-même, écrit au fil de l'eau. Les deux se ressemblent ;
 * elles ne sont pas le même objet. Ne jamais brancher un juge là-dessus, et ne
 * jamais conclure d'ici qu'une sonde sera verte : le faire, c'est remplacer la
 * matière mesurée par une autre sans que rien ne le dise.
 *
 * Ce qu'on y gagne, mesuré sur une séance réelle :
 *   - éprouver un motif de sonde contre la matière RÉELLE avant de le figer,
 *     au lieu de l'écrire de tête et de payer un run pour découvrir qu'il rate ;
 *   - instruire un geste au moment où il tombe (« il vient d'effacer la base » —
 *     destruction, ou déplacement avec retour ?) plutôt qu'à l'autopsie ;
 *   - voir tôt qu'un run part de travers, et le tuer avant d'en payer trois.
 *
 * Usage :
 *   node suivre-run.mjs                 # le run le plus récent
 *   node suivre-run.mjs <runDir>        # celui-là
 *   node suivre-run.mjs --tout          # sans filtre (déluge : tout outil, tout tour)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ARGV = process.argv.slice(2);
const TOUT = ARGV.includes("--tout");
const RACINE_RUNS = path.join(os.tmpdir(), "nodefony-devkit-bench");

/**
 * Les journaux que l'agent écrit EN DIRECT, par binaire.
 *
 * Volontairement SÉPARÉ de `JOURNAUX_HORS_STDOUT` (`lib/journal-source.mjs`),
 * qui déclare d'où vient la matière JUGÉE. Fusionner les deux tables ferait
 * basculer le banc sur une source qu'il n'a jamais mesurée — la confusion que
 * l'en-tête met en garde, une ligne de code plus loin.
 *
 * `dossier` est relatif au foyer ; le sous-dossier de session porte le chemin du
 * projet encodé, qu'on ne DÉRIVE pas (l'encodage appartient à l'agent) : on
 * retient celui dont le nom contient le répertoire du run.
 */
const JOURNAUX_EN_DIRECT = {
  claude: { dossier: [".claude", "projects"], motif: /\.jsonl$/ },
};

/** Le run le plus récent, ou celui qu'on nomme. */
function resoudreRun() {
  const nomme = ARGV.find((a) => !a.startsWith("--"));
  if (nomme) return nomme;
  try {
    const runs = fs
      .readdirSync(RACINE_RUNS)
      .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
      .sort();
    const dernier = runs.at(-1);
    return dernier ? path.join(RACINE_RUNS, dernier) : null;
  } catch {
    return null;
  }
}

/** Le dossier de session de CE run — reconnu par sa marque, jamais dérivé. */
function dossierDeSession(runDir, agent) {
  const spec = JOURNAUX_EN_DIRECT[agent];
  if (!spec) return null;
  const racine = path.join(os.homedir(), ...spec.dossier);
  const marque = path.basename(runDir);
  if (!marque || !fs.existsSync(racine)) return null;
  const trouve = fs.readdirSync(racine).find((n) => n.includes(marque));
  return trouve ? path.join(racine, trouve) : null;
}

/** Le journal le plus récemment écrit — il change à chaque répétition. */
function journalCourant(dossier, spec) {
  try {
    return fs
      .readdirSync(dossier)
      .filter((n) => spec.motif.test(n))
      .map((n) => ({ n, m: fs.statSync(path.join(dossier, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map((e) => path.join(dossier, e.n))
      .at(0);
  } catch {
    return undefined;
  }
}

/**
 * Ce qui mérite une ligne à l'écran.
 *
 * Le filtre par défaut est SERRÉ, et c'est le sujet : une tâche fait 50 à 80
 * tours, trois répétitions en font deux cents. Tout afficher, c'est ne rien
 * lire. Ne passent que les gestes qui décident d'un verdict — un skill chargé,
 * une commande du framework, tout ce qui touche à une base.
 *
 * ⚠️ Viser `nodefony` tout court ne marche PAS : le décor VIT dans un chemin
 * qui porte ce mot (`…/nodefony-devkit-bench/…`), donc chaque lecture de
 * fichier le contient et tout passe. Le filtre vise la COMMANDE (`npx nodefony`,
 * `orm:<verbe>`), jamais le nom du projet — mesuré au premier essai, où il a
 * rendu le déluge qu’il existe pour éviter.
 */
const INTERESSANT =
  /\bnpx\s+nodefony\b|\borm:[a-z]|\brm\b|\bcp\b|sqlite3|var[/\\]databases|\.db\b|skills[/\\]nodefony-/i;

function gestes(ligne) {
  let evenement;
  try {
    evenement = JSON.parse(ligne);
  } catch {
    return [];
  }
  const contenu = evenement?.message?.content;
  if (!Array.isArray(contenu)) return [];
  const out = [];
  for (const bloc of contenu) {
    if (bloc?.type !== "tool_use") continue;
    const entree = bloc.input ?? {};
    const quoi =
      entree.command ??
      entree.skill ??
      entree.file_path ??
      entree.pattern ??
      "";
    if (!TOUT && bloc.name !== "Skill" && !INTERESSANT.test(String(quoi))) {
      continue;
    }
    out.push(
      `  ${bloc.name} · ${String(quoi).replace(/\s+/g, " ").slice(0, 130)}`,
    );
  }
  return out;
}

const runDir = resoudreRun();
if (!runDir || !fs.existsSync(runDir)) {
  process.stdout.write(
    `Aucun run trouvé. Donner son chemin, ou en lancer un.\n` +
      `  racine attendue : ${RACINE_RUNS}\n`,
  );
  process.exit(64);
}

const agent = process.env.NF_DEVKIT_BENCH_AGENT ?? "claude";
const dossier = dossierDeSession(runDir, agent);
if (!dossier) {
  // Ne rien suivre est un FAIT, pas une erreur à taire : l'agent n'écrit
  // peut-être aucun journal en direct, et l'attente serait sans fin.
  process.stdout.write(
    `Pas de journal en direct pour « ${agent} »${
      JOURNAUX_EN_DIRECT[agent]
        ? ` sous ${path.join(os.homedir(), ...JOURNAUX_EN_DIRECT[agent].dossier)}`
        : " — grammaire non déclarée"
    }.\n` +
      `Le rapport du run reste lisible à la fin :\n` +
      `  node analyse-transcript.mjs ${runDir}/rep-1/task-<n>.transcript.jsonl --timeline\n`,
  );
  process.exit(64);
}

process.stdout.write(
  `┌ run   ${runDir}\n` +
    `│ agent ${agent} · journal en direct\n` +
    `└ ⚠️  source d'OBSERVATION — le verdict, lui, est rendu sur la sortie\n` +
    `   standard capturée à la fin de chaque tâche. Ne pas conclure d'ici.\n\n`,
);

const spec = JOURNAUX_EN_DIRECT[agent];
let dernier = "";
let position = 0;
let repetition = 0;

const battement = setInterval(() => {
  const journal = journalCourant(dossier, spec);
  if (!journal) return;
  if (journal !== dernier) {
    dernier = journal;
    position = 0;
    repetition += 1;
    process.stdout.write(`── répétition ${repetition}\n`);
  }
  let lignes;
  try {
    lignes = fs.readFileSync(journal, "utf8").split("\n");
  } catch {
    return;
  }
  // La dernière ligne peut être un JSON À MOITIÉ ÉCRIT — l'agent écrit pendant
  // qu'on lit. On s'arrête avant elle et on la reprendra au tour suivant, une
  // fois complète ; `gestes` la rejetterait de toute façon sans le dire.
  const sures = lignes.length - 1;
  for (let i = position; i < sures; i += 1) {
    for (const ligne of gestes(lignes[i] ?? "")) {
      process.stdout.write(`${ligne}\n`);
    }
  }
  position = Math.max(position, sures);
}, 4000);

process.on("SIGINT", () => {
  clearInterval(battement);
  process.stdout.write("\n■ suivi arrêté — le run, lui, continue.\n");
  process.exit(0);
});
