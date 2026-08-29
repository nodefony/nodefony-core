/**
 * Juge de la tâche « la liste ne grossit pas avec la table » — et il NOMME sa
 * cause.
 *
 * Premier juge de PERFORMANCE du banc, et sa conception tient à une contrainte :
 * la doctrine maison interdit un verdict à seuil. Un banc qui compare des durées
 * mesure la machine et l'humeur du moment ; on l'a déjà payé (±20 % de variance
 * sur le nombre de tours, sans qu'aucun gabarit ne change).
 *
 * D'où le critère, binaire et sans seuil : on sème, on mesure, **on sème encore
 * et on remesure**. Une liste correctement bornée rend le MÊME nombre d'éléments
 * dans les deux cas ; une liste qui charge la table entière grossit avec elle.
 * Le juge n'a donc besoin d'aucune idée de la « bonne » taille de page : que
 * l'agent borne à 20, 25 ou 100, le verdict est identique. C'est le seul point
 * qu'il faut comprendre pour relire ce fichier.
 *
 * | Sortie | Cause              | Ce que ça dit                                       |
 * | -----: | ------------------ | --------------------------------------------------- |
 * |    `0` | conforme           | la réponse ne grossit pas quand la table grossit     |
 * |    `1` | charge-tout        | elle rend tout : O(n) en base, en mémoire et en fil  |
 * |    `2` | liste-vide         | elle ne rend rien — on ne mesure pas une liste vide  |
 * |    `3` | route-absente      | la route demandée n'est pas montée                   |
 * |    `4` | semis-impossible   | le décor n'a pas pu remplir la table — pas l'agent   |
 * |    `5` | port-deja-tenu     | un serveur ÉTRANGER répondrait à sa place            |
 * |    `6` | aucune-reponse     | l'application ne répond pas — DÉCOR                  |
 *
 * La valeur `5` n'est pas libre : c'est celle que `ensurePortFree` impose à
 * TOUS les juges du banc (`http-probe.mjs`). La recopier autrement ferait lire
 * une garde d'instrument comme un verdict sur l'agent.
 *
 * Les causes `4`, `5` et `6` n'accusent PAS l'agent : sans elles, un décor
 * défaillant rendrait un « charge-tout » parfaitement crédible sur un travail
 * juste — le mode de défaillance n°1 de ce banc.
 *
 * @module
 */
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import { ROUTE_CATALOGUE, ROUTE_SYNTHESE, MARQUE_SEMIS } from "./enonces.mjs";

/**
 * Combien d'éléments semés une réponse contient-elle ?
 *
 * On compte les occurrences de la MARQUE, pas des objets : la forme de la
 * réponse appartient à l'agent (`{items:[…]}`, tableau nu, enveloppe maison),
 * et un juge qui imposerait une structure mesurerait un style. La marque, elle,
 * ne peut venir que des lignes que le décor a semées.
 *
 * @param {string} corps - la réponse brute.
 * @returns {number} le nombre d'éléments semés qu'elle rend.
 */
export function countSeeded(body) {
  return (body.match(new RegExp(MARQUE_SEMIS, "gu")) ?? []).length;
}

/**
 * Le verdict, sur deux mesures déjà prises.
 *
 * Séparé de la collecte pour être éprouvable sans application : l'auto-contrôle
 * appelle CETTE fonction sur des états figés.
 *
 * @param {{premier: number, second: number, semePremier: number, semeSecond: number}} m
 * @returns {{code: number, message: string}}
 */
export function judge({ premier, second, semePremier, semeSecond }) {
  if (premier === 0 && second === 0) {
    return {
      code: 2,
      message:
        "CAUSE=liste-vide — la route répond, mais ne rend aucun des éléments semés. " +
        "On ne peut rien conclure d'une liste vide : ni qu'elle est bornée, ni qu'elle " +
        "charge tout.",
    };
  }
  if (second > premier) {
    return {
      code: 1,
      message:
        `CAUSE=charge-tout — la réponse GROSSIT avec la table : ${premier} éléments ` +
        `pour ${semePremier} en base, ${second} pour ${semeSecond}. La liste charge tout ` +
        "ce qui existe — coût en base, en mémoire et sur le fil proportionnel au catalogue.",
    };
  }
  return {
    code: 0,
    message:
      `conforme — la réponse reste bornée à ${premier} éléments quand la table passe ` +
      `de ${semePremier} à ${semeSecond} lignes`,
  };
}

/**
 * Remplit la table par la ressource que le décor a générée.
 *
 * Par l'API, jamais par un accès direct à la base : le juge doit semer ce que
 * l'application elle-même accepte, sinon il mesure une table dont la forme ne
 * correspond à rien de ce que l'agent a vu.
 *
 * @param {CookieJar} jar - cookies (jeton anti-rejeu compris).
 * @param {number} depuis - numéro de départ des références.
 * @param {number} combien - nombre de lignes à poser.
 * @returns {Promise<{poses: number, error?: string}>}
 */
async function seed(jar, depuis, combien) {
  // Une requête sûre d'abord : elle sème le cookie anti-rejeu si l'application
  // en exige un, sans quoi tous les POST tomberaient et le juge conclurait
  // « semis impossible » sur une application parfaitement saine.
  await request("GET", ROUTE_CATALOGUE, jar);
  let poses = 0;
  for (let i = 0; i < combien; i += 1) {
    const n = depuis + i;
    const r = await request("POST", ROUTE_CATALOGUE, jar, {
      body: { reference: `${MARQUE_SEMIS}${n}`, price: 100 + n },
      csrfToken: jar.csrfToken(),
    });
    if (r.error) return { poses, error: r.error };
    if (r.status === 201 || r.status === 200) poses += 1;
    else if (poses === 0) {
      return {
        poses,
        error: `POST ${ROUTE_CATALOGUE} rend ${r.status} — ${(r.body ?? "").slice(0, 160)}`,
      };
    }
  }
  return { poses };
}

/** Le nombre de lignes semées à chaque vague. */
const VAGUE = 150;

async function main() {
  await ensurePortFree();
  const jar = new CookieJar();

  const v1 = await seed(jar, 1, VAGUE);
  if (v1.error || v1.poses < VAGUE) {
    exit(
      4,
      `CAUSE=semis-impossible — ${v1.poses}/${VAGUE} lignes posées par ${ROUTE_CATALOGUE}` +
        (v1.error ? ` : ${v1.error}` : "") +
        ". Le DÉCOR n'a pas pu remplir la table — ce n'est pas la liste de l'agent qu'on mesure.",
    );
  }

  const r1 = await request("GET", ROUTE_SYNTHESE, jar);
  if (r1.error) {
    exit(6, `CAUSE=aucune-reponse — GET ${ROUTE_SYNTHESE} : ${r1.error}.`);
  }
  if (r1.status === 404) {
    exit(
      3,
      `CAUSE=route-absente — GET ${ROUTE_SYNTHESE} rend 404 : la route demandée n'est pas montée.`,
    );
  }
  const premier = countSeeded(r1.body ?? "");

  const v2 = await seed(jar, VAGUE + 1, VAGUE);
  if (v2.error || v2.poses < VAGUE) {
    exit(
      4,
      `CAUSE=semis-impossible — seconde vague ${v2.poses}/${VAGUE}` +
        (v2.error ? ` : ${v2.error}` : "") +
        ". DÉCOR.",
    );
  }

  const r2 = await request("GET", ROUTE_SYNTHESE, jar);
  if (r2.error) {
    exit(
      6,
      `CAUSE=aucune-reponse — seconde mesure de ${ROUTE_SYNTHESE} : ${r2.error}.`,
    );
  }
  const second = countSeeded(r2.body ?? "");

  const { code, message } = judge({
    premier,
    second,
    semePremier: VAGUE,
    semeSecond: VAGUE * 2,
  });
  console.log(message);
  process.exit(code);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main();
}
