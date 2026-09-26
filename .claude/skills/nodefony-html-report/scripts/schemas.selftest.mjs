#!/usr/bin/env node
/**
 * Auto-contrôle du lecteur mermaid de `schemas.mjs` — ce qu'il ne doit JAMAIS
 * perdre en silence.
 *
 * Une flèche que le lecteur ne reconnaît pas ne lève rien : elle disparaît, le
 * schéma se rend quand même, et ses nœuds s'alignent sur une seule rangée qui,
 * trop large pour la colonne, est ensuite réduite jusqu'à l'illisible. Vécu sur
 * le site de documentation : les étiquettes EN LIGNE de mermaid
 * (`A -- texte --> B`, `A -. texte .-> B`) étaient jetées sur quatre pages.
 *
 * ```bash
 * node .claude/skills/nodefony-html-report/scripts/schemas.selftest.mjs
 * ```
 */
import { lireMermaid } from "../lib/schemas.mjs";

let rouges = 0;
const cas = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${nom}${ok ? "" : ` — attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`}`,
  );
};
const aretes = (src) =>
  lireMermaid(src).aretes.map((a) => [a.de, a.vers, a.etiquette, a.pointille]);

console.log("━━ les étiquettes de flèche, sous toutes leurs formes");
cas("forme |texte| (pleine)", aretes("flowchart TB\n  A -->|lit| B"), [
  ["A", "B", "lit", false],
]);
cas(
  "forme en ligne, pleine, entre guillemets",
  aretes('flowchart TB\n  A -- "1 socket, N canaux" --> B'),
  [["A", "B", "1 socket, N canaux", false]],
);
cas(
  "forme en ligne, pleine, sans guillemets",
  aretes("flowchart TB\n  A -- fan-out --> B"),
  [["A", "B", "fan-out", false]],
);
cas(
  "forme en ligne, pointillée",
  aretes('flowchart TB\n  A -. "lit à travers" .-> K'),
  [["A", "K", "lit à travers", true]],
);
cas(
  "forme en ligne, lien sans pointe",
  aretes('flowchart TB\n  A -- "voisin" --- B'),
  [["A", "B", "voisin", false]],
);
cas(
  "une flèche simple reste une flèche simple",
  aretes("flowchart LR\n  A --> B\n  B -.-> C\n  C --- D"),
  [
    ["A", "B", null, false],
    ["B", "C", null, true],
    ["C", "D", null, false],
  ],
);
cas(
  "un nœud déclaré avec sa forme garde son libellé",
  lireMermaid('flowchart TB\n  A["Carte"] -- "lit" --> B["Calque"]').noeuds.map(
    (n) => n.texte.join(" "),
  ),
  ["Carte", "Calque"],
);

console.log(
  rouges ? `\n❌ ${rouges} cas rouge(s)` : "\n✅ tous les cas passent",
);
process.exit(rouges ? 1 : 0);
