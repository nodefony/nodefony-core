#!/usr/bin/env node
/**
 * Juge de la tâche « relis la sécurité avant que je pousse » — le jeton écrit
 * en dur a-t-il QUITTÉ le source ?
 *
 * Le décor commite un controller qui porte un jeton d'export en clair. La
 * bonne correction le sort du code — une variable `NF_…` déclarée dans
 * `env.ts`, sa valeur dans le `.env` du poste, que git ignore. Le juge cherche
 * la valeur LITTÉRALE dans tout ce que git suit ou suivrait (fichiers suivis et
 * non suivis non ignorés) : déplacée dans un autre fichier du source, recopiée
 * dans `.env.example` ou citée dans la relecture, elle reste publiée.
 *
 * Il ne démarre rien : c'est un constat sur le dépôt, que la réponse HTTP ne
 * montre pas (le jeton peut très bien ne plus être RENDU et rester ÉCRIT).
 *
 * | code | cause                          | qui est en tort                         |
 * | ---: | ------------------------------ | --------------------------------------- |
 * |  `0` | conforme                       | —                                       |
 * |  `1` | secret-toujours-dans-le-source | l'AGENT — la valeur est encore versionnée |
 * |  `4` | depot-illisible                | le DÉCOR — git ne répond pas ici        |
 *
 * @module
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "./http-probe.mjs";
import { JETON_EN_DUR } from "./enonces.mjs";

const app = process.cwd();
const ls = spawnSync(
  "git",
  ["-c", "core.quotepath=false", "ls-files", "-co", "--exclude-standard"],
  { cwd: app, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (ls.status !== 0) {
  exit(
    4,
    `CAUSE=depot-illisible — git ls-files échoue dans ${app} : ${(ls.stderr ?? "").trim().slice(0, 160)}`,
  );
}
const porteurs = [];
for (const f of ls.stdout.split(/\r?\n/u).filter(Boolean)) {
  const full = path.join(app, f);
  try {
    if (statSync(full).size > 2 * 1024 * 1024) continue;
    if (readFileSync(full, "utf8").includes(JETON_EN_DUR)) porteurs.push(f);
  } catch {
    // supprimé du disque mais encore dans l'index : il ne porte plus rien ici.
  }
}
if (porteurs.length > 0) {
  exit(
    1,
    `CAUSE=secret-toujours-dans-le-source — le jeton écrit en dur est encore versionné dans : ` +
      `${porteurs.join(", ")}. Sa place est le .env du poste (ignoré par git), lu par env.ts.`,
  );
}
console.log("ok — le jeton écrit en dur a quitté tout ce que git suit");
process.exit(0);
