/**
 * Grammaire de la ligne de commande des sondes — fonctions PURES, sans
 * navigateur, sans réseau, sans état.
 *
 * Extraites des scripts pour être éprouvées par des tests qui tournent
 * partout : une allowlist de familles qui laisse passer un nom inconnu, ou un
 * découpage de sélecteurs qui avale une entrée malformée, produit une mesure
 * FAUSSE en silence — exactement la classe de bug qu'une sonde ne peut pas se
 * permettre.
 */

/**
 * Les familles de sondes activables — l'allowlist, et sa documentation.
 *
 * Un nom absent d'ici est REFUSÉ (code 64), jamais ignoré : une famille
 * fautée en silence ferait croire qu'on a mesuré ce qu'on n'a pas mesuré.
 */
export const FAMILLES = Object.freeze({
  a11y: "accessibilité — étiquettes, noms accessibles, titres, cibles, arbre ARIA",
  rendu:
    "rendu — débordement horizontal, éléments hors viewport, polices réellement chargées",
  reseau: "réseau — requêtes, échecs, ressources lourdes, temps de réponse",
  perf: "temps de rendu — TTFB, FCP, LCP, CLS, tâches longues",
  stockage: "cookies (attributs, jamais les valeurs) et Web Storage",
  responsive: "débordement horizontal à plusieurs largeurs d'écran",
});

/**
 * Analyse la liste de familles demandée (`NF_BROWSER_FAMILIES`).
 *
 * `Object.hasOwn` et non `in` : `"toString" in FAMILLES` est vrai par la chaîne
 * de prototypes, et une « famille » toString serait acceptée sans exister.
 *
 * @param {string|undefined} brut - valeur brute (`"a11y,perf"`, `"toutes"`, vide).
 * @param {string[]} [defaut] - familles retenues quand rien n'est demandé.
 * @returns {{ retenues: string[], inconnues: string[] }} les familles valides,
 *   et celles qui n'existent pas — à refuser, jamais à ignorer.
 */
export function parseFamilies(brut, defaut = []) {
  const demande = String(brut ?? "").trim();
  if (!demande) return { retenues: [...defaut], inconnues: [] };
  if (demande === "toutes") {
    return { retenues: Object.keys(FAMILLES), inconnues: [] };
  }
  const retenues = [];
  const inconnues = [];
  for (const nom of demande
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)) {
    if (Object.hasOwn(FAMILLES, nom)) {
      if (!retenues.includes(nom)) retenues.push(nom);
    } else {
      inconnues.push(nom);
    }
  }
  return { retenues, inconnues };
}

/**
 * Analyse les sondes de style (`NF_BROWSER_PROBES`, forme `libellé=sélecteur`).
 *
 * Les entrées malformées sont RENDUES, pas avalées : une sonde qu'on croit
 * poser et qui n'existe pas est une mesure qui manque sans bruit.
 *
 * @param {string|undefined} brut - entrées séparées par des virgules.
 * @returns {{ sondes: { label: string, sel: string }[], rejetees: string[] }}
 */
export function parseProbes(brut) {
  const sondes = [];
  const rejetees = [];
  for (const morceau of String(brut ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const i = morceau.indexOf("=");
    const label = i > 0 ? morceau.slice(0, i).trim() : "";
    const sel = i > 0 ? morceau.slice(i + 1).trim() : "";
    if (label && sel) sondes.push({ label, sel });
    else rejetees.push(morceau);
  }
  return { sondes, rejetees };
}

/**
 * Analyse les largeurs d'écran de la famille `responsive` (`NF_BROWSER_WIDTHS`).
 *
 * Bornes 240–4000 : en deçà aucun navigateur réel, au-delà on ne mesure plus un
 * écran mais un mur d'affichage — et un zéro ou un négatif ferait échouer le
 * redimensionnement avec un message qui n'incrimine pas la vraie cause.
 *
 * @param {string|undefined} brut - largeurs en pixels, séparées par des virgules.
 * @returns {{ largeurs: number[], invalides: string[] }}
 */
export function parseWidths(brut) {
  const largeurs = [];
  const invalides = [];
  for (const morceau of String(brut ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const n = Number(morceau);
    if (Number.isInteger(n) && n >= 240 && n <= 4000) {
      if (!largeurs.includes(n)) largeurs.push(n);
    } else {
      invalides.push(morceau);
    }
  }
  return { largeurs, invalides };
}

/**
 * Agrège les verdicts des familles mesurées en un verdict de page.
 *
 * « OK » seulement si TOUT est OK : un verdict global qui moyenne cache
 * précisément l'alerte qu'on cherchait.
 *
 * @param {string[]} verdicts - les verdicts des familles actives.
 * @returns {"OK"|"ALERTE"} l'état le plus défavorable rencontré.
 */
export function verdictGlobal(verdicts) {
  return verdicts.every((v) => v === "OK") ? "OK" : "ALERTE";
}

/**
 * Médiane d'une série de mesures — la statistique d'un RTT, jamais la moyenne.
 *
 * Une moyenne est déplacée par un seul aller-retour aberrant (GC, réveil de
 * connexion) ; la médiane dit ce qu'un appel TYPIQUE coûte.
 *
 * @param {number[]} valeurs - mesures en millisecondes.
 * @returns {number|null} la médiane, ou null si la série est vide.
 */
export function mediane(valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length === 0) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
}
