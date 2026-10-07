#!/usr/bin/env node
/**
 * Auto-contrôle des règles de lisibilité des figures (`figures.mjs`).
 *
 * Chaque cas est un défaut CONSTATÉ à l'image dans la console d'administration,
 * puis sa forme corrigée, qui doit passer.
 *
 * ```bash
 * node .claude/skills/nodefony-documentation/scripts/figures.selftest.mjs
 * ```
 */
import { defautsDesFigures, DIRECTIVE_COURBE } from "./figures.mjs";

let rouges = 0;
const cas = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${nom}${ok ? "" : ` — attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`}`,
  );
};
const fence = (corps) => "```mermaid\n" + corps + "\n```\n";
const compte = (src) => {
  const r = defautsDesFigures(src);
  return [r.erreurs.length, r.avertissements.length];
};

console.log("━━ les courbes");
cas(
  "une courbe nue : sans couleur ET sans taille",
  compte(fence('xychart-beta\n  title "T"\n  line [1, 2, 3]')),
  [2, 0],
);
cas(
  "une courbe avec la directive complète passe",
  compte(
    fence(DIRECTIVE_COURBE + '\nxychart-beta\n  title "T"\n  line [1, 2, 3]'),
  ),
  [0, 0],
);
cas(
  "la couleur seule ne suffit pas",
  compte(
    fence(
      '%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#0072B2"}}}}%%\nxychart-beta\n  line [1, 2]',
    ),
  ),
  [1, 0],
);

console.log("━━ les organigrammes");
cas(
  "un flux vertical de 5 rangs est signalé",
  compte(fence("flowchart TB\n  A --> B\n  B --> C\n  C --> D\n  D --> E")),
  [0, 1],
);
cas(
  "le même flux horizontal ne l'est pas",
  compte(fence("flowchart LR\n  A --> B\n  B --> C\n  C --> D\n  D --> E")),
  [0, 0],
);
cas(
  "un flux vertical de 4 rangs passe",
  compte(fence("flowchart TB\n  A --> B\n  B --> C\n  C --> D")),
  [0, 0],
);
cas(
  "une séquence n'est ni une courbe ni un flux",
  compte(fence("sequenceDiagram\n  A->>B: x")),
  [0, 0],
);

console.log(
  rouges ? `\n❌ ${rouges} cas rouge(s)` : "\n✅ tous les cas passent",
);
process.exit(rouges ? 1 : 0);
