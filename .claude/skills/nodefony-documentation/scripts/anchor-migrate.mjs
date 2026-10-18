#!/usr/bin/env node
/**
 * anchor-migrate.mjs — convertit les ancres `fichier:ligne` en ancres par SYMBOLE
 * (`<fichier>.ts#<Symbole>`, `<fichier>.ts#<Classe.membre>`).
 *
 * Une ligne bouge dès qu'on écrit au-dessus d'elle ; un symbole ne bouge qu'au
 * renommage, quand la doc DOIT suivre. Ce script trouve, pour chaque ancre, la
 * déclaration qui ENGLOBE la ligne visée — l'AST TypeScript du fichier fait foi,
 * jamais une recherche de texte — et la classe :
 *
 *   EXACT        l'englobant est le symbole que la page cite devant l'ancre
 *   ENGLOBANT    ancre juste, mais elle vise une instruction : elle se rabat sur
 *                la déclaration qui la contient (perte de précision assumée)
 *   RECALE       ancre dérivée (SUSPECT), mais le symbole cité n'est déclaré
 *                qu'une fois dans le fichier : c'est lui la cible
 *   A_RELIRE     ancre jugée juste, mais le symbole cité est déclaré AILLEURS
 *                dans le fichier : site d'usage, ou ligne qui a glissé — les
 *                deux cibles sont proposées, aucune n'est choisie
 *   INDECIS      le contrôle ne sait pas ce que l'ancre prouve : convertible
 *                sur l'englobant, à relire
 *   HORS_SYMBOLE la ligne n'est dans aucune déclaration nommée (import, code
 *                de haut niveau d'un script) : reliquat à la main
 *   HOMONYME     l'englobant porte un nom déclaré plusieurs fois dans le
 *                fichier (fusion de déclarations) : le lien serait incertain
 *   CASSEE       fichier introuvable, ligne hors fichier, ancre dérivée sans
 *                cible unique, ancre courte non contrôlée : jamais devinée
 *
 * La détection des ancres (fichier visé, symbole cité) n'est PAS ici : elle
 * vient de `anchor-check.mjs --json`, pour qu'il n'en existe qu'une.
 *
 * ESSAI À BLANC : ne réécrit rien. Rend le bilan, et le détail ancre par ancre
 * dans `--report` (défaut `tmp/reports/anchor-migrate.json`).
 *
 * Usage : node anchor-migrate.mjs <page.md|dossier> [...] [--report <f.json>]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import {
  enclosingDeclaration,
  isAmbiguous,
  loadDeclarations,
} from "../lib/code-declarations.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const iReport = argv.indexOf("--report");
const reportPath =
  iReport >= 0
    ? argv[iReport + 1]
    : path.join(REPO, "tmp", "reports", "anchor-migrate.json");
const cibles = argv.filter((a, i) => i !== iReport && i !== iReport + 1);
if (!cibles.length) {
  console.error(
    "usage: node anchor-migrate.mjs <page.md|dossier> [...] [--report <f.json>]",
  );
  process.exit(2);
}

// Le contrôle sort en 1 dès qu'une ancre est fausse : c'est attendu ici, les
// ancres fausses font partie de ce qu'on compte.
let sortie;
try {
  sortie = execFileSync(
    process.execPath,
    [path.join(HERE, "anchor-check.mjs"), "--json", ...cibles],
    {
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
  .map((l) => JSON.parse(l));

// Périmètre du graphe symbolique : une ancre vers un fichier qu'il ne parse pas
// ne se résoudra pas au rendu tant que ce périmètre ne l'inclut pas.
const { default: graphe } = await import(
  path.join(REPO, "scripts", "generate", "generate-symbols.config.ts")
);
const dansGraphe = picomatch(graphe.include, { ignore: graphe.exclude });

const norm = (s) =>
  String(s ?? "")
    .replace(/^#/, "")
    .toLowerCase();
// Blocs de code d'une page : une ancre dans une fence est souvent un exemple
// (trace de pile, sortie de commande), pas une référence — le bilan le dit.
const fenceCache = new Map();
function dansFence(page, line) {
  if (!fenceCache.has(page)) {
    const lignes = fs.readFileSync(page, "utf8").split("\n");
    const dedans = new Set();
    let ouvert = false;
    lignes.forEach((l, k) => {
      if (/^\s*(```|~~~)/.test(l)) ouvert = !ouvert;
      else if (ouvert) dedans.add(k + 1);
    });
    fenceCache.set(page, dedans);
  }
  return fenceCache.get(page).has(line);
}

const detail = [];
for (const a of ancres) {
  let categorie;
  let cible = null;
  let motif = null;
  let parNom = null;
  if (
    !a.cand ||
    a.kind === "FILE_NOT_FOUND" ||
    a.kind === "LINE_OUT" ||
    a.kind === "NON_CONTROLEE"
  ) {
    categorie = "CASSEE";
    motif = a.kind;
  } else {
    const index = loadDeclarations(path.join(REPO, a.cand));
    const decls = index.list;
    if (a.kind === "SUSPECT") {
      const nommes = a.prouve
        ? decls.filter((d) => norm(d.name) === norm(a.prouve))
        : [];
      if (nommes.length === 1) {
        categorie = "RECALE";
        cible = nommes[0];
      } else {
        categorie = "CASSEE";
        motif = nommes.length
          ? `SUSPECT, ${nommes.length} déclarations de ${a.prouve}`
          : "SUSPECT sans cible";
      }
    } else {
      const d = enclosingDeclaration(index, a.start, a.end);
      if (!d) categorie = "HORS_SYMBOLE";
      else {
        cible = d;
        categorie =
          a.kind === "INDECIS"
            ? "INDECIS"
            : a.prouve &&
                (norm(d.name) === norm(a.prouve) ||
                  norm(d.qualified) === norm(a.prouve))
              ? "EXACT"
              : "ENGLOBANT";
        // Le symbole cité devant l'ancre est déclaré AILLEURS dans le fichier :
        // l'ancre vise un site d'usage, ou une ligne qui a glissé et que la
        // fenêtre large du contrôle a laissée passer (vécu : `webhooks.ts:63`
        // pour une constante déclarée en 62). Se rabattre sur l'englobant
        // figerait alors le MAUVAIS symbole : on ne choisit pas, on montre.
        const cites =
          categorie === "ENGLOBANT" && a.prouve
            ? decls.filter((x) => norm(x.name) === norm(a.prouve))
            : [];
        if (cites.length) {
          const ecart = Math.min(
            ...cites.map((x) =>
              a.start < x.start
                ? x.start - a.start
                : Math.max(0, a.start - x.end),
            ),
          );
          categorie = "A_RELIRE";
          motif = `${a.prouve} déclaré ailleurs (écart ${ecart} l.) — englobant ${d.qualified}, ou ${cites[0].qualified}`;
          parNom = { cible: cites.length === 1 ? cites[0] : null, ecart };
        }
      }
    }
    if (cible && isAmbiguous(index, cible.qualified)) {
      motif = `${cible.qualified} déclaré plusieurs fois`;
      categorie = "HOMONYME";
    }
  }
  detail.push({
    page: path.relative(REPO, path.resolve(a.page)),
    line: a.line,
    raw: a.raw,
    short: a.short,
    plage: a.end !== a.start,
    fence: dansFence(a.page, a.line),
    controle: a.kind,
    prouve: a.prouve,
    cand: a.cand,
    categorie,
    motif,
    cible: cible
      ? `${a.label.replace(/:\d+(-\d+)?$/, "")}#${cible.qualified}`
      : null,
    membre: cible?.member ?? null,
    horsGraphe: a.cand ? !dansGraphe(a.cand) : null,
    ecartCite: parNom?.ecart ?? null,
    cibleParNom: parNom?.cible
      ? `${a.label.replace(/:\d+(-\d+)?$/, "")}#${parNom.cible.qualified}`
      : null,
  });
}

const ORDRE = [
  "EXACT",
  "ENGLOBANT",
  "RECALE",
  "A_RELIRE",
  "INDECIS",
  "HORS_SYMBOLE",
  "HOMONYME",
  "CASSEE",
];
const CONVERTIBLES = new Set(["EXACT", "ENGLOBANT", "RECALE"]);
const compte = (f) => detail.filter(f).length;
const pct = (n) => `${((100 * n) / detail.length).toFixed(1)} %`;

console.log(
  `${detail.length} ancres lues par anchor-check (${new Set(detail.map((d) => d.page)).size} pages)\n`,
);
console.log(
  "catégorie      ancres   part    dont plage  dont courte  dont fence  cible hors graphe",
);
for (const c of ORDRE) {
  const de = detail.filter((d) => d.categorie === c);
  console.log(
    `${c.padEnd(14)} ${String(de.length).padStart(6)}  ${pct(de.length).padStart(7)}` +
      `  ${String(de.filter((d) => d.plage).length).padStart(10)}` +
      `  ${String(de.filter((d) => d.short).length).padStart(11)}` +
      `  ${String(de.filter((d) => d.fence).length).padStart(10)}` +
      `  ${String(de.filter((d) => d.horsGraphe).length).padStart(17)}`,
  );
}
const conv = detail.filter((d) => CONVERTIBLES.has(d.categorie));
console.log(
  `\nConvertibles sans ambiguïté (EXACT + ENGLOBANT + RECALE) : ${conv.length} (${pct(conv.length)})` +
    `\n  dont visant un MEMBRE (exige les membres dans le graphe) : ${conv.filter((d) => d.membre).length}` +
    `\n  dont cible HORS du périmètre de .ai/symbols.json : ${conv.filter((d) => d.horsGraphe).length}` +
    `\n  symboles cibles distincts : ${new Set(conv.map((d) => `${d.cand}#${d.cible.split("#")[1]}`)).size}` +
    `\nÀ relire (A_RELIRE + INDECIS) : ${compte((d) => ["A_RELIRE", "INDECIS"].includes(d.categorie))}` +
    ` — A_RELIRE par écart au symbole cité : ≤ 3 l. ${compte((d) => d.ecartCite !== null && d.ecartCite <= 3)}` +
    `, 4-30 l. ${compte((d) => d.ecartCite > 3 && d.ecartCite <= 30)}, > 30 l. ${compte((d) => d.ecartCite > 30)}` +
    `\n` +
    ` · reliquat à la main (HORS_SYMBOLE + HOMONYME + CASSEE) : ` +
    compte((d) => ["HORS_SYMBOLE", "HOMONYME", "CASSEE"].includes(d.categorie)),
);
const horsGrapheParRacine = {};
for (const d of conv.filter((x) => x.horsGraphe)) {
  const r = d.cand
    .split("/")
    .slice(0, d.cand.startsWith("src/packages") ? 4 : 2)
    .join("/");
  horsGrapheParRacine[r] = (horsGrapheParRacine[r] ?? 0) + 1;
}
console.log("\nCibles hors graphe, par racine :");
for (const [r, n] of Object.entries(horsGrapheParRacine)
  .sort((x, y) => y[1] - x[1])
  .slice(0, 12))
  console.log(`  ${String(n).padStart(5)}  ${r}`);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(detail, null, 1));
console.log(
  `\nDétail ancre par ancre : ${path.relative(REPO, path.resolve(reportPath))} — rien n'a été réécrit.`,
);
