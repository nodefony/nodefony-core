/**
 * Corpus d'équivalence du terminal du superviseur (#896).
 *
 * Chaque levier de performance du rendu doit laisser ces sorties IDENTIQUES :
 * c'est ce corpus que `terminalEquivalence.test.ts` passe à la largeur, à
 * l'image et à la ligne d'état, et dont il compare le résultat aux fichiers de
 * référence commités. Une entrée = un piège déjà payé ou prévisible : couleur,
 * caractère large, graphème composé, lien, séquence tronquée.
 */

const ESC = "\x1b";

/** Les lignes du corpus, par nom — l'ordre fait partie du contrat. */
export const TERMINAL_CORPUS: Readonly<Record<string, string>> = {
  empty: "",
  ascii: "GET /api/users 200 1.2 ms",
  sgr: `${ESC}[32mINFO${ESC}[0m  ${ESC}[36mHTTP${ESC}[0m  GET /x ${ESC}[1;31m500${ESC}[0m fin`,
  sgrExtended: `${ESC}[38;5;208morange${ESC}[0m ${ESC}[38;2;10;20;30mrgb${ESC}[39m ${ESC}[mreset`,
  emoji: "✅ prêt 👍🏽 famille 👨‍👩‍👧 drapeau 🇫🇷 cœur ❤️ fin",
  cjk: "漢字のテスト 한국어 全角ＡＢＣ",
  combining: "été café ä ñ",
  zeroWidth: "a​b‍c﻿d",
  linkSt: `voir ${ESC}]8;;https://nodefony.net${ESC}\\le site${ESC}]8;;${ESC}\\ maintenant`,
  linkBel: `${ESC}]8;;file:///tmp/a.ts\x07a.ts:12${ESC}]8;;\x07 ouvert`,
  linkColored: `${ESC}[34m${ESC}]8;;http://127.0.0.1:5151${ESC}\\http://127.0.0.1:5151${ESC}]8;;${ESC}\\${ESC}[0m prêt`,
  truncatedCsi: `coupé ${ESC}[3`,
  loneEsc: `a${ESC}b fin${ESC}`,
  eraseInLine: `texte${ESC}[K suite`,
  controls: "\x07cloche\x08 retour",
  tab: "a\tb\tc",
  longAscii: "0123456789".repeat(30),
  longSgr: `${ESC}[33m${"jaune ".repeat(20)}${ESC}[0m${"neutre ".repeat(10)}${ESC}[1m${"gras ".repeat(10)}${ESC}[0m`,
  longCjk: "漢字".repeat(60),
  longEmoji: "👨‍👩‍👧 ✅ ".repeat(30),
  longLink: `${ESC}]8;;https://example.org/${"x".repeat(40)}${ESC}\\${"lien long ".repeat(12)}${ESC}]8;;${ESC}\\ après`,
  mixed: `${ESC}[31m✗${ESC}[0m 漢字 é ${ESC}]8;;https://a.b${ESC}\\lien${ESC}]8;;${ESC}\\ 👍🏽 ${ESC}[2mgris${ESC}[22m`,
};

/** Largeurs de repli et de coupe éprouvées : les bords (1, 2) et l'ordinaire. */
export const TERMINAL_WIDTHS: readonly number[] = [1, 2, 5, 20, 79];
