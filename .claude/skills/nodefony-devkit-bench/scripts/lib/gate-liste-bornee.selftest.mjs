#!/usr/bin/env node
/**
 * Auto-contrôle du juge « la liste ne grossit pas avec la table ».
 *
 * Deux choses à éprouver, et la seconde est celle qu'on oublie :
 *  1. le VERDICT — deux mesures suffisent-elles à séparer une liste bornée
 *     d'une liste qui charge tout, quelle que soit la borne choisie par
 *     l'agent (20, 25, 100 : le juge ne doit en connaître aucune) ;
 *  2. le COMPTAGE — la réponse peut prendre n'importe quelle forme, et compter
 *     des objets supposerait une structure que l'énoncé n'impose pas.
 *
 * Aucune application n'est montée : le contrôle appelle `judge` et
 * `countSeeded`, jamais une copie de leur règle.
 *
 *   node gate-liste-bornee.selftest.mjs
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { judge, countSeeded } from "./gate-liste-bornee.mjs";
import { MARQUE_SEMIS } from "./enonces.mjs";

const V = 150;
const cas = [
  {
    // Bornée à la taille de page du gabarit : la table double, la réponse non.
    nom: "borneeA100",
    attendu: 0,
    m: { premier: 100, second: 100, semePremier: V, semeSecond: V * 2 },
  },
  {
    // Bornée BEAUCOUP plus bas : le juge ne connaît aucune « bonne » valeur,
    // et 20 doit passer exactement comme 100.
    nom: "borneeA20",
    attendu: 0,
    m: { premier: 20, second: 20, semePremier: V, semeSecond: V * 2 },
  },
  {
    // `findAll()` + map : la réponse suit la table.
    nom: "chargeTout",
    attendu: 1,
    m: { premier: V, second: V * 2, semePremier: V, semeSecond: V * 2 },
  },
  {
    // Charge tout, mais avec un filtre : moins que la table, et pourtant la
    // réponse grossit toujours avec elle. C'est le cas que le seuil naïf
    // (« moins que ce qui est semé ⇒ borné ») laisserait passer.
    nom: "chargeToutAvecFiltre",
    attendu: 1,
    m: { premier: 75, second: 150, semePremier: V, semeSecond: V * 2 },
  },
  {
    nom: "listeVide",
    attendu: 2,
    m: { premier: 0, second: 0, semePremier: V, semeSecond: V * 2 },
  },
  {
    // Décroître n'est pas grossir : une liste qui rend moins au second tour
    // (tri différent, cache) reste bornée — l'accuser serait un faux rouge.
    nom: "decroitNEstPasGrossir",
    attendu: 0,
    m: { premier: 100, second: 80, semePremier: V, semeSecond: V * 2 },
  },
];

let defauts = 0;
for (const c of cas) {
  const { code, message } = judge(c.m);
  const ok = code === c.attendu;
  if (!ok) defauts += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${c.nom.padEnd(24)} attendu=${c.attendu} obtenu=${code}  ${message.slice(0, 88)}`,
  );
}

// ── Le comptage, insensible à la FORME de la réponse ────────────────────────
const formes = [
  {
    nom: "page du framework",
    body: JSON.stringify({
      items: [
        { reference: `${MARQUE_SEMIS}1` },
        { reference: `${MARQUE_SEMIS}2` },
      ],
      hasNext: true,
    }),
    attendu: 2,
  },
  {
    nom: "tableau nu",
    body: JSON.stringify([{ reference: `${MARQUE_SEMIS}1` }]),
    attendu: 1,
  },
  {
    nom: "enveloppe maison",
    body: JSON.stringify({
      data: { rows: [{ ref: `${MARQUE_SEMIS}7`, price: 1 }] },
    }),
    attendu: 1,
  },
  { nom: "réponse vide", body: JSON.stringify({ items: [] }), attendu: 0 },
  {
    // Une réponse qui ne contient QUE des lignes d'une autre origine ne doit
    // rien compter : la marque est ce qui rattache un élément au décor.
    nom: "lignes étrangères au décor",
    body: JSON.stringify({ items: [{ reference: "AUTRE-CHOSE-1" }] }),
    attendu: 0,
  },
];
for (const f of formes) {
  const obtenu = countSeeded(f.body);
  if (obtenu !== f.attendu) {
    defauts += 1;
    console.log(
      `  ❌ comptage « ${f.nom} » : attendu=${f.attendu} obtenu=${obtenu}`,
    );
  }
}

console.log(
  defauts === 0
    ? "\n━━ verdict sans seuil vérifié (bornes 20 et 100 traitées pareil), comptage insensible à la forme"
    : `\n━━ ${defauts} DÉFAUT(S)`,
);
process.exit(defauts ? 1 : 0);
