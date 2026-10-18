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
  // `scripts/` volontairement ABSENT : l'outil ne balaye que les racines
  // présentes, un dossier manquant ne doit pas le faire tomber.
  for (const d of ["src", "docs"]) {
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

  // 4e élément : les options du contrôle — par défaut `--lines`, l'ancien
  // jugement des ancres de ligne ; `[]` = le GATE, qui les refuse.
  /** @type {Array<[string, string[], string, string[]?]>} */
  const cas = [
    // [ligne de la page, verdict attendu, pourquoi ce cas existe]
    [
      "`Alpha()` (`deco.ts:9`), `K.gc()` (`deco.ts#K.gc`), `Beta` `:30`",
      ["LINE_ANCHOR deco.ts:9", "LINE_ANCHOR deco.ts:30"],
      "le gate REFUSE toute ancre de ligne, même juste, longue ou courte",
      [],
    ],
    [
      "`Alpha()` (`deco.ts#Alpha`) et la ligne `:12` sans fichier",
      ["LINE_ANCHOR `:12`"],
      "une ancre courte sans fichier est refusée aussi",
      [],
    ],
    [
      "`Alpha()` (`deco.ts#Alpha`), `K.gc()` (`deco.ts#K.gc`)",
      [],
      "une ancre par symbole, de premier niveau ou membre, est OK",
    ],
    [
      "`onConnect` (`deco.ts#Orm.onConnect`)",
      [],
      "une méthode abstraite (sans corps) reste un symbole",
    ],
    [
      "`renamed` (`deco.ts#K.renamed`), `gone` (`deco.ts#Gone`)",
      ["SYMBOL_NOT_FOUND deco.ts#K.renamed", "SYMBOL_NOT_FOUND deco.ts#Gone"],
      "un symbole renommé ou supprimé fait échouer le contrôle en le nommant",
    ],
    [
      "`missing.ts#Alpha`",
      ["FILE_NOT_FOUND missing.ts#Alpha"],
      "une ancre par symbole vers un fichier absent est refusée",
    ],
    [
      "voir https://github.com/x/y/blob/main/src/deco.ts#L13 et `deco.ts#L13`",
      [],
      "un fragment de ligne GitHub ou une URL n'est pas une ancre par symbole",
    ],
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
    // Vécu (corps d'un ticket) : la FORME COURTE `:N` reprend le fichier de
    // l'ancre précédente. Invisible au découpage, elle laissait le symbole
    // qu'elle prouve juger l'ancre longue d'avant — SUSPECT, puis recalée
    // dessus par anchor-fix (232 → 744, une ancre juste rendue fausse).
    [
      "la phrase citée (`deco.ts:9`) puis `applyX` (`:76`)",
      [],
      "le symbole d'une ancre COURTE `:N` ne juge pas l'ancre longue d'avant",
    ],
    // Le symbole entre parenthèses JUSTE APRÈS l'ancre est le sien, même quand
    // une autre ancre suit : le couper la jugeait sans symbole, donc OK.
    [
      "le socle `deco.ts:9` (`applyX`), puis `deco.ts:30` (`Beta`)",
      ["SUSPECT deco.ts:9"],
      "le symbole `(…)` qui suit une ancre la juge, même suivie d'une autre",
    ],
    // L'ancre COURTE est une ancre : elle hérite du fichier de l'ancre longue
    // qui la précède, et dérive comme elle. Jamais contrôlée, 67 l'étaient.
    [
      "`Alpha()` (`deco.ts:9`) et `applyX` (`:30`)",
      ["SUSPECT deco.ts:30"],
      "une ancre COURTE `:N` qui a dérivé se voit",
    ],
    [
      "`Alpha()` (`deco.ts:9`) et `applyX` (`:76`)",
      [],
      "une ancre COURTE `:N` juste se tait",
    ],
    [
      "> Le hub diffuse par `applyX()`\n> (`deco.ts:9`) sur chaque canal.",
      ["SUSPECT deco.ts:9"],
      "une citation coupée par prettier reste UNE phrase : sa dérive se voit",
    ],
    // Mais le fichier d'une ancre courte est SUPPOSÉ : l'auteur vise parfois le
    // fichier implicite de la section. Si le fichier supposé ne connaît pas le
    // symbole, ou n'a pas cette ligne, on ne juge pas — non contrôlée.
    [
      "`Alpha()` (`deco.ts:9`) puis `ingestWelcome` (`:957`)",
      [],
      "une ancre COURTE qui vise un autre fichier n'est pas jugée",
    ],
    [
      "`Alpha()` (`deco.ts:9`) puis `ingestWelcome` (`:40`)",
      [],
      "une ancre COURTE dont le symbole est inconnu du fichier supposé n'est pas jugée",
    ],
    // Même famille : un NOUVEL item de liste n'est pas la suite de la ligne du
    // dessus — prettier ne coupe pas entre deux puces.
    [
      "- `applyX` vit ailleurs.\n- La commande nue : `deco.ts:9`",
      [],
      "le symbole de la puce du DESSUS ne juge pas l'ancre de la suivante",
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
  for (const [ligne, attendu, pourquoi, options = ["--lines"]] of cas) {
    const page = path.join(racine, "page.md");
    fs.writeFileSync(page, `# Page\n\n${ligne}\n`);
    const r = spawnSync(process.execPath, [OUTIL, ...options, page], {
      cwd: racine,
      encoding: "utf8",
    });
    const obtenu = [
      ...r.stdout.matchAll(
        /\[(SUSPECT|INDECIS|LINE_OUT|FILE_NOT_FOUND|SYMBOL_NOT_FOUND|LINE_ANCHOR)\] l\.\d+ (\S+)/g,
      ),
    ]
      .map((m) => `${m[1]} ${m[2]}`)
      .sort();
    // Un outil qui a planté ne rend AUCUN suspect : sans ce bilan, chaque cas
    // « rien à signaler » passerait à vide.
    // Le code de sortie EST le gate : un SUSPECT attendu doit faire échouer
    // l'outil, sinon la CI le rapporte et passe.
    const statutAttendu = attendu.some((a) => !a.startsWith("INDECIS")) ? 1 : 0;
    const aTourne = /\d+ ancres — /.test(r.stdout);
    const statutOk = r.status === statutAttendu;
    const ok =
      aTourne &&
      statutOk &&
      JSON.stringify(obtenu) === JSON.stringify([...attendu].sort());
    if (!ok) echecs++;
    console.log(
      `${ok ? "✓" : "✗"} ${pourquoi}${aTourne ? "" : `\n    l'outil n'a pas tourné : ${r.stderr.split("\n")[0]}`}${ok || !aTourne ? "" : `\n    attendu ${JSON.stringify(attendu)} (exit ${statutAttendu})\n    obtenu  ${JSON.stringify(obtenu)} (exit ${r.status})`}`,
    );
  }
  console.log(
    echecs ? `\n${echecs} cas en échec` : `\n${cas.length} cas conformes`,
  );
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(racine, { recursive: true, force: true });
}
