#!/usr/bin/env node
/**
 * Juge de la tâche « habiller la page de connexion sans la réécrire ».
 *
 * Ce qui est mesuré : la page servie par le framework porte-t-elle le nom, le
 * logo et la couleur demandés — ET reste-t-elle celle du framework ? Le juge
 * lit la page RENDUE et les fichiers qu'elle charge, jamais les sources : ce
 * qu'un visiteur voit est la seule chose qui compte.
 *
 * Les gestes interdits (gabarit `.eta` neuf, feuille du framework recopiée)
 * sont jugés par les sondes de code de la tâche — ce juge, lui, dit si le
 * résultat tient debout. Les deux moitiés sont nécessaires : une page réécrite
 * de toutes pièces peut afficher exactement ce qu'on demande, et une
 * configuration juste peut pointer un logo que personne ne sert.
 *
 * | code | cause                 | qui est en tort                                   |
 * | ---: | --------------------- | ------------------------------------------------- |
 * |  `0` | conforme              | —                                                 |
 * |  `1` | marque-absente        | l'AGENT — le nom de l'application n'apparaît pas  |
 * |  `2` | logo-absent           | l'AGENT — la page n'affiche pas le logo fourni    |
 * |  `3` | logo-non-servi        | l'AGENT — le logo est cité mais ne se charge pas  |
 * |  `4` | aucune-reponse        | le DÉCOR — l'application ne répond pas            |
 * |  `5` | port-deja-tenu        | le DÉCOR — serveur étranger                       |
 * |  `6` | page-absente          | l'AGENT — la page a disparu ou a été déplacée     |
 * |  `7` | formulaire-perdu      | l'AGENT — plus de champ mot de passe              |
 * |  `8` | feuille-hors-origine  | l'AGENT — la CSP refusera la feuille              |
 * |  `9` | couleur-absente       | l'AGENT — aucune feuille chargée ne la porte      |
 * | `10` | reponse-inattendue    | l'AGENT — ni la page, ni une absence              |
 *
 * ⚠️ **Le logo doit être SERVI, pas seulement cité.** Le décor le dépose hors
 * de tout dossier statique : une configuration qui le nomme sans le servir
 * affiche une image cassée, et c'est exactement le défaut qu'un essai au
 * navigateur fait voir et qu'une relecture de config ne voit pas.
 *
 * ⚠️ **Une feuille d'une autre origine est refusée par la CSP** du framework
 * (`style-src`) : la page la cite, le navigateur l'ignore, la couleur ne
 * s'applique jamais. Le juge le nomme au lieu de la télécharger et de conclure
 * « couleur présente ».
 *
 * @module
 */
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import {
  COULEUR_CONNEXION,
  LOGO_CONNEXION,
  MARQUE_CONNEXION,
  PAGE_CONNEXION,
} from "./enonces.mjs";

await ensurePortFree();

/** Le nom du fichier de logo : la configuration peut le servir sous n'importe quel chemin. */
const NOM_LOGO = LOGO_CONNEXION.split("/").pop();

/** Valeur d'un attribut dans une balise ouvrante, ou `null`. */
const attribut = (balise, nom) =>
  new RegExp(`\\s${nom}\\s*=\\s*"([^"]*)"`, "iu").exec(balise)?.[1] ?? null;

/** Une adresse servie par l'application elle-même (et donc admise par la CSP). */
const memeOrigine = (href) => href.startsWith("/") && !href.startsWith("//");

const page = await request("GET", PAGE_CONNEXION, new CookieJar());
if (page.error) exit(4, `CAUSE=aucune-reponse — ${page.error}`);
if (page.status === 404) {
  exit(
    6,
    `CAUSE=page-absente — GET ${PAGE_CONNEXION} rend 404 : la page de connexion du ` +
      `framework n'est plus servie à son adresse (désactivée, ou déplacée alors que ` +
      `l'énoncé l'interdisait).`,
  );
}
if (page.status !== 200) {
  exit(
    10,
    `CAUSE=reponse-inattendue — GET ${PAGE_CONNEXION} rend ${page.status}. ` +
      `Corps : ${page.body.slice(0, 160)}`,
  );
}

// ─── 1. La page reste une page de connexion ──────────────────────────────────
if (!/<input\b[^>]*\btype\s*=\s*"password"/iu.test(page.body)) {
  exit(
    7,
    `CAUSE=formulaire-perdu — ${PAGE_CONNEXION} ne porte plus de champ mot de passe : ` +
      `l'habillage a retiré la connexion qu'il devait seulement habiller.`,
  );
}

// ─── 2. La marque ────────────────────────────────────────────────────────────
if (!page.body.includes(MARQUE_CONNEXION)) {
  exit(
    1,
    `CAUSE=marque-absente — « ${MARQUE_CONNEXION} » n'apparaît nulle part dans ` +
      `${PAGE_CONNEXION}.`,
  );
}

// ─── 3. Le logo : cité, PUIS servi ───────────────────────────────────────────
const logos = [...page.body.matchAll(/<img\b[^>]*>/giu)]
  .map(([balise]) => attribut(balise, "src"))
  .filter((src) => src?.includes(NOM_LOGO));
if (logos.length === 0) {
  exit(
    2,
    `CAUSE=logo-absent — aucune image de ${PAGE_CONNEXION} ne pointe ${NOM_LOGO}.`,
  );
}
const [src] = logos;
if (!memeOrigine(src)) {
  exit(
    3,
    `CAUSE=logo-non-servi — le logo est cité par « ${src} », une autre origine : ` +
      `le fichier fourni (${LOGO_CONNEXION}) devait être servi par l'application.`,
  );
}
const logo = await request("GET", src, new CookieJar());
if (logo.error) exit(4, `CAUSE=aucune-reponse-logo — ${logo.error}`);
if (logo.status !== 200 || !/<svg\b/iu.test(logo.body)) {
  exit(
    3,
    `CAUSE=logo-non-servi — la page cite ${src}, qui rend ${logo.status} ` +
      `${logo.status === 200 ? "sans contenu SVG" : ""}: le visiteur voit une image cassée.`,
  );
}

// ─── 4. La couleur, dans une feuille que le navigateur CHARGERA ─────────────
const feuilles = [...page.body.matchAll(/<link\b[^>]*>/giu)]
  .map(([balise]) => balise)
  .filter((balise) => /^stylesheet$/iu.test(attribut(balise, "rel") ?? ""))
  .map((balise) => attribut(balise, "href"))
  .filter((href) => href !== null);
const etrangeres = feuilles.filter((href) => !memeOrigine(href));
let couleurVue = false;
for (const href of feuilles.filter(memeOrigine)) {
  const feuille = await request("GET", href, new CookieJar());
  if (feuille.error) exit(4, `CAUSE=aucune-reponse-feuille — ${feuille.error}`);
  if (
    feuille.status === 200 &&
    feuille.body.toLowerCase().includes(COULEUR_CONNEXION)
  ) {
    couleurVue = true;
    break;
  }
}
if (!couleurVue) {
  if (etrangeres.length > 0) {
    exit(
      8,
      `CAUSE=feuille-hors-origine — la page charge ${etrangeres.join(", ")}, d'une autre ` +
        `origine : la politique de contenu (style-src) la refuse, la couleur ne ` +
        `s'appliquera jamais.`,
    );
  }
  exit(
    9,
    `CAUSE=couleur-absente — aucune des feuilles chargées par ${PAGE_CONNEXION} ` +
      `(${feuilles.join(", ") || "aucune"}) ne porte ${COULEUR_CONNEXION}.`,
  );
}

console.log(
  `ok — ${PAGE_CONNEXION} : « ${MARQUE_CONNEXION} », logo servi (${src}), ` +
    `${COULEUR_CONNEXION} dans une feuille de même origine, formulaire intact`,
);
process.exit(0);
