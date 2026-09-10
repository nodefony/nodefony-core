#!/usr/bin/env node
/**
 * Les thèmes de `RETEX.md` qui ont atteint le seuil de graduation.
 *
 * 🔴 Pourquoi ce script existe. Le seuil « un thème à ~5 frictions distinctes se
 * gradue en mémoire `feedback_*` » vivait dans le TEXTE du skill `nodefony-session`
 * — donc nulle part : personne n'y pense en clôturant une session. Mesuré au
 * CONSOLIDATE du 2026-09-07 : **95 retex écrits, 2 mémoires créées**, et le sas
 * avait enflé à **2902 lignes** pour 41 thèmes et ~475 frictions, alors que sa
 * raison d'être est de tenir en un écran et d'être relu à chaque reprise. Sept
 * thèmes dépassaient le seuil depuis des semaines, dont un à **47 frictions**.
 *
 * Une règle en prose n'est appliquée que si quelqu'un y pense au bon moment.
 * Celle-ci se compte, donc elle s'automatise. [[feedback_gate_must_run]]
 *
 * Il ne JUGE pas : graduer demande de lire le thème et de lui trouver sa maison,
 * ce qu'aucun compte ne remplace. Il dit seulement où regarder — et il le dit au
 * moment où l'on clôture, pas quinze jours plus tard.
 *
 *   npm run retex:seuil          # les thèmes au-dessus du seuil
 *   npm run retex:seuil -- --all # tous, avec leur compte
 *
 * Sortie : toujours 0 — c'est un indicateur, pas un gate. Un sas trop plein
 * n'est pas une faute à bloquer, c'est un travail à programmer.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Au-delà, le thème est mûr pour une mémoire `feedback_*`. */
const SEUIL = 5;

const SAS = path.join("docs", "session-retros", "RETEX.md");

/**
 * Les thèmes du sas et leur nombre de frictions.
 *
 * Un thème est un titre de niveau 2 ; une friction est une puce de premier
 * niveau dont le libellé ouvre sur `[` — que le gras vienne avant ou après le
 * crochet (`- [1× — 09-07] **…**` comme `- **[1× — 09-07] …**`).
 *
 * 🔴 Les deux formes sont écrites dans le sas, et n'accepter que la première
 * rendait le compteur AVEUGLE à une friction sur cinq : 9 puces sur 46 le
 * 09-10e, jamais comptées, donc un seuil systématiquement sous-évalué. Un
 * compteur qui impose une forme que personne ne retient ne compte pas — il
 * échantillonne. Les thèmes déjà
 * gradués portent le préfixe 🗄️ et ne comptent plus : leur contenu vit dans une
 * mémoire, et le renvoi qui reste n'est pas une friction.
 *
 * @param {string} texte - le contenu de `RETEX.md`.
 * @returns {{titre: string, frictions: number, gradue: boolean}[]}
 */
export function themes(texte) {
  const out = [];
  for (const ligne of texte.split("\n")) {
    if (ligne.startsWith("## ")) {
      const titre = ligne.slice(3).trim();
      out.push({ titre, frictions: 0, gradue: titre.startsWith("🗄️") });
    } else if (/^- (?:\*\*)?\[/.test(ligne) && out.length > 0) {
      out[out.length - 1].frictions += 1;
    }
  }
  return out;
}

const tous = process.argv.includes("--all");
let texte;
try {
  texte = readFileSync(SAS, "utf8");
} catch {
  console.log(`(${SAS} introuvable — lancer depuis la racine du dépôt)`);
  process.exit(0);
}

const lot = themes(texte).filter((t) => !t.gradue);
const murs = lot
  .filter((t) => t.frictions >= SEUIL)
  .sort((a, b) => b.frictions - a.frictions);
const total = lot.reduce((n, t) => n + t.frictions, 0);

if (tous) {
  for (const t of [...lot].sort((a, b) => b.frictions - a.frictions)) {
    console.log(`  ${String(t.frictions).padStart(3)}  ${t.titre}`);
  }
  console.log("");
}

console.log(
  `RETEX.md — ${lot.length} thème(s) vivant(s), ${total} friction(s), ` +
    `${texte.split("\n").length} lignes`,
);

if (murs.length === 0) {
  console.log(`✓ aucun thème au-dessus du seuil de ${SEUIL} — rien à graduer`);
  process.exit(0);
}

console.log(
  `\n🎓 ${murs.length} thème(s) MÛR(S) pour une mémoire \`feedback_*\` (seuil ${SEUIL}) :`,
);
for (const t of murs) {
  console.log(`  ${String(t.frictions).padStart(3)}  ${t.titre}`);
}
console.log(
  "\n   Graduer = lire le thème, lui trouver sa MAISON (une mémoire existante d'abord,",
  "\n   une neuve en dernier recours), verser, puis RETIRER du sas en laissant un renvoi.",
);
process.exit(0);
