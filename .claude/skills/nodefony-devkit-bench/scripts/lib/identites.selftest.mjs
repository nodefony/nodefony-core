/**
 * Auto-contrôle des identités du banc — et de leur ACCORD avec le produit.
 *
 * 🔴 Ce que ce contrôle existe pour attraper, parce que c'est arrivé : le
 * mot de passe du compte d'administration vit des DEUX côtés de la frontière
 * npm. Le produit l'écrit dans le gabarit d'application ; le banc, qui mesure
 * une application installée depuis des tarballs, ne peut rien importer du
 * dépôt et doit donc en garder une copie. La copie a dérivé sans un mot : le
 * produit est passé à `nodefony-dev-42` (politique de mots de passe, #360) et
 * le banc est resté sur `admin`, un secret que cette même politique REFUSE
 * désormais — il ne pouvait donc plus exister nulle part.
 *
 * Rien ne l'aurait dit : `envDecor` écarte toute variable `NF_*` du poste, donc
 * aucune surcharge ne venait masquer l'écart ; et le symptôme se serait présenté
 * comme un décor défaillant (`identite-admin-indisponible`) sur les HUIT juges
 * qui ouvrent une session d'administration, c'est-à-dire un run entier payé
 * pour rien.
 *
 * Le contrôle relit donc le gabarit DANS LE DÉPÔT et le confronte à la
 * constante du banc. Il ne peut tourner que depuis un checkout — hors checkout
 * il s'abstient en le DISANT, plutôt que de rendre un vert qui n'a rien
 * comparé.
 *
 * Usage : `node lib/identites.selftest.mjs`
 * Sorties : `0` accord (ou abstention annoncée) · `1` un écart.
 *
 * @module
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN, MOT_DE_PASSE_ADMIN_DEV } from "./identites.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Le gabarit qui sème le compte d'administration, dans le dépôt.
 *
 * Remonté depuis ce fichier : `.claude/skills/nodefony-devkit-bench/scripts/lib`
 * → six niveaux jusqu'à la racine du dépôt.
 */
const GABARIT = path.join(
  ICI,
  "..",
  "..",
  "..",
  "..",
  "..",
  "src",
  "nodefony",
  "templates",
  "app",
  "complete",
  "nodefony",
  "security",
  "provisionUsers.ts.tpl",
);

let echecs = 0;

/**
 * Rend un verdict lisible et compte les écarts.
 *
 * @param {boolean} ok - le contrôle passe-t-il ?
 * @param {string} quoi - ce qui était contrôlé.
 * @param {string} detail - la preuve, dans les deux cas.
 * @returns {void}
 */
function dire(ok, quoi, detail) {
  if (!ok) echecs += 1;
  console.log(`${ok ? "✓" : "✗"} ${quoi}${detail ? ` — ${detail}` : ""}`);
}

if (!fs.existsSync(GABARIT)) {
  // Hors checkout : le DIRE. Un vert prononcé ici affirmerait un accord que
  // rien n'a vérifié — précisément le faux vert que ce fichier combat.
  console.log(
    `⊘ gabarit introuvable (${GABARIT}) — contrôle NON joué, hors checkout du dépôt`,
  );
  process.exit(0);
}

const source = fs.readFileSync(GABARIT, "utf8");
const trouve = /DEV_ADMIN_PASSWORD\s*=\s*"([^"]+)"/u.exec(source);

dire(
  trouve !== null,
  "le gabarit déclare bien DEV_ADMIN_PASSWORD",
  trouve ? `= « ${trouve[1]} »` : "constante introuvable — le gabarit a changé de forme",
);

if (trouve) {
  dire(
    trouve[1] === MOT_DE_PASSE_ADMIN_DEV,
    "le banc et le produit s'accordent sur le mot de passe d'administration",
    trouve[1] === MOT_DE_PASSE_ADMIN_DEV
      ? `« ${MOT_DE_PASSE_ADMIN_DEV} » des deux côtés`
      : `produit « ${trouve[1]} » ≠ banc « ${MOT_DE_PASSE_ADMIN_DEV} » — les juges ne pourront pas ouvrir de session`,
  );
}

// Sans surcharge, l'identité DOIT retomber sur la valeur du produit. Le
// contrôle porte sur ce que les juges emploieront vraiment, pas seulement sur
// la constante : c'est `ADMIN.password` qui part dans la requête.
dire(
  process.env.NF_ADMIN_PASSWORD
    ? ADMIN.password === process.env.NF_ADMIN_PASSWORD
    : ADMIN.password === MOT_DE_PASSE_ADMIN_DEV,
  "ADMIN.password suit la surcharge, sinon le défaut du produit",
  process.env.NF_ADMIN_PASSWORD
    ? "NF_ADMIN_PASSWORD posée dans cet environnement — c'est elle qui gagne"
    : `retombe sur « ${MOT_DE_PASSE_ADMIN_DEV} »`,
);

dire(
  ADMIN.username === "admin",
  "l'identifiant du compte semé reste « admin »",
  ADMIN.username,
);

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le banc ouvrirait une session avec un secret que le produit n'a pas semé`
    : "\n━━ identités accordées avec le gabarit du produit",
);
process.exit(echecs ? 1 : 0);
