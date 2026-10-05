#!/usr/bin/env node
// Éprouve `anchor-fix.mjs` sur un dépôt JETABLE : chaque ancre SUSPECTE doit
// être recalée sur la déclaration du symbole qu'ELLE prouve — jamais sur celui
// d'une ancre voisine. Un outil qui corrige qu'on n'a jamais vu se tromper
// n'est pas un outil, c'est un pari.
//
// Le cas « tableau » est celui qui a été vécu : quatre rangées
// `` `fichier.ts:N` (`Symbole`) `` — le symbole APRÈS l'ancre. L'outil prenait
// le symbole de la rangée du DESSUS (ligne précédente) : chaque ancre recalée
// sur la déclaration de sa voisine, décalée d'une rangée, et rendue « OK ».
// Le cas « prose » garde l'acquis : le symbole cité AVANT l'ancre, coupé par
// prettier sur la ligne précédente (`RealtimeHub.publish()` puis l'ancre).
//
// `@usage` node .claude/skills/nodefony-documentation/scripts/anchor-fix.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(SCRIPTS, "anchor-check.mjs");
const FIX = path.join(SCRIPTS, "anchor-fix.mjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-fix-selftest-"));
let failures = 0;
const expect = (label, actual, wanted) => {
  if (actual === wanted) return;
  failures++;
  console.error(`✖ ${label} : attendu ${wanted}, obtenu ${actual}`);
};

try {
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const d of ["src", "docs", "bin", "scripts"]) {
    fs.mkdirSync(path.join(root, d));
  }

  // Déclarations espacées : une ancre périmée tombe loin de toutes.
  const code = Array.from({ length: 200 }, () => "");
  const declare = (line, text) => {
    code[line - 1] = text;
  };
  declare(20, "export function renderBar(): string {");
  declare(60, "export abstract class LiveLine {");
  declare(100, "export class Spinner extends LiveLine {");
  declare(140, "export class ProgressBar extends LiveLine {");
  declare(170, "export class RealtimeHub {");
  declare(180, "  publish(channel: string): void {");
  fs.writeFileSync(path.join(root, "src", "progress.ts"), code.join("\n"));

  // Les ancres d'AVANT : chacune décalée, toutes vers une zone vide.
  const page = [
    "# Où vit quoi",
    "",
    "| Ce qu'on cherche | Où c'est |",
    "| ---------------- | -------- |",
    "| Le socle         | `src/progress.ts:10` (`LiveLine`)    |",
    "| Le tourniquet    | `src/progress.ts:50` (`Spinner`)     |",
    "| La barre         | `src/progress.ts:90` (`ProgressBar`) |",
    "| Le dessin pur    | `src/progress.ts:130`, `renderBar`    |",
    "| `LiveLine` fille | `src/progress.ts:95` (`Spinner`)     |",
    "",
    "Le hub diffuse par `RealtimeHub.publish()`",
    "(`src/progress.ts:150`) sur chaque canal.",
    "",
  ];
  const md = path.join(root, "docs", "page.md");
  fs.writeFileSync(md, page.join("\n"));

  const report = spawnSync(process.execPath, [CHECK, "docs/page.md"], {
    cwd: root,
    encoding: "utf8",
  }).stdout;
  const fix = spawnSync(process.execPath, [FIX, ".", "--apply"], {
    cwd: root,
    input: report,
    encoding: "utf8",
  });
  if (fix.status !== 0 && fix.status !== 1) {
    failures++;
    console.error(`✖ anchor-fix a échoué (code ${fix.status})\n${fix.stderr}`);
  }

  const after = fs.readFileSync(md, "utf8");
  const rowOf = (needle) => {
    const row = after.split("\n").find((l) => l.includes(needle)) ?? "";
    const m = /progress\.ts:(\d+)/.exec(row);
    return m ? Number(m[1]) : null;
  };
  expect("rangée LiveLine", rowOf("Le socle"), 60);
  expect(
    "rangée Spinner (pas la déclaration de la rangée du dessus)",
    rowOf("Le tourniquet"),
    100,
  );
  expect("rangée ProgressBar", rowOf("La barre"), 140);
  // Symbole APRÈS l'ancre mais hors parenthèses : seule la garde « jamais la
  // rangée du dessus » évite `ProgressBar`.
  expect(
    "rangée renderBar (symbole après, sans parenthèses)",
    rowOf("Le dessin pur"),
    20,
  );
  // Un symbole AVANT et un APRÈS : c'est celui qui suit l'ancre qu'elle prouve.
  expect("rangée « LiveLine fille » → Spinner", rowOf("fille"), 100);
  const prose = /\(`src\/progress\.ts:(\d+)`\) sur chaque canal/.exec(after);
  expect(
    "prose : symbole cité AVANT l'ancre, sur la ligne précédente",
    prose ? Number(prose[1]) : null,
    180,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`anchor-fix.selftest : ${failures} échec(s)`);
  process.exit(1);
}
console.log("✔ anchor-fix.selftest : chaque ancre recalée sur SON symbole");
