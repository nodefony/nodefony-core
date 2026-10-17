#!/usr/bin/env node
/**
 * anchor-pair-check.mjs — après un refactor, confronte chaque ancre
 * `<Fichier>.ts:N` RECALÉE dans l'arbre de travail : le texte de la ligne
 * visée AVANT (à la révision de base) doit être identique au texte de la ligne
 * visée APRÈS (dans l'arbre). Déterministe, exhaustif sur le diff.
 *
 * Complète `anchor-remap.mjs` (qui recale) et `anchor-check.mjs` (qui ne
 * vérifie que l'existence de la ligne) : un recalage qui tombe sur une ligne
 * plausible mais différente ressort ici en écart. Ce que l'outil NE voit PAS :
 * une ancre déjà fausse AVANT le refactor, décalée fidèlement — celle-là se
 * confronte à son contexte (agent `nodefony-check-claims`).
 *
 * Les ancres sont appariées dans l'ordre, ligne retirée contre ligne ajoutée,
 * par hunk du diff ; un nombre d'ancres différent entre les deux côtés d'un
 * hunk est signalé. Une ancre dont la ligne n'a PAS changé n'entre pas dans le
 * diff, donc pas ici : l'oubli de recalage est le domaine d'`anchor-remap.mjs`.
 * Un écart n'est pas forcément une faute : corriger une ancre DÉJÀ fausse en
 * produit un, à justifier.
 *
 * @usage node .claude/skills/nodefony-documentation/scripts/anchor-pair-check.mjs src/nodefony/src/kernel/Kernel.ts
 * @usage node .claude/skills/nodefony-documentation/scripts/anchor-pair-check.mjs src/nodefony/src/kernel/Kernel.ts --base origin/dev
 * @option --base révision où les ancres étaient justes (défaut : HEAD)
 * @output « identiques: N · écarts: M » puis chaque écart (avant/après) ; exit 1 s'il y a un écart
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt === -1 ? "HEAD" : args[baseAt + 1];
const target = args.find((a, i) => !a.startsWith("--") && i !== baseAt + 1);
if (!target || !base) {
  console.error("Usage: anchor-pair-check.mjs <fichier.ts> [--base <rév>]");
  process.exit(2);
}

const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8", maxBuffer: 1e8 });
// Chemin git en `/` (il VOYAGE), lecture disque en natif.
const gitPath = target.split(path.sep).join("/");
const before = git("show", `${base}:${gitPath}`).split("\n");
const after = fs.readFileSync(path.resolve(target), "utf8").split("\n");
const diff = git("diff", "-U0", base, "--", ".", `:!${gitPath}`);

const name = path.basename(target).replace(/[.]/g, "\\.");
const RE = new RegExp(`\\b${name}:(\\d+)`, "g");
let file = "";
let minus = [];
let plus = [];
let same = 0;
const bad = [];
const flush = () => {
  const a = minus.flatMap((l) => [...l.matchAll(RE)].map((m) => Number(m[1])));
  const b = plus.flatMap((l) => [...l.matchAll(RE)].map((m) => Number(m[1])));
  if (a.length !== b.length) {
    bad.push(
      `${file} : ${a.length} ancre(s) retirée(s), ${b.length} ajoutée(s)`,
    );
  }
  // Un numéro INCHANGÉ se confronte aussi : sur une ligne réécrite, il peut
  // viser une ligne que le refactor a déplacée.
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const o = before[a[i] - 1]?.trim();
    const n = after[b[i] - 1]?.trim();
    if (o === n) same++;
    else
      bad.push(`${file} : ${a[i]}→${b[i]}\n   avant : ${o}\n   après : ${n}`);
  }
  minus = [];
  plus = [];
};
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    flush();
    file = line.slice(6);
  } else if (line.startsWith("@@")) flush();
  else if (line.startsWith("-") && !line.startsWith("---")) minus.push(line);
  else if (line.startsWith("+")) plus.push(line);
}
flush();
console.log(`identiques: ${same} · écarts: ${bad.length}`);
for (const b of bad) console.log(b);
process.exit(bad.length ? 1 : 0);
