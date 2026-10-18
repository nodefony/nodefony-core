#!/usr/bin/env node
// Éprouve `anchor-migrate.mjs --apply` sur un dépôt JETABLE : chaque règle de
// conversion a son cas, la page convertie doit être EXACTEMENT celle attendue,
// puis passer le gate (`anchor-check` sans option, qui refuse toute ligne).
//
// Le cas « ligne glissée » est celui qui a été vécu : `webhooks.ts:63` pour une
// constante déclarée en 62, jugée juste par l'ancien contrôle. Se rabattre sur
// l'englobant aurait figé la constante VOISINE.
//
// `@usage` node .claude/skills/nodefony-documentation/scripts/anchor-migrate.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));

const code = [
  "/** Doc de Alpha. */", //                       1
  "export function Alpha(): void {", //            2
  "  const x = 1;", //                             3
  "}", //                                          4
  "", //                                           5
  "export class Kls {", //                           6
  "  gc(): void {", //                             7
  "    helper();", //                              8
  "  }", //                                        9
  "}", //                                          10
  "export function helper(): void {}", //          11
  'console.log("top");', //                        12
  "export const LIMIT = 20;", //                   13
  "export const OTHER = 30;", //                   14
];

/** @type {Array<[string, string, string]>} [avant, après, pourquoi] */
const cas = [
  ["`Alpha()` (`m.ts:2`)", "`Alpha()` (`m.ts#Alpha`)", "la déclaration citée"],
  [
    "la boucle (`m.ts:3`)",
    "la boucle (`m.ts#Alpha`)",
    "une instruction se rabat sur la fonction qui la contient",
  ],
  [
    "`Kls.gc()` (`m.ts:7`) appelle `helper` (`m.ts:8`)",
    "`Kls.gc()` (`m.ts#Kls.gc`) appelle `helper` (`m.ts#helper`)",
    "un site d'usage vise le symbole CITÉ, pas sa méthode englobante",
  ],
  [
    "`LIMIT` (`m.ts:14`)",
    "`LIMIT` (`m.ts#LIMIT`)",
    "une ligne qui a glissé sur la constante voisine vise la constante citée",
  ],
  [
    "`Kls` (`m.ts:8`)",
    "`Kls` (`m.ts#Kls.gc`)",
    "la classe citée ne gagne pas sur la méthode qu'elle contient",
  ],
  [
    "au démarrage (`m.ts:12`)",
    "au démarrage (`m.ts`)",
    "hors de toute déclaration, l'ancre garde le fichier seul",
  ],
  [
    "`helper` (`m.ts:11`, `:2`)",
    "`helper` (`m.ts#helper`, `m.ts#Alpha`)",
    "une ancre courte prend le fichier de sa voisine, écrit en entier",
  ],
  [
    "`gc()` `:7` · `helper()` `:11`, puis (`:3`) et `x`, `:4`",
    "`gc()` · `helper()`, puis et `x`",
    "une ancre courte SANS fichier est retirée avec son séparateur",
  ],
  [
    "```ts\n// voir m.ts:3\n```",
    "```ts\n// voir m.ts#Alpha\n```",
    "bloc de code",
  ],
  [
    "`helper` (`m.ts:11`) et `gc()` `:7/:8`",
    "`helper` (`m.ts#helper`) et `gc()`",
    "la forme multiple `:N/:M` est retirée",
  ],
  [
    "au départ (`m.ts:12`, `m.ts:12`, `m.ts:12`)",
    "au départ (`m.ts`)",
    "trois ancres vers le même fichier n'en font qu'une",
  ],
  [
    "`:3` reste lisible",
    "reste lisible",
    "un retrait en tête de ligne ne laisse pas d'espace",
  ],
];

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-migrate-"));
let echecs = 0;
try {
  execFileSync("git", ["init", "-q"], { cwd: racine });
  for (const d of ["src", "docs"]) fs.mkdirSync(path.join(racine, d));
  fs.writeFileSync(path.join(racine, "src", "m.ts"), code.join("\n"));
  const page = path.join(racine, "docs", "page.md");
  // Une ligne vide entre les cas : une ligne qui en continue une autre en
  // hérite le contexte, et les cas se jugeraient l'un l'autre.
  fs.writeFileSync(page, cas.map((c) => c[0]).join("\n\n") + "\n");

  const migre = spawnSync(
    process.execPath,
    [
      path.join(ICI, "anchor-migrate.mjs"),
      page,
      "--apply",
      "--report",
      path.join(racine, "rapport.json"),
    ],
    { cwd: racine, encoding: "utf8" },
  );
  const obtenu = fs.readFileSync(page, "utf8").split("\n\n");
  cas.forEach(([, attendu, pourquoi], k) => {
    const ligne = obtenu[k]?.replace(/\n$/, "");
    const ok = ligne === attendu;
    if (!ok) echecs++;
    console.log(
      `${ok ? "✓" : "✗"} ${pourquoi}${ok ? "" : `\n    attendu ${JSON.stringify(attendu)}\n    obtenu  ${JSON.stringify(ligne)}`}`,
    );
  });
  if (migre.status !== 0) {
    echecs++;
    console.log(`✗ la migration sort en ${migre.status}\n${migre.stdout}`);
  }
  // La page convertie passe le GATE : plus aucune ligne, chaque symbole existe.
  const gate = spawnSync(
    process.execPath,
    [path.join(ICI, "anchor-check.mjs"), page],
    { cwd: racine, encoding: "utf8" },
  );
  const gateOk = gate.status === 0 && /\d+ ancres — /.test(gate.stdout);
  if (!gateOk) echecs++;
  console.log(
    `${gateOk ? "✓" : "✗"} la page convertie passe le gate${gateOk ? "" : `\n${gate.stdout}`}`,
  );
  console.log(
    echecs ? `\n${echecs} cas en échec` : `\n${cas.length + 1} cas conformes`,
  );
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(racine, { recursive: true, force: true });
}
