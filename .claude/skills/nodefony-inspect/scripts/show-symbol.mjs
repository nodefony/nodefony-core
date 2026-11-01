#!/usr/bin/env node
/**
 * show-symbol.mjs — imprime UNE déclaration d'un fichier source, ou son plan,
 * au lieu d'une tranche de lignes.
 *
 * Lire du code par tranches (`sed -n 100,250p`, `cat`, `Read` sans borne) est le
 * premier poste de dépense mesuré sur les sessions du dépôt : on imprime 150
 * lignes pour en lire 20, et la sortie se repaie à chaque tour suivant. Ici la
 * borne vient de l'AST (`code-declarations.mjs`, le module qui résout aussi les
 * ancres de la doc) : la méthode entière, TSDoc compris, et rien d'autre.
 *
 * Usage :
 *   node show-symbol.mjs <fichier>#<Symbole> [...]   la déclaration, numérotée
 *   node show-symbol.mjs <fichier>#<Classe.membre>   un membre (méthode, propriété)
 *   node show-symbol.mjs <fichier>:<ligne>[-<fin>]   l'unité qui CONTIENT la ligne — la
 *                                                    position d'une erreur tsc/vitest/oxlint
 *   node show-symbol.mjs --outline <fichier> [...]   le plan : déclarations ET blocs sans nom
 *                                                    (imports, ré-exports, describe/it, if…)
 *
 * `<fichier>` : un chemin, ou une fin de chemin unique dans le dépôt
 * (`NodefonySocket.ts`, `realtime/index.ts`). Un nom de membre nu (`#onDenied`)
 * est accepté s'il n'existe qu'une fois dans le fichier.
 *
 * Il n'y a plus de raison de lire du code par tranche : toute ligne d'un fichier
 * appartient à une unité que ce script sait imprimer entière (le hook `guard-bash`
 * refuse donc toute tranche de code, et `guard-read` toute lecture bornée).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  findDeclarations,
  loadDeclarations,
  parseBlocks,
} from "../../nodefony-documentation/lib/code-declarations.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const argv = process.argv.slice(2);
const OUTLINE = argv.includes("--outline");
const cibles = argv.filter((a) => a !== "--outline");
if (!cibles.length) {
  console.error(
    "usage: node show-symbol.mjs <fichier>#<Symbole> | <fichier>:<ligne>[-<fin>] [...] | --outline <fichier> [...]",
  );
  process.exit(2);
}

let tracked = null;
/** Le fichier désigné : chemin existant, sinon fin de chemin UNIQUE parmi les fichiers suivis. */
function resolveFile(ref) {
  for (const base of [process.cwd(), REPO]) {
    const p = path.resolve(base, ref);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return [p];
  }
  tracked ??= execFileSync("git", ["ls-files"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\n");
  const norm = ref.replaceAll("\\", "/");
  return tracked
    .filter((f) => f === norm || f.endsWith("/" + norm))
    .map((f) => path.join(REPO, f));
}

const rel = (p) => path.relative(REPO, p).replaceAll("\\", "/");
let echec = 0;

/**
 * Déclarations et blocs sans nom d'un fichier, en une liste d'unités triées.
 * `all` garde aussi chaque instruction d'un groupe d'imports/ré-exports : une
 * ligne visée dans un barrel rend SON instruction, pas tout le groupe.
 */
function unitsOf(file, decls, all = false) {
  const units = decls.list
    .filter((d) => !d.overload)
    .map((d) => ({
      label: d.qualified,
      indent: d.member ? 1 : 0,
      start: d.start,
      end: d.end,
    }));
  for (const b of parseBlocks(file, decls.lines.join("\n")))
    if (all || !b.grouped)
      units.push({
        label: b.label,
        indent: b.depth,
        start: b.start,
        end: b.end,
      });
  return units.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** `F.ts:120` ou `F.ts:120-140` → [fichier, début, fin] ; sinon null. */
function lineTarget(cible) {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(cible);
  return m ? [m[1], Number(m[2]), Number(m[3] ?? m[2])] : null;
}

const print = (file, decls, label, start, end) => {
  console.log(`== ${rel(file)}:${start}-${end} — ${label}`);
  for (let n = start; n <= end; n++)
    console.log(`${String(n).padStart(6)}\t${decls.lines[n - 1]}`);
};

for (const cible of cibles) {
  const byLine = OUTLINE ? null : lineTarget(cible);
  const at = OUTLINE || byLine ? -1 : cible.indexOf("#");
  const ref = byLine ? byLine[0] : at < 0 ? cible : cible.slice(0, at);
  const symbol = at < 0 ? null : cible.slice(at + 1);
  const files = resolveFile(ref);
  if (files.length !== 1) {
    echec++;
    console.log(
      files.length
        ? `✗ ${ref} : ${files.length} fichiers — préciser le chemin :\n${files.map((f) => `   ${rel(f)}`).join("\n")}`
        : `✗ ${ref} : aucun fichier suivi ne correspond`,
    );
    continue;
  }
  const decls = loadDeclarations(files[0]);
  if (byLine) {
    const [, from, to] = byLine;
    // L'unité la plus INTÉRIEURE qui contient toute la plage : un `it` plutôt que
    // son `describe`, une méthode plutôt que sa classe.
    const unit = unitsOf(files[0], decls, true)
      .filter((u) => u.start <= from && u.end >= to)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (unit) print(files[0], decls, unit.label, unit.start, unit.end);
    else if (from >= 1 && to <= decls.lines.length && to - from < 15)
      // Hors de toute unité (ligne vide, commentaire isolé) : la plage seule, courte.
      print(files[0], decls, "hors unité", from, to);
    else {
      echec++;
      console.log(
        `✗ ${rel(files[0])}:${from}-${to} : aucune unité ne contient cette plage (plan : --outline ${rel(files[0])})`,
      );
    }
    continue;
  }
  if (OUTLINE || symbol === null) {
    console.log(`== ${rel(files[0])} (${decls.lines.length} l.)`);
    for (const u of unitsOf(files[0], decls))
      console.log(
        `${`${u.start}-${u.end}`.padStart(11)}  ${"  ".repeat(u.indent)}${u.label}`,
      );
    continue;
  }
  let found = findDeclarations(decls, symbol);
  // Un membre cité sans sa classe : accepté s'il est unique dans le fichier.
  if (!found.length && !symbol.includes("."))
    found = decls.list.filter((d) => d.name === symbol && !d.overload);
  if (!found.length || new Set(found.map((d) => d.qualified)).size > 1) {
    echec++;
    const voisins = decls.list
      .filter((d) =>
        d.qualified
          .toLowerCase()
          .includes(symbol.split(".").pop().toLowerCase()),
      )
      .map((d) => d.qualified);
    console.log(
      `✗ ${rel(files[0])}#${symbol} : ${found.length ? "ambigu" : "introuvable"}` +
        (voisins.length
          ? ` — candidats : ${[...new Set(voisins)].slice(0, 10).join(", ")}`
          : "") +
        ` (plan : --outline ${rel(files[0])})`,
    );
    continue;
  }
  for (const d of found) {
    console.log(`== ${rel(files[0])}#${d.qualified} (l.${d.start}-${d.end})`);
    for (let n = d.start; n <= d.end; n++)
      console.log(`${String(n).padStart(6)}\t${decls.lines[n - 1]}`);
  }
}
process.exitCode = echec ? 1 : 0;
