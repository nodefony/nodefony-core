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
 *   node suivre-run.mjs                    # le run le plus récent
 *   node suivre-run.mjs <runDir>           # celui-là
 *   node suivre-run.mjs --session <dossier>  # une session INTERACTIVE (Codex)
 *   node suivre-run.mjs --tout             # sans filtre (déluge : tout outil, tout tour)
 *
 * `--session` suit un agent qu'un HUMAIN pilote dans `<dossier>`, hors du banc :
 * son journal est reconnu par le répertoire de travail qu'il déclare, et l'on
 * attend qu'il apparaisse — le suivi se lance avant l'agent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ATTENTE, PAR_NOM } from "./lib/transcript-dialectes.mjs";

const ARGV = process.argv.slice(2);
const TOUT = ARGV.includes("--tout");
const iSession = ARGV.indexOf("--session");
const SESSION = iSession === -1 ? null : (ARGV[iSession + 1] ?? null);
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
  claude: {
    dossier: [".claude", "projects"],
    motif: /\.jsonl$/,
    dialecte: "claude",
  },
};

/**
 * Les journaux d'une session INTERACTIVE, par binaire — une autre table, parce
 * qu'une autre clé : aucun run ne la nomme, c'est le `cwd` que le journal
 * déclare en tête qui la désigne. Rangés par date sous `dossier`, d'où la
 * descente récursive.
 */
const SESSIONS_INTERACTIVES = {
  codex: {
    dossier: [".codex", "sessions"],
    motif: /^rollout-.*\.jsonl$/,
    dialecte: "codex-session",
    cwdDe: (premiere) => JSON.parse(premiere)?.payload?.cwd,
  },
};

/** Les journaux sous `racine`, à toute profondeur. */
function journauxSous(racine, motif) {
  try {
    return fs
      .readdirSync(racine, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && motif.test(e.name))
      .map((e) => path.join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

/** Le journal le plus récent dont la session travaille dans `dossier`. */
function journalDeSession(spec, dossier, depuisMs) {
  const cible = path.resolve(dossier);
  const racine = path.join(os.homedir(), ...spec.dossier);
  return journauxSous(racine, spec.motif)
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .filter(({ m }) => m >= depuisMs)
    .sort((a, b) => b.m - a.m)
    .map(({ f }) => f)
    .find((f) => {
      try {
        const premiere = fs.readFileSync(f, "utf8").split("\n", 1)[0];
        return path.resolve(String(spec.cwdDe(premiere) ?? "")) === cible;
      } catch {
        return false;
      }
    });
}

/** Le run le plus récent, ou celui qu'on nomme. */
function resoudreRun() {
  const nomme = ARGV.find((a) => !a.startsWith("--") && a !== SESSION);
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

/**
 * Les lignes à afficher pour UNE ligne de journal.
 *
 * La lecture passe par la grammaire commune (`transcript-dialectes.mjs`) : ce
 * qu'un appel affiche de lui-même — commande, fichier, skill — est choisi là,
 * une seule fois pour ce lecteur et pour `analyse-transcript.mjs`. Une
 * attente (Codex) n'est pas un geste : elle ne s'affiche qu'en `--tout`, mais
 * l'échec qu'elle constate s'affiche toujours.
 *
 * @param {string} ligne
 * @param {string} dialecte - nom de la grammaire du journal suivi.
 */
function gestes(ligne, dialecte) {
  let evenement;
  try {
    evenement = JSON.parse(ligne);
  } catch {
    return [];
  }
  const out = [];
  for (const g of PAR_NOM[dialecte].gestes(evenement, 0)) {
    if (g.nature === "retour") {
      const exit = g.exit ?? null;
      if (exit !== null && exit !== 0) out.push(`    ✗ exit ${exit}`);
      continue;
    }
    if (g.nature !== "appel") continue;
    if (g.outil === ATTENTE && !TOUT) continue;
    const quoi = g.arg;
    if (!TOUT && g.outil !== "Skill" && !INTERESSANT.test(quoi)) continue;
    out.push(`  ${g.outil} · ${quoi.replace(/\s+/g, " ").slice(0, 130)}`);
  }
  return out;
}

/**
 * Suit UN journal à mesure qu'il s'écrit.
 *
 * La dernière ligne peut être un JSON À MOITIÉ ÉCRIT — l'agent écrit pendant
 * qu'on lit. On s'arrête avant elle et on la reprend au tour suivant.
 */
function suivre(journal, dialecte) {
  let position = 0;
  return () => {
    let lignes;
    try {
      lignes = fs.readFileSync(journal, "utf8").split("\n");
    } catch {
      return;
    }
    const sures = lignes.length - 1;
    for (let i = position; i < sures; i += 1)
      for (const l of gestes(lignes[i] ?? "", dialecte))
        process.stdout.write(`${l}\n`);
    position = Math.max(position, sures);
  };
}

if (SESSION !== null) {
  const agent = process.env.NF_DEVKIT_BENCH_AGENT ?? "codex";
  const spec = SESSIONS_INTERACTIVES[agent];
  if (!spec) {
    process.stdout.write(
      `Pas de session interactive lisible pour « ${agent} » — connus : ` +
        `${Object.keys(SESSIONS_INTERACTIVES).join(", ")}.\n`,
    );
    process.exit(64);
  }
  // Seules les sessions ouvertes À PARTIR d'ici (une minute de marge) : une
  // session plus ancienne dans le même dossier n'est pas celle qu'on attend.
  const depuis = Date.now() - 60_000;
  process.stdout.write(
    `┌ session ${path.resolve(SESSION)}\n` +
      `│ agent   ${agent} · en attente de son journal…\n` +
      `└ ⚠️  source d'OBSERVATION — rien ne se conclut d'ici.\n\n`,
  );
  let lire = null;
  const battement = setInterval(() => {
    if (lire === null) {
      const journal = journalDeSession(spec, SESSION, depuis);
      if (!journal) return;
      process.stdout.write(`── journal ${journal}\n`);
      lire = suivre(journal, spec.dialecte);
    }
    lire();
  }, 2000);
  process.on("SIGINT", () => {
    clearInterval(battement);
    process.stdout.write("\n■ suivi arrêté — la session, elle, continue.\n");
    process.exit(0);
  });
} else {
  suivreRun();
}

function suivreRun() {
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
  let lire = null;
  let repetition = 0;

  const battement = setInterval(() => {
    const journal = journalCourant(dossier, spec);
    if (!journal) return;
    if (journal !== dernier) {
      dernier = journal;
      lire = suivre(journal, spec.dialecte);
      repetition += 1;
      process.stdout.write(`── répétition ${repetition}\n`);
    }
    lire?.();
  }, 4000);

  process.on("SIGINT", () => {
    clearInterval(battement);
    process.stdout.write("\n■ suivi arrêté — le run, lui, continue.\n");
    process.exit(0);
  });
}
