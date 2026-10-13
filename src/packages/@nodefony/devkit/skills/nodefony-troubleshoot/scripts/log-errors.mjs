#!/usr/bin/env node
/**
 * Extrait les erreurs du journal d'une application Nodefony — regroupées, datées, avec le geste qui suit.
 *
 * Un journal de développement fait vite des milliers de lignes, dont l'immense
 * majorité dit que tout va bien. Le lire en entier noie l'erreur ; le couper
 * (`tail`) la coupe aussi, sans le dire. Ce script lit TOUT, ne garde que les
 * sévérités qui comptent, recolle une pile d'appels à la ligne qui l'a levée,
 * fusionne les répétitions, et nomme le premier geste quand il le connaît.
 *
 * Il lit les deux formes que le framework écrit dans `logs/` : le texte
 * (`nodefony-detached.log` d'un serveur lancé avec `--detach`, `nodefony-<pid>.log`
 * du pilote fichier, ou tout fichier où tu as redirigé la sortie) et le JSON par
 * ligne (`nodefony-<pid>.jsonl`). Un plantage brut de Node — `SyntaxError: …`
 * hors du format du journal — est reconnu aussi.
 *
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs logs/dev.log
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs --warnings --last 40
 * `@option` --warnings - garde aussi les avertissements (WARNING)
 * `@option` --last - nombre d'erreurs distinctes rendues, les plus récentes (défaut 15)
 * `@option` --json - la même réponse, sérialisée, pour rechaîner
 * `@option` --root - racine du projet (défaut : le dossier courant)
 * `@output` les erreurs distinctes, de la plus ancienne à la plus récente, avec fichier, heure, nombre et piste
 *
 * Sorties : `0` aucune erreur · `1` au moins une erreur · `64` usage · `66` aucun journal lisible.
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { findProjectRoot } from "nodefony";

/**
 * Racine de l'APPLICATION vue depuis `cwd` — le dossier qui porte
 * `nodefony.config.ts` —, ou `cwd` lui-même hors application. Un script lancé
 * depuis `frontend/` ou `modules/blog/` travaille ainsi sur l'app entière.
 * Une seule définition de « où commence l'app » : `findProjectRoot` du cœur.
 *
 * @param {string} cwd - le dossier de lancement.
 * @returns {string} la racine retenue.
 */
const appRoot = (cwd) => findProjectRoot(cwd) ?? cwd;

/** Erreurs distinctes rendues par défaut — au-delà, personne ne lit. */
const DEFAULT_LAST = 15;

/** Octets relus depuis la FIN d'un journal : un journal de plusieurs Go ne doit pas saturer la mémoire. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/** Sévérités du journal (RFC 5424), de la plus grave à la plus anodine. */
const SEVERITY = {
  EMERGENCY: 0,
  ALERT: 1,
  CRITIC: 2,
  ERROR: 3,
  WARNING: 4,
  NOTICE: 5,
  INFO: 6,
  DEBUG: 7,
};

/** Codes ANSI de couleur : le journal texte en porte quand il est écrit pour un terminal. */
const ANSI = /\u001b\[[0-9;]*m/gu;

/** Une ligne du journal texte : `HH:MM:SS.mmm SÉVÉRITÉ MSGID : message`. */
const PDU_LINE =
  /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+(EMERGENCY|ALERT|CRITIC|ERROR|WARNING|NOTICE|INFO|DEBUG)\s+(.+?)\s+:\s?(.*)$/u;

/** Une erreur levée HORS du journal — le plantage brut que Node écrit lui-même. */
const RAW_ERROR =
  /^(?:Uncaught )?((?:[A-Z][A-Za-z]*)?Error)(?: \[[A-Z_]+\])?: (.+)$/u;

/** Une ligne de pile d'appels, rattachée à l'erreur qui la précède. */
const STACK_LINE = /^\s+at\s/u;

/**
 * Ce que le message dit, et le premier geste qui en découle.
 *
 * Seulement des causes ÉTABLIES : une piste fausse coûte plus qu'aucune piste,
 * parce qu'on la suit. Ce qui n'est pas ici se lit dans le message lui-même.
 */
const HINTS = [
  {
    when: /does not provide an export named/u,
    hint: "un `dist/` en retard sur les sources, ou deux copies de `nodefony` : `npm run build`, puis `npm ls nodefony`",
  },
  {
    when: /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/u,
    hint: "dépendance ou build manquant : `npm install`, puis `npm run build`",
  },
  {
    when: /BootConfigurationError/u,
    hint: "configuration refusée au démarrage (sortie 78) : le message NOMME la clé — corrige-la, ne la retire pas",
  },
  {
    when: /EADDRINUSE|already in use/u,
    hint: "port déjà tenu : `npx nodefony status` nomme qui le tient (une ligne « retrying » juste après = rattrapé seul)",
  },
  {
    when: /no such table|no such column|does not exist|doesn't exist|Unknown column|migrations? à appliquer/u,
    hint: "schéma de base en retard sur les entités : skill `nodefony-migrate-schema`",
  },
  {
    when: /ECONNREFUSED|ENOTFOUND|getaddrinfo/u,
    hint: "un service extérieur (base, cache, fournisseur) ne répond pas : `npx nodefony doctor --live`",
  },
  {
    when: /^SIG(?:TERM|INT|HUP)$/u,
    hint: "arrêt DEMANDÉ au processus — pas une panne",
  },
];

const FLAGS = new Set([
  "--warnings",
  "--last",
  "--json",
  "--root",
  "--help",
  "-h",
]);

/**
 * Lit les arguments, et REFUSE ce qu'il ne comprend pas.
 *
 * Un drapeau mal tapé qu'on ignorerait rendrait « aucune erreur » — la pire
 * réponse possible d'un outil de dépannage.
 *
 * @param argv - les arguments, sans `node` ni le chemin du script.
 * @returns les options lues.
 * @throws Error quand un drapeau est inconnu ou qu'une valeur manque.
 */
export function parseArgs(argv, cwd = process.cwd()) {
  const opts = {
    files: [],
    warnings: false,
    last: DEFAULT_LAST,
    json: false,
    root: appRoot(cwd),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      opts.files.push(a);
      continue;
    }
    if (!FLAGS.has(a)) throw new Error(`option inconnue : ${a}`);
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--warnings") opts.warnings = true;
    else if (a === "--json") opts.json = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("-"))
        throw new Error(`${a} attend une valeur`);
      if (a === "--root") opts.root = path.resolve(v);
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1)
          throw new Error(`--last attend un entier positif, reçu « ${v} »`);
        opts.last = n;
      }
    }
  }
  return opts;
}

/**
 * Heure locale `HH:MM:SS.mmm` d'un horodatage — la forme du journal texte, pour
 * qu'un même événement lu dans ses deux formes se reconnaisse.
 *
 * @param ms - horodatage en millisecondes.
 * @returns l'heure formatée.
 */
function timeOfDay(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * Découpe un journal en événements, quelle que soit sa forme (texte ou JSON par ligne).
 *
 * Les lignes d'une même erreur — même heure, même émetteur, même sévérité, ou
 * pile d'appels qui suit — forment UN événement : une pile de sept lignes est
 * une erreur, pas sept.
 *
 * @param text - le contenu du journal.
 * @param source - le nom du fichier, rendu avec chaque événement.
 * @returns les événements, dans l'ordre du journal.
 */
export function extractEvents(text, source) {
  const events = [];
  let last = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(ANSI, "");
    if (line.trim() === "") continue;
    let entry = null;
    if (line.startsWith("{")) {
      try {
        const o = JSON.parse(line);
        if (typeof o.severityName === "string" && o.severityName in SEVERITY) {
          entry = {
            time:
              typeof o.timeStamp === "number" ? timeOfDay(o.timeStamp) : null,
            severity: o.severityName,
            msgid: String(o.msgid ?? ""),
            message:
              typeof o.payload === "string"
                ? o.payload
                : JSON.stringify(o.payload),
          };
        }
      } catch {
        // Une ligne JSON tronquée (écriture en cours) n'est pas une erreur du journal.
      }
    } else {
      const m = PDU_LINE.exec(line);
      if (m)
        entry = {
          time: m[1],
          severity: m[2],
          msgid: m[3].trim(),
          message: m[4],
        };
      else {
        const r = RAW_ERROR.exec(line.trim());
        if (r)
          entry = {
            time: null,
            severity: "ERROR",
            msgid: "node",
            message: line.trim(),
          };
        else if (last && STACK_LINE.test(line)) {
          last.detail.push(line.trim());
          continue;
        }
      }
    }
    if (entry === null) {
      last = null;
      continue;
    }
    const sameError =
      last !== null &&
      entry.time !== null &&
      last.time === entry.time &&
      last.msgid === entry.msgid &&
      last.severity === entry.severity;
    if (sameError) {
      last.detail.push(entry.message);
      continue;
    }
    last = { ...entry, source, detail: [] };
    events.push(last);
  }
  return events;
}

/**
 * Garde ce qui compte et fusionne les répétitions.
 *
 * Deux événements identiques (même sévérité, émetteur et message) n'en font
 * qu'un, compté — qu'ils viennent d'un même fichier ou des deux formes du même
 * journal. L'ordre rendu est chronologique, par dernière occurrence.
 *
 * @param events - les événements extraits.
 * @param options - `warnings` garde aussi les avertissements.
 * @returns les erreurs distinctes, chacune avec son nombre, sa première et sa dernière heure, et sa piste.
 */
export function summarize(events, { warnings = false } = {}) {
  const ceiling = warnings ? SEVERITY.WARNING : SEVERITY.ERROR;
  const byKey = new Map();
  const seen = new Set();
  for (const e of events) {
    if (SEVERITY[e.severity] > ceiling) continue;
    // Le même événement lu dans ses deux formes (texte ET JSON) ne compte qu'une fois.
    const occurrence = `${e.time}|${e.severity}|${e.msgid}|${e.message}`;
    if (e.time !== null && seen.has(occurrence)) continue;
    seen.add(occurrence);
    const key = `${e.severity}|${e.msgid}|${e.message}`;
    const known = byKey.get(key);
    if (known) {
      known.count++;
      known.lastTime = e.time ?? known.lastTime;
      byKey.delete(key);
      byKey.set(key, known);
      continue;
    }
    const text = [e.message, ...e.detail].join("\n");
    byKey.set(key, {
      severity: e.severity,
      msgid: e.msgid,
      message: e.message,
      detail: e.detail,
      source: e.source,
      count: 1,
      firstTime: e.time,
      lastTime: e.time,
      hint: HINTS.find((h) => h.when.test(text))?.hint ?? null,
    });
  }
  return [...byKey.values()];
}

/**
 * Lit la fin d'un fichier — tout, s'il est sous le plafond.
 *
 * @param file - chemin du fichier.
 * @returns le texte relu.
 */
function readTail(file) {
  const size = statSync(file).size;
  if (size <= MAX_SCAN_BYTES) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(MAX_SCAN_BYTES);
    readSync(fd, buf, 0, MAX_SCAN_BYTES, size - MAX_SCAN_BYTES);
    // La première ligne est coupée en plein milieu : on la jette.
    return buf.toString("utf8").replace(/^[^\n]*\n/u, "");
  } finally {
    closeSync(fd);
  }
}

/**
 * Les journaux à lire : ceux donnés, sinon ceux du dossier `logs/` du projet.
 *
 * @param opts - les options lues.
 * @returns les fichiers lisibles, du plus ancien au plus récent.
 */
export function journalFiles(opts) {
  if (opts.files.length > 0)
    return opts.files.map((f) => path.resolve(opts.root, f));
  const dir = path.join(opts.root, "logs");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".log") || n.endsWith(".jsonl"))
    .map((n) => path.join(dir, n))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

/** Âge lisible d'un fichier : un journal d'hier ne parle pas de la panne d'aujourd'hui. */
function age(ms) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "moins d'une minute";
  if (min < 120) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}

const USAGE = `Usage : node log-errors.mjs [journal…] [--warnings] [--last N] [--json] [--root DIR]

Sans fichier : lit logs/*.log et logs/*.jsonl du projet.
Sorties : 0 aucune erreur · 1 au moins une erreur · 64 usage · 66 aucun journal lisible.`;

/**
 * Point d'entrée.
 *
 * @returns le code de sortie.
 */
export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}\n`);
    return 64;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const files = journalFiles(opts);
  const read = [];
  const events = [];
  for (const file of files) {
    let text;
    try {
      text = readTail(file);
    } catch (e) {
      process.stderr.write(`illisible : ${file} — ${e.message}\n`);
      continue;
    }
    const rel = path.relative(opts.root, file) || file;
    read.push({ file: rel, age: age(statSync(file).mtimeMs) });
    events.push(...extractEvents(text, rel));
  }
  if (read.length === 0) {
    process.stderr.write(
      "Aucun journal lisible.\n" +
        "En développement, le journal part sur la SORTIE du terminal qui a lancé le serveur, pas dans un fichier.\n" +
        "Pour l'avoir ici : `npx nodefony development --detach` (journal dans logs/nodefony-detached.log),\n" +
        "ou redirige la sortie dans un fichier, puis passe-le en argument.\n",
    );
    return 66;
  }
  const all = summarize(events, opts);
  const shown = all.slice(-opts.last);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ read, total: all.length, errors: shown }, null, 2)}\n`,
    );
    return all.length > 0 ? 1 : 0;
  }
  process.stdout.write(
    `Journaux lus : ${read.map((r) => `${r.file} (écrit il y a ${r.age})`).join(", ")}\n\n`,
  );
  if (all.length === 0) {
    process.stdout.write(
      `Aucune erreur${opts.warnings ? " ni avertissement" : ""}.\n`,
    );
    return 0;
  }
  process.stdout.write(
    `${all.length} erreur${all.length > 1 ? "s" : ""} distincte${all.length > 1 ? "s" : ""}` +
      `${all.length > shown.length ? ` — les ${shown.length} plus récentes` : ""}\n\n`,
  );
  for (const e of shown) {
    const when =
      e.count > 1
        ? `${e.firstTime ?? "?"} → ${e.lastTime ?? "?"}, ×${e.count}`
        : (e.firstTime ?? "heure inconnue");
    process.stdout.write(
      `${e.severity} ${e.msgid} [${e.source}, ${when}]\n  ${e.message}\n`,
    );
    for (const d of e.detail.slice(0, 4)) process.stdout.write(`    ${d}\n`);
    if (e.detail.length > 4)
      process.stdout.write(`    … ${e.detail.length - 4} ligne(s) de plus\n`);
    if (e.hint) process.stdout.write(`  ➜ ${e.hint}\n`);
    process.stdout.write("\n");
  }
  return 1;
}

// Exécuté directement (et non importé par son test) : rendre le code.
// La comparaison passe par une URL, jamais par un chemin : sous Windows, `D:\…`
// verrait son `d:` lu comme un protocole.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.exitCode = main();
}
