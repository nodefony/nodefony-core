#!/usr/bin/env node
/**
 * anchor-migrate.mjs — convertit les ancres `fichier:ligne` d'une page en ancres
 * par SYMBOLE (`<fichier>.ts#<Symbole>`, `<fichier>.ts#<Classe.membre>`).
 *
 * Une ligne bouge dès qu'on écrit au-dessus d'elle ; un symbole ne bouge qu'au
 * renommage, quand la doc DOIT suivre. La cible se lit dans l'AST du fichier
 * visé (`lib/code-declarations.mjs`), jamais dans son texte, et aucune ancre
 * n'est laissée à la main :
 *
 *   symbole cité   la page nomme, devant l'ancre, un symbole déclaré UNE fois
 *                  ailleurs dans le fichier : site d'usage, ou ligne qui a
 *                  glissé (vécu : `webhooks.ts:63` pour une constante en 62).
 *                  Sa déclaration est un lien vrai, l'englobant ne l'est pas.
 *   englobant      la déclaration la plus intérieure qui contient la ligne ;
 *                  une ancre d'instruction se rabat sur sa méthode.
 *   fichier        la ligne n'est dans aucune déclaration (code de haut
 *                  niveau, `describe` d'un test) : l'ancre garde le fichier
 *                  seul, qui ne casse qu'à son renommage.
 *   retirée        ancre courte `:N` dont le fichier n'est pas écrit, ou que
 *                  le contrôle réfute : elle ne désigne rien qu'on sache
 *                  ouvrir. Le symbole qui la précède se trouve au `grep`.
 *
 * La détection (fichier visé, symbole cité, ancres courtes) vient de
 * `anchor-check.mjs --json` : une seule implémentation.
 *
 * Usage : node anchor-migrate.mjs <page.md|dossier> [...] [--apply] [--report <f.json>]
 *   sans --apply : rien n'est écrit, le bilan dit ce qui le serait.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  enclosingDeclaration,
  loadDeclarations,
} from "../lib/code-declarations.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const iReport = argv.indexOf("--report");
const reportPath =
  iReport >= 0
    ? argv[iReport + 1]
    : path.join(REPO, "tmp", "reports", "anchor-migrate.json");
const cibles = argv
  .filter((a, i) => a !== "--apply" && i !== iReport && i !== iReport + 1)
  .map((c) => path.resolve(c));
if (!cibles.length) {
  console.error(
    "usage: node anchor-migrate.mjs <page.md|dossier> [...] [--apply] [--report <f.json>]",
  );
  process.exit(2);
}

// Le contrôle sort en 1 dès qu'une ancre est fausse : attendu ici.
let sortie;
try {
  sortie = execFileSync(
    process.execPath,
    [path.join(HERE, "anchor-check.mjs"), "--json", ...cibles],
    {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
} catch (e) {
  if (typeof e.stdout !== "string") throw e;
  sortie = e.stdout;
}
const ancres = sortie
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  // Une ancre déjà par symbole n'a rien à convertir.
  .filter((a) => a.symbol === undefined);

const norm = (s) =>
  String(s ?? "")
    .replace(/^#/, "")
    .toLowerCase();

/**
 * La cible d'une ancre de ligne : `{ action, symbol? }`, ou `null` si son
 * fichier est introuvable — le contrôle la refusera, et le bilan le dit.
 */
function cibleDe(a) {
  if (a.kind === "ORPHAN" || a.kind === "NON_CONTROLEE")
    return { action: "retirée" };
  if (!a.cand || a.kind === "FILE_NOT_FOUND" || a.kind === "LINE_OUT")
    return null;
  const index = loadDeclarations(path.join(REPO, a.cand));
  const cites = a.prouve
    ? index.list.filter((d) => norm(d.name) === norm(a.prouve) && !d.overload)
    : [];
  const englobant = enclosingDeclaration(index, a.start, a.end);
  // Le symbole cité qui CONTIENT l'englobant (la classe d'une méthode visée)
  // est moins précis que lui : l'englobant gagne.
  const contient = (x, y) => y && x.start <= y.start && x.end >= y.end;
  if (cites.length === 1 && !contient(cites[0], englobant))
    return { action: "symbole cité", symbol: cites[0].qualified };
  if (englobant) return { action: "englobant", symbol: englobant.qualified };
  return { action: "fichier" };
}

/** Le texte qui remplace l'ancre, `""` pour une ancre retirée. */
function remplacement(a, c) {
  if (c.action === "retirée") return "";
  const suffixe = c.symbol ? `#${c.symbol}` : "";
  if (a.short) return `\`${a.label.replace(/:\d+(?:-\d+)?$/, "")}${suffixe}\``;
  return a.raw.replace(/:\d+(?:-\d+)?(`?)$/, `${suffixe}$1`);
}

/**
 * L'étendue à effacer pour une ancre retirée, séparateur compris : ` (`:54`)`,
 * `, `:18``, ` `:1384``. Sans lui, la phrase garderait une virgule ou des
 * parenthèses vides.
 */
function etendueRetiree(ligne, debut, fin) {
  const avant = ligne.slice(0, debut);
  const apres = ligne.slice(fin);
  const parenthese = /\s*\(\s*$/.exec(avant);
  const fermante = /^\s*\)/.exec(apres);
  if (parenthese && fermante)
    return [debut - parenthese[0].length, fin + fermante[0].length];
  const separateur = /(?:\s*[,·/]\s*|\s+)$/.exec(avant);
  return [debut - (separateur ? separateur[0].length : 0), fin];
}

const parPage = new Map();
const bilan = {};
const detail = [];
for (const a of ancres) {
  const c = cibleDe(a);
  const action = c?.action ?? "introuvable";
  bilan[action] = (bilan[action] ?? 0) + 1;
  const texte = c ? remplacement(a, c) : null;
  detail.push({
    page: path.relative(REPO, path.resolve(REPO, a.page)),
    line: a.line,
    raw: a.raw,
    action,
    texte,
  });
  if (c === null) continue;
  if (!parPage.has(a.page)) parPage.set(a.page, []);
  parPage.get(a.page).push({ ...a, texte });
}

let ecrites = 0;
let decalees = 0;
for (const [page, edits] of parPage) {
  const abs = path.resolve(REPO, page);
  const lignes = fs.readFileSync(abs, "utf8").split("\n");
  const touchees = new Set();
  const debutDeLigne = new Set();
  // De droite à gauche : une réécriture ne décale pas les index de celles
  // qui la précèdent sur la ligne.
  edits.sort((x, y) => x.line - y.line || y.index - x.index);
  for (const e of edits) {
    const l = lignes[e.line - 1];
    if (l.slice(e.index, e.index + e.raw.length) !== e.raw) {
      decalees++;
      continue;
    }
    const [debut, fin] =
      e.texte === ""
        ? etendueRetiree(l, e.index, e.index + e.raw.length)
        : [e.index, e.index + e.raw.length];
    if (e.texte === "" && /^\s*$/.test(l.slice(0, debut)) && debut === 0)
      debutDeLigne.add(e.line - 1);
    lignes[e.line - 1] = l.slice(0, debut) + e.texte + l.slice(fin);
    touchees.add(e.line - 1);
  }
  // Trois ancres vers trois lignes d'un même test deviennent trois fois le
  // même fichier : on n'en garde qu'une. Un retrait en tête de ligne n'y
  // laisse pas d'espace.
  for (const k of touchees)
    lignes[k] = lignes[k]
      .replace(/(`[^`]+`)(?:,\s*\1)+/g, "$1")
      .replace(/^(\s*)\s(?=\S)/, (m, avant) =>
        debutDeLigne.has(k) ? avant : m,
      );
  if (APPLY) {
    fs.writeFileSync(abs, lignes.join("\n"));
    ecrites++;
  }
}

console.log(`${ancres.length} ancres de ligne dans ${parPage.size} pages`);
for (const [action, n] of Object.entries(bilan).sort((x, y) => y[1] - x[1]))
  console.log(`  ${String(n).padStart(6)}  ${action}`);
if (decalees)
  console.log(
    `  ⚠️ ${decalees} ancre(s) introuvable(s) à leur position : page modifiée pendant le run ?`,
  );
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(detail, null, 1));
console.log(
  APPLY
    ? `${ecrites} page(s) réécrite(s). Détail : ${path.relative(REPO, reportPath)}`
    : `Rien n'a été écrit (--apply pour réécrire). Détail : ${path.relative(REPO, reportPath)}`,
);
process.exitCode = decalees || bilan.introuvable ? 1 : 0;
