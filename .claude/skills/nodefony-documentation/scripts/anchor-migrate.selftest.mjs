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
  [
    "`Q` (`src/@s/q.ts:1`) puis `:1`",
    "`Q` (`src/@s/q.ts#Q`) puis `src/@s/q.ts#Q`",
    "un chemin à `@` (paquet à portée) se lit en entier, ancre courte comprise",
  ],
];

// `--history` : le code a bougé ENTRE l'écriture de l'ancre et aujourd'hui.
// En A, `h.ts:2` est dans `Old` ; B insère `New` au-dessus et retire `Gone`.
// Lue dans le code d'aujourd'hui, l'ancre viserait `New` — le piège de #614.
const histoireA = [
  "export function Old(): void {", //  1
  "  const a = 1;", //                 2
  "}", //                              3
  "export function Gone(): void {", // 4
  "  const g = 1;", //                 5
  "}", //                              6
];
const histoireB = [
  "export function New(): void {", //  1
  "  const b = 2;", //                 2
  "}", //                              3
  ...histoireA.slice(0, 3), //         4-6
];

/** @type {Array<[string, string, string, "A" | "AB" | null]>} [avant, après, pourquoi, version] */
const casHistoire = [
  [
    "le calcul (`h.ts:2`)",
    "le calcul (`h.ts#Old`)",
    "une ancre datée se résout dans le code de SA date, pas d'aujourd'hui",
    "A",
  ],
  [
    "le départ (`h.ts:1`)",
    "le départ (`h.ts:1`)",
    "deux révisions qui divergent laissent l'ancre telle quelle",
    "AB",
  ],
  [
    "le retrait (`h.ts:5`)",
    "le retrait (`h.ts:5`)",
    "un symbole disparu depuis laisse l'ancre telle quelle",
    "A",
  ],
  [
    "le reste (`h.ts:4`)",
    "le reste (`h.ts:4`)",
    "une ancre qu'aucune version ne porte n'est pas datée",
    null,
  ],
  [
    "la valeur est à `:2` et `:5`.",
    "la valeur est à `:2` et `:5`.",
    "--keep-orphans laisse une ancre courte sans fichier, la phrase reste entière",
    null,
  ],
];

/** Joue les cas `--history` dans le dépôt jetable ; rend le nombre d'échecs. */
function casDates(racine) {
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: racine, encoding: "utf8" },
    ).trim();
  const h = path.join(racine, "src", "h.ts");
  fs.writeFileSync(h, histoireA.join("\n") + "\n");
  git("add", "src/h.ts");
  git("commit", "-q", "-m", "A");
  const A = git("rev-parse", "HEAD");
  fs.writeFileSync(h, histoireB.join("\n") + "\n");
  git("commit", "-q", "-am", "B");
  const B = git("rev-parse", "HEAD");

  const page = path.join(racine, "docs", "dated.md");
  fs.writeFileSync(page, casHistoire.map((c) => c[0]).join("\n\n") + "\n");
  const versions = ["A", "AB"].map((v) => ({
    text: casHistoire
      .filter((c) => c[3] === v)
      .map((c) => c[0])
      .join("\n"),
    revs: v === "A" ? [A] : [A, B],
  }));
  const historyPath = path.join(racine, "history.json");
  fs.writeFileSync(
    historyPath,
    JSON.stringify({ "docs/dated.md": versions }, null, 1),
  );
  const migre = spawnSync(
    process.execPath,
    [
      path.join(ICI, "anchor-migrate.mjs"),
      page,
      "--apply",
      "--history",
      historyPath,
      "--keep-orphans",
      "--report",
      path.join(racine, "rapport-date.json"),
    ],
    { cwd: racine, encoding: "utf8" },
  );
  let echecs = 0;
  const obtenu = fs.readFileSync(page, "utf8").split("\n\n");
  casHistoire.forEach(([, attendu, pourquoi], k) => {
    const ligne = obtenu[k]?.replace(/\n$/, "");
    const ok = ligne === attendu;
    if (!ok) echecs++;
    console.log(
      `${ok ? "✓" : "✗"} ${pourquoi}${ok ? "" : `\n    attendu ${JSON.stringify(attendu)}\n    obtenu  ${JSON.stringify(ligne)}\n${migre.stdout}${migre.stderr}`}`,
    );
  });
  // Trois ancres laissées : la migration le DIT par son code de sortie.
  if (migre.status !== 1) {
    echecs++;
    console.log(
      `✗ des ancres laissées font sortir en 1, obtenu ${migre.status}\n${migre.stdout}${migre.stderr}`,
    );
  }
  return echecs;
}

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-migrate-"));
let echecs = 0;
try {
  execFileSync("git", ["init", "-q"], { cwd: racine });
  for (const d of ["src", "docs"]) fs.mkdirSync(path.join(racine, d));
  fs.writeFileSync(path.join(racine, "src", "m.ts"), code.join("\n"));
  fs.mkdirSync(path.join(racine, "src", "@s"));
  fs.writeFileSync(
    path.join(racine, "src", "@s", "q.ts"),
    "export function Q(): void {}\n",
  );
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
  echecs += casDates(racine);
  console.log(
    echecs
      ? `\n${echecs} cas en échec`
      : `\n${cas.length + 1 + casHistoire.length} cas conformes`,
  );
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(racine, { recursive: true, force: true });
}
