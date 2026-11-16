/**
 * D'OÙ vient ce que le décor installe — et QUELLE version.
 *
 * Ce sont deux réglages distincts, et les confondre fait mesurer autre chose
 * que ce qu'on croit :
 *
 * - **la SOURCE** décide de ce qu'on éprouve — le code du dépôt, ou ce qu'un
 *   utilisateur reçoit du registre. C'est la variable qui change la NATURE de
 *   la mesure.
 * - **le CANAL** décide de quelle version publiée il s'agit. Il n'a de sens que
 *   pour la source `registre` ; sur `depot`, on éprouve le checkout et aucune
 *   étiquette npm ne veut rien dire.
 *
 * 🔴 **Les deux entrent dans l'empreinte du décor**, au même titre que le modèle
 * et l'agent. Sans cela, un run joué sur la préversion publiée serait comparé à
 * une référence mesurée sur le dépôt comme s'ils avaient joué le même décor —
 * et l'écart serait lu comme une régression du code. C'est exactement ce que la
 * règle 3 du dépistage existe pour refuser, mais elle ne peut refuser que ce
 * qu'on lui donne à voir.
 *
 * Pourquoi ce module plutôt que des constantes dans le banc : la règle vaut pour
 * les TROIS bancs et pour toutes les tâches, et une règle recopiée diverge en
 * silence — chacune passant ses propres tests.
 *
 * @module
 */

import semver from "semver";
import { canauxEnArriere } from "../../../../../scripts/release/release-core.mjs";

/**
 * Ce que le décor installe.
 *
 * `depot` — le CLI du checkout génère, et les paquets viennent des tarballs
 * fabriqués localement. C'est le défaut, et c'est ce qui fait du banc un
 * instrument de NON-RÉGRESSION : on éprouve le code qu'on vient d'écrire.
 *
 * `registre` — l'application est générée par le CLI PUBLIÉ et installée depuis
 * npm. On n'éprouve plus le dépôt mais ce qu'un utilisateur reçoit vraiment,
 * dépendances transitives et surface publiée comprises. C'est le seul régime qui
 * voie un défaut d'EMPAQUETAGE — un fichier oublié dans `files`, un type non
 * publié, une dépendance déclarée en `devDependencies`.
 */
export const SOURCES = ["depot", "registre"];

/**
 * Les étiquettes de distribution npm que le banc sait viser.
 *
 * Une campagne doit pouvoir se rejouer sur chaque version que quelqu'un peut
 * réellement installer.
 */
export const ETIQUETTES = ["alpha", "beta", "latest", "local"];

/**
 * Une version EXACTE au sens SemVer — `10.0.0`, `10.0.0-alpha.5`, `10.1.0-beta.2`.
 *
 * Acceptée partout où une étiquette l'est : c'est ce qui rend une campagne
 * rejouable à l'identique. On ne valide pas toute la grammaire SemVer, seulement
 * de quoi écarter une faute de frappe — le registre tranchera le reste.
 */
export const VERSION_EXACTE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * La source effective de ce run.
 *
 * @param {Record<string, string|undefined>} env - l'environnement.
 * @returns {string} `depot` par défaut.
 * @throws {Error} sur une valeur inconnue — replier silencieusement sur `depot`
 *   ferait croire qu'on mesure le registre alors qu'on mesure le checkout, et
 *   rien dans le rapport ne le dirait.
 */
export function sourceDe(env = process.env) {
  const brut = env.NF_DEVKIT_BENCH_SOURCE || "depot";
  if (!SOURCES.includes(brut)) {
    throw new Error(
      `NF_DEVKIT_BENCH_SOURCE="${brut}" inconnu — attendus : ${SOURCES.join(", ")}`,
    );
  }
  return brut;
}

/**
 * Le canal effectif — étiquette npm ou version exacte.
 *
 * Le défaut suit la phase du projet : `beta` tant que la 10.0.0 n'est pas
 * publiée. Le jour de la bascule, c'est un défaut qui change, pas une tâche à
 * réécrire — réécrire un énoncé ferait refuser la comparaison avec toute la
 * référence (`empreinteTache` couvre le `prompt`). Un défaut PÉRIMÉ — une
 * étiquette restée derrière une plus mûre — se constate au lancement
 * ({@link canalEnRetard}), il ne se découvre pas dans le run de l'agent.
 *
 * @param {Record<string, string|undefined>} env - l'environnement.
 * @returns {string} l'étiquette ou la version, `beta` par défaut.
 * @throws {Error} si la valeur n'est ni une étiquette connue ni une version —
 *   `aplha` ferait échouer `npm create` (aucune version ne correspond) au
 *   milieu du run, et l'échec serait imputé à l'agent.
 */
export function canalDe(env = process.env) {
  const brut = env.NF_DEVKIT_BENCH_CANAL || "beta";
  if (!ETIQUETTES.includes(brut) && !VERSION_EXACTE.test(brut)) {
    throw new Error(
      `NF_DEVKIT_BENCH_CANAL="${brut}" inconnu — attendus : ` +
        `${ETIQUETTES.join(", ")}, ou une version exacte (ex. 10.0.0-alpha.5)`,
    );
  }
  return brut;
}

/**
 * Le canal demandé sert-il une version PÉRIMÉE ?
 *
 * 🔴 Vécu (#785) : le défaut `alpha` installait `10.0.0-alpha.9` pendant que
 * `beta` servait `10.0.0-beta.8` — l'agent travaillait sur une version plus
 * vieille que celle qu'un utilisateur reçoit, et le run jugeait l'instrument.
 * La règle « un canal moins mûr ne reste pas derrière un plus mûr » n'est pas
 * recopiée : c'est celle de la chaîne de publication (`canauxEnArriere`).
 *
 * Une version EXACTE n'est jamais jugée : la demander est un choix, pas un
 * oubli. `local` non plus, il ne vise pas le registre public.
 *
 * @param {Record<string, string>|null} distTags - les étiquettes du générateur
 *   publié (`npm view create-nodefony dist-tags`) ; `null` = non lues.
 * @param {string} canal - le canal demandé (voir {@link canalDe}).
 * @returns {string|null} le motif du refus, ou `null` si le canal est sain.
 */
export function canalEnRetard(distTags, canal) {
  if (distTags === null || !ETIQUETTES.includes(canal) || canal === "local")
    return null;
  if (!distTags[canal]) {
    return (
      `l'étiquette « ${canal} » n'existe pas sur le registre — ` +
      `étiquettes servies : ${Object.keys(distTags).join(", ")}`
    );
  }
  const retard = canauxEnArriere(
    [{ nom: "create-nodefony", distTags }],
    (a, b) => semver.gt(a, b),
  ).find((r) => r.tag === canal);
  return retard
    ? `« ${canal} » sert ${retard.de}, plus ancienne que « ${retard.devant} » ` +
        `(${retard.vers})`
    : null;
}

/**
 * Le canal vise-t-il un REGISTRE LOCAL plutôt que le registre public ?
 *
 * ⚠️ Le régime `local` exige un registre interposé, qui n'est pas encore monté.
 * L'appelant doit REFUSER de jouer plutôt que de replier sur le registre public :
 * un repli silencieux mesurerait la version publiée en croyant mesurer le dépôt,
 * et c'est le faux verdict le plus coûteux du lot puisqu'il ne se voit nulle part.
 *
 * @param {string} canal - le canal (voir {@link canalDe}).
 * @returns {boolean}
 */
export function registreLocalRequis(canal) {
  return canal === "local";
}

/**
 * Le spécificateur npm à installer — `nodefony@<canal>`.
 *
 * @param {string} paquet - le nom du paquet.
 * @param {string} canal - l'étiquette ou la version.
 * @returns {string}
 */
export function specifieur(paquet, canal) {
  // `local` n'est pas une étiquette npm : c'est un RÉGIME servi par un registre
  // interposé, qui publie sous l'étiquette `alpha`. Le spécificateur est donc le
  // même — c'est le registre qui change, pas ce qu'on demande.
  return `${paquet}@${canal === "local" ? "alpha" : canal}`;
}

/**
 * Le libellé du décor, tel qu'il entre dans la référence et s'y compare.
 *
 * 🔴 **La source n'apparaît QUE lorsqu'elle n'est pas le défaut.** Les références
 * déjà enregistrées ont été mesurées en `depot` et ne portent pas ce mot : les
 * faire toutes diverger d'un coup ferait refuser la comparaison sur l'intégralité
 * du catalogue, et l'on perdrait des mesures payées pour un changement qui ne
 * touche PAS ce qu'elles ont mesuré. L'absence du mot vaut donc `depot`, et c'est
 * la seule façon d'ajouter une variable sans invalider le passé.
 *
 * @param {{source: string, canal: string, lie: boolean, mcp: string}} regime
 *   - la source, le canal, le mode `--link`, et la mention MCP déjà composée.
 * @returns {string} le libellé, stable pour une même configuration.
 */
export function libelleDecor({ source, canal, lie, mcp }) {
  const base = lie
    ? "lié au checkout (--link)"
    : source === "registre"
      ? `registre npm (${canal})`
      : "isolé (tarballs, hors dépôt)";
  return `${base}${mcp}`;
}
