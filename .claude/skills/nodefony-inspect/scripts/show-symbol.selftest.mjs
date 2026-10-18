#!/usr/bin/env node
// Éprouve `show-symbol.mjs` sur un dépôt JETABLE : la déclaration rendue doit
// être EXACTEMENT celle demandée (TSDoc compris, rien autour), le plan doit lister
// chaque déclaration, et une cible fausse doit faire échouer l'outil en le disant.
//
// `@usage` node .claude/skills/nodefony-inspect/scripts/show-symbol.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const OUTIL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "show-symbol.mjs",
);
const code = [
  'import x from "y";', //                 1
  "", //                                     2
  "/** Le service. */", //                   3
  "export class Svc {", //                   4
  "  /** Démarre. */", //                    5
  "  start(): void {", //                    6
  "    x();", //                             7
  "  }", //                                  8
  "", //                                     9
  "  stop(): void {}", //                    10
  "}", //                                    11
  "export function helper(): void {}", //    12
];

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "show-symbol-"));
let echecs = 0;
const run = (...args) =>
  spawnSync(process.execPath, [OUTIL, ...args], {
    cwd: racine,
    encoding: "utf8",
  });
const check = (ok, pourquoi, detail) => {
  if (!ok) echecs++;
  console.log(`${ok ? "✓" : "✗"} ${pourquoi}${ok ? "" : `\n${detail}`}`);
};
try {
  execFileSync("git", ["init", "-q"], { cwd: racine });
  fs.mkdirSync(path.join(racine, "src", "a"), { recursive: true });
  fs.mkdirSync(path.join(racine, "src", "b"), { recursive: true });
  fs.writeFileSync(path.join(racine, "src", "a", "svc.ts"), code.join("\n"));
  fs.writeFileSync(
    path.join(racine, "src", "b", "svc.ts"),
    "export const z = 1;\n",
  );
  execFileSync("git", ["add", "-A"], { cwd: racine });

  let r = run("a/svc.ts#Svc.start");
  const lignes = r.stdout.trim().split("\n");
  check(
    r.status === 0 &&
      lignes[0] === "== src/a/svc.ts#Svc.start (l.5-8)" &&
      lignes.length === 5 &&
      lignes[1].endsWith("\t  /** Démarre. */") &&
      lignes[4].endsWith("\t  }"),
    "un membre est rendu en entier, TSDoc compris, et rien autour",
    r.stdout,
  );
  r = run("a/svc.ts#stop");
  check(
    r.status === 0 && r.stdout.startsWith("== src/a/svc.ts#Svc.stop (l.10-10)"),
    "un nom de membre nu, unique dans le fichier, est accepté",
    r.stdout,
  );
  r = run("--outline", "a/svc.ts");
  check(
    r.status === 0 &&
      [
        "3-11  Svc",
        "5-8    Svc.start",
        "10-10    Svc.stop",
        "12-12  helper",
      ].every((l) => r.stdout.includes(l)),
    "le plan liste chaque déclaration avec sa plage",
    r.stdout,
  );
  r = run("a/svc.ts#Svc.gone");
  check(
    r.status === 1 && r.stdout.includes("introuvable"),
    "un symbole absent fait échouer l'outil en le disant",
    r.stdout,
  );
  r = run("svc.ts#Svc");
  check(
    r.status === 1 &&
      r.stdout.includes("2 fichiers") &&
      r.stdout.includes("src/b/svc.ts"),
    "une fin de chemin ambiguë liste les fichiers au lieu d'en choisir un",
    r.stdout,
  );
  console.log(echecs ? `\n${echecs} cas en échec` : "\n5 cas conformes");
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(racine, { recursive: true, force: true });
}
