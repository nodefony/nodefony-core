/**
 * Gate — les symboles expérimentaux d'un paquet STABLE sont exactement ceux
 * que la politique de compatibilité nomme (ADR-0026 D11, critère 43 de #695).
 *
 * Un paquet entier se déclare expérimental par `nodefony.stability` (gardé par
 * `src/nodefony/src/tests/stability.test.ts`). Dans un paquet stable, le grain
 * est le symbole : l'étiquette TSDoc `@experimental`, lue sur le `.d.ts`
 * PUBLIÉ de chaque entrée d'`exports` — l'artefact que reçoit l'installeur,
 * d'où l'exigence d'un build complet AVANT. Deux copies, un écart refusé :
 *
 * - l'ensemble des symboles (ou membres) étiquetés == le tableau « Symboles
 *   expérimentaux d'un paquet stable » de `docs/guides/compatibilite.md`,
 *   dans les deux sens ;
 * - une page d'un paquet stable porte `status: experimental` seulement si elle
 *   documente un symbole de ce tableau, pour son paquet.
 *
 * Un seul lecteur de la surface : `api-diff-core.mjs#readTypeSurface`.
 *
 * @usage node scripts/gates/check-symbol-stability.mjs [--list]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { publishableWorkspaces } from "../lib/workspaces.mjs";
import {
  exportEntries,
  packageStability,
  readTypeSurface,
} from "../release/api-diff-core.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Titre de la section du tableau, dans la politique. */
export const TABLE_HEADING = "### Symboles expérimentaux d'un paquet stable";

/**
 * Lit le tableau des symboles expérimentaux d'un paquet stable.
 *
 * Une ligne : `` | `Symbole` | `paquet` | pourquoi | ``. La section court
 * jusqu'au titre suivant, de tout niveau.
 *
 * @param text - contenu de `compatibilite.md`.
 * @returns les entrées `paquet symbole`, ou `null` si la section manque.
 */
export function readSymbolTable(text) {
  const start = text.indexOf(TABLE_HEADING);
  if (start === -1) return null;
  const rest = text.slice(start + TABLE_HEADING.length);
  const end = rest.search(/\n#{1,6} /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = [];
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) rows.push(`${match[2]} ${match[1]}`);
  }
  return rows.sort();
}

/**
 * Compare les symboles étiquetés au tableau, dans les deux sens.
 *
 * @param tagged - entrées `paquet symbole` lues sur les `.d.ts`.
 * @param table - entrées `paquet symbole` du tableau.
 * @returns `{ missing, stale }` — étiquetés absents du tableau, et lignes du
 *   tableau qu'aucune étiquette ne porte.
 */
export function compareSymbolSets(tagged, table) {
  const inTable = new Set(table);
  const isTagged = new Set(tagged);
  return {
    missing: [...isTagged].filter((e) => !inTable.has(e)).sort(),
    stale: [...inTable].filter((e) => !isTagged.has(e)).sort(),
  };
}

/**
 * Dit si une page documente l'un des symboles donnés : nommé entre accents
 * graves (`` `X` ``) ou par une ancre de code (`fichier.ts#X`).
 *
 * @param text - contenu de la page.
 * @param symbols - noms du tableau pour le paquet de la page.
 * @returns `true` si l'un d'eux y figure.
 */
export function pageDocumentsSymbol(text, symbols) {
  return symbols.some(
    (s) => text.includes(`\`${s}\``) || text.includes(`#${s}`),
  );
}

/** Les symboles étiquetés d'un paquet, toutes entrées d'`exports` confondues. */
function taggedSymbols(dir, pkg, faults) {
  const out = new Set();
  for (const [subpath, { dts }] of Object.entries(exportEntries(pkg, dir))) {
    if (dts === null) continue;
    if (!fs.existsSync(dts)) {
      faults.push(
        `${pkg.name}${subpath.slice(1)} : ${path.relative(ROOT, dts)} absent — bâtir d'abord (npm run build)`,
      );
      continue;
    }
    for (const name of readTypeSurface(dts).experimental) out.add(name);
  }
  return out;
}

function pageFaults(dir, name, symbols) {
  const docs = path.join(dir, "docs");
  if (!fs.existsSync(docs)) return [];
  const faults = [];
  for (const entry of fs.readdirSync(docs)) {
    if (!entry.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(docs, entry), "utf8");
    if (/^status:\s*experimental\b/m.exec(text) === null) continue;
    if (!pageDocumentsSymbol(text, symbols)) {
      faults.push(
        `${path.relative(ROOT, path.join(docs, entry))} : status experimental, mais aucun symbole expérimental de ${name} n'y est documenté`,
      );
    }
  }
  return faults;
}

function main() {
  const list = process.argv.includes("--list");
  const faults = [];
  const tagged = [];
  const stable = [];
  for (const workspace of publishableWorkspaces(ROOT)) {
    const dir = path.join(ROOT, workspace.location);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    if (packageStability(pkg) !== "stable") continue;
    stable.push({ name: pkg.name, dir });
    for (const symbol of taggedSymbols(dir, pkg, faults))
      tagged.push(`${pkg.name} ${symbol}`);
  }
  tagged.sort();
  if (list) {
    for (const entry of tagged) console.log(entry);
    return;
  }
  const policy = path.join(ROOT, "docs", "guides", "compatibilite.md");
  const table = readSymbolTable(fs.readFileSync(policy, "utf8"));
  if (table === null) {
    faults.push(
      `${path.relative(ROOT, policy)} : section « ${TABLE_HEADING.slice(4)} » absente`,
    );
  } else {
    const { missing, stale } = compareSymbolSets(tagged, table);
    for (const e of missing)
      faults.push(`étiqueté @experimental, absent du tableau : ${e}`);
    for (const e of stale)
      faults.push(`au tableau, mais aucune étiquette @experimental : ${e}`);
    for (const { name, dir } of stable) {
      const symbols = table
        .filter((e) => e.startsWith(`${name} `))
        .map((e) => e.slice(name.length + 1));
      faults.push(...pageFaults(dir, name, symbols));
    }
  }
  if (faults.length) {
    console.error(
      `✗ symboles expérimentaux d'un paquet stable — ${faults.length} écart(s) :`,
    );
    for (const f of faults) console.error(`  - ${f}`);
    console.error(
      "  Une étiquette @experimental et sa ligne dans docs/guides/compatibilite.md vont ensemble (ADR-0026 D11).",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `✓ symboles expérimentaux d'un paquet stable : ${tagged.length}, tous au tableau de la politique.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
