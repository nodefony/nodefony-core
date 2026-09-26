#!/usr/bin/env node
// Éprouve `anchor-check.mjs` sur un dépôt JETABLE : il doit signaler une ancre
// qui a DÉRIVÉ loin de la déclaration qu'elle prouve, et se taire sur une ancre
// juste — posée sur la déclaration, dans son TSDoc, ou sur un site d'usage.
// Un gate qu'on n'a jamais vu échouer n'est pas un gate.
//
// Le cas « dérive » est celui qui a été vécu : trois décorateurs cités sur une
// même rangée, chaque ancre décalée de 40 à 50 lignes, toutes rendues OK parce
// qu'un mot VOISIN de la rangée traînait dans la fenêtre large.
//
// `@usage` node .claude/skills/nodefony-documentation/scripts/anchor-check.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const OUTIL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "anchor-check.mjs",
);

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-selftest-"));
try {
  execFileSync("git", ["init", "-q"], { cwd: racine });
  // L'outil balaye ces quatre racines : absentes, son `find` échoue.
  for (const d of ["src", "docs", "bin", "scripts"]) {
    fs.mkdirSync(path.join(racine, d));
  }

  // Alpha : TSDoc l.1-8 (plus long que la tolérance fixe de 3 lignes), déclaration
  // l.9 ; un usage de Beta l.12 ; `BetaFactory` l.20 (le mot voisin qui trompait) ;
  // Beta déclaré l.30.
  const code = Array.from({ length: 80 }, () => "");
  code[0] = "/**";
  for (let i = 1; i < 7; i++)
    code[i] = " * Fait une chose — sans nommer le symbole.";
  code[7] = " */";
  code[8] = "export function Alpha(): void {}";
  code[11] = "const b = Beta();";
  code[19] = "export type BetaFactory = () => void;";
  code[29] = "export function Beta(): void {}";
  // K l.41-44 : un getter de deux lettres (`nc`) et `gc`. IOpts l.46-48 : la
  // CLÉ `state` n'est qu'une signature — la logique qui la consomme (l.60)
  // l'écrit `STATE_KEY`. `onConnect` abstrait l.52, dérivé de huit lignes de
  // l'ancre l.44. `applyX` l.76, dont le TSDoc (l.62-75) nomme `NF__X__`.
  code[40] = "export abstract class K {";
  code[41] = "  private get nc(): number { return 1; }";
  code[42] = "  async gc(): Promise<void> {}";
  code[43] = "}";
  code[45] = "export interface IOpts {";
  code[46] = "  state: string;";
  code[47] = "}";
  code[48] = "export abstract class Orm {";
  code[49] = "  x = 1;";
  code[51] = "  protected abstract onConnect(): void;";
  code[52] = "}";
  code[59] = "session.set(STATE_KEY, null);";
  code[61] = "/**";
  code[62] = " * Applique les surcharges `NF__X__*`.";
  for (let i = 63; i < 74; i++) code[i] = " * Détail sans nommer la variable.";
  code[74] = " */";
  code[75] = "export function applyX(): void {}";
  fs.writeFileSync(path.join(racine, "src", "deco.ts"), code.join("\n"));

  /** @type {Array<[string, string[], string]>} */
  const cas = [
    // [ligne de la page, verdict attendu, pourquoi ce cas existe]
    [
      "| Rangée | `Alpha()` (`deco.ts:24`), `Beta()` (`deco.ts:9`) |",
      ["SUSPECT deco.ts:24", "SUSPECT deco.ts:9"],
      "une ancre DÉRIVÉE est signalée même si un mot voisin traîne à côté",
    ],
    ["`Alpha()` (`deco.ts:9`)", [], "l'ancre posée sur la déclaration est OK"],
    [
      "`Alpha()` (`deco.ts:2`)",
      [],
      "l'ancre dans le TSDoc de la déclaration est OK",
    ],
    [
      "`Beta()` (`deco.ts:12`)",
      [],
      "l'ancre sur un site d'USAGE du symbole est OK",
    ],
    // Deux ancres dans une phrase : le contexte de l'une n'est pas celui de l'autre.
    [
      "`Alpha()` (`deco.ts:9`) croisé avec la classe (`deco.ts:41`)",
      [],
      "le symbole d'une ancre PRÉCÉDENTE ne juge pas la suivante",
    ],
    [
      "la classe (`deco.ts:41`), puis `Alpha` (`deco.ts:9`)",
      [],
      "le symbole qui SUIT une ancre appartient à la suivante",
    ],
    [
      "`Alpha()` (`deco.ts:9`) ; getter `K.nc` (`deco.ts:42`), `K.gc()` (`deco.ts:43`)",
      [],
      "un membre QUALIFIÉ de deux lettres est un symbole, pas du bruit",
    ],
    [
      "| Rejeu | `state` à usage unique (`deco.ts:60`) |",
      [],
      "une CLÉ déclarée en signature d'options ne rejette pas l'ancre sur sa logique",
    ],
    [
      "`Orm.onConnect()` (`deco.ts:44`)",
      ["SUSPECT deco.ts:44"],
      "une méthode ABSTRAITE est une déclaration : la dérive se voit",
    ],
    [
      "| Déploiement | `NF__X__…` (`deco.ts:76`) |",
      [],
      "le TSDoc de la déclaration pointée fait partie de sa fenêtre",
    ],
  ];

  let echecs = 0;
  for (const [ligne, attendu, pourquoi] of cas) {
    const page = path.join(racine, "page.md");
    fs.writeFileSync(page, `# Page\n\n${ligne}\n`);
    const r = spawnSync(process.execPath, [OUTIL, page], {
      cwd: racine,
      encoding: "utf8",
    });
    const obtenu = [
      ...r.stdout.matchAll(
        /\[(SUSPECT|INDECIS|LINE_OUT|FILE_NOT_FOUND)\] l\.\d+ (\S+)/g,
      ),
    ]
      .map((m) => `${m[1]} ${m[2]}`)
      .sort();
    // Un outil qui a planté ne rend AUCUN suspect : sans ce bilan, chaque cas
    // « rien à signaler » passerait à vide.
    const aTourne = r.status === 0 && /\d+ ancres — /.test(r.stdout);
    const ok =
      aTourne && JSON.stringify(obtenu) === JSON.stringify([...attendu].sort());
    if (!ok) echecs++;
    console.log(
      `${ok ? "✓" : "✗"} ${pourquoi}${aTourne ? "" : `\n    l'outil n'a pas tourné : ${r.stderr.split("\n")[0]}`}${ok || !aTourne ? "" : `\n    attendu ${JSON.stringify(attendu)}\n    obtenu  ${JSON.stringify(obtenu)}`}`,
    );
  }
  console.log(
    echecs ? `\n${echecs} cas en échec` : `\n${cas.length} cas conformes`,
  );
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(racine, { recursive: true, force: true });
}
