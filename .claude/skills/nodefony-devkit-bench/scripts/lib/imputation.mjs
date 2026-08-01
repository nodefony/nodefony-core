/**
 * À QUI la faute incombe quand un juge rougit — l'agent, ou le décor.
 *
 * Un juge nomme déjà sa cause (`CAUSE=…`), et c'est ce qui permet de relire un
 * rouge des heures plus tard. Mais le banc, lui, ne lisait ce nom que pour
 * l'afficher : tout rouge comptait FAIL. Or une partie des causes ne dit rien
 * de l'agent — l'application ne répond pas, un port est tenu par un serveur
 * étranger, le décor n'a pas su ouvrir la session d'administration dont le juge
 * a besoin pour attaquer. Compter ces rouges-là, c'est rendre le pire des
 * verdicts : un rouge crédible sur un travail juste.
 *
 * Le code de sortie ne pouvait pas porter cette information : chaque juge
 * numérote ses causes dans son propre ordre, si bien que `8` désigne un défaut
 * de décor chez l'un et une faute d'agent chez l'autre. Il fallait un marqueur
 * qui voyage avec la CAUSE, pas avec le code.
 *
 * ## Pourquoi une table, et non un test sur le nom
 *
 * La tentation est d'écrire `nom.startsWith("aucune-reponse")`. Elle couvre la
 * moitié des cas — et laisse l'autre moitié (`identite-admin-indisponible`,
 * `emission-de-cle-impossible`, `inspection-impossible`) accuser l'agent **en
 * silence**. Chaque cause est donc classée une par une, ici, à un seul endroit
 * où le classement entier se relit d'un coup d'œil.
 *
 * ## Pourquoi l'oubli ne peut pas passer
 *
 * Une table à distance du code qui l'alimente dérive. Deux gardes l'en
 * empêchent, et elles agissent dans les deux sens :
 *
 * - `imputation.selftest.mjs` extrait des juges TOUTES les causes littérales et
 *   exige que chacune figure ici — et qu'aucune entrée d'ici ne soit morte ;
 * - à l'exécution, une cause absente de la table n'est **pas** comptée contre
 *   l'agent : elle rend le run NON JUGEABLE et se fait nommer. Le pire cas est
 *   une abstention bruyante, jamais une accusation muette.
 *
 * @module
 */

/** Les trois imputations possibles. Seule `agent` autorise un FAIL. */
export const AGENT = "agent";
/** Le décor, l'instrument ou l'infrastructure — l'agent n'y est pour rien. */
export const DECOR = "decor";
/**
 * Les deux sont possibles et la cause seule ne tranche pas.
 *
 * Exemple vécu : `inspection-impossible` — l'application peut être non
 * construite (décor) **ou** porter du code que l'agent vient de casser.
 * L'imputer d'office au décor blanchirait un agent qui a cassé le boot ;
 * l'inverse accuserait un travail juste. On s'abstient, et on le dit.
 */
export const INDETERMINE = "indetermine";

/**
 * Classement des causes émises par les juges — cause → imputation.
 *
 * Une entrée se justifie par la CONDITION qui émet la cause, jamais par son nom.
 * Ajouter un juge sans classer ses causes fait rougir `imputation.selftest.mjs`.
 *
 * ## La règle de classement, et sa dissymétrie voulue
 *
 * `DECOR` ne se pose que si **aucun** geste de l'agent, si maladroit soit-il, ne
 * peut produire cette cause. Au moindre chemin par lequel l'agent la
 * produirait, c'est `INDETERMINE`. Les deux retirent au run le droit de
 * conclure — la différence est ce que lit l'opérateur, et c'est là qu'est le
 * coût : « l'agent n'est pas en cause » éteint l'instruction d'un vrai défaut,
 * « à instruire » ne coûte qu'une ligne.
 *
 * ## Un nom, une imputation
 *
 * La table classe le NOM. Si deux sites d'émission d'une même cause devaient
 * relever d'imputations différentes, il faut **renommer** l'un des deux, pas
 * ruser ici. Vécu : une exception du juge lui-même sortait sous
 * `aucune-reponse`, se lisant comme une application muette — d'où
 * `juge-en-erreur`, qui est du décor pur là où l'autre ne peut pas l'être.
 */
export const IMPUTATIONS = Object.freeze({
  // ─── DÉCOR — l'instrument, et lui seul ────────────────────────────────────
  // Un serveur étranger répond avant même le boot du décor : ce que le juge
  // mesurerait n'est pas l'application de la tâche. Qui a laissé ce port ouvert
  // est une autre question, tranchée par la sonde de la tâche 5.
  "port-deja-tenu": DECOR,
  // Le juge a levé une exception. Rien n'a été mesuré, et l'application n'y est
  // pour rien.
  "juge-en-erreur": DECOR,

  // ─── INDÉTERMINÉ — l'agent PEUT l'avoir produite ──────────────────────────
  // Toute la famille « pas de réponse HTTP ». La gate construit et démarre
  // l'application avant de juger (`npm run build` puis `nodefony development
  // --detach --wait`) : un code que l'agent vient de casser rend exactement la
  // même absence de réponse qu'un décor éteint. La gate de compilation, jouée
  // sur la même tâche, tranche le plus souvent.
  "aucune-reponse": INDETERMINE,
  "aucune-reponse-admin": INDETERMINE,
  "aucune-reponse-anonyme": INDETERMINE,
  "aucune-reponse-inconnu": INDETERMINE,
  "aucune-reponse-repere": INDETERMINE,
  "aucune-reponse-script": INDETERMINE,
  "aucune-reponse-second-visiteur": INDETERMINE,
  "aucune-reponse-sur-mutation": INDETERMINE,
  "aucune-reponse-sur-mutation-armee": INDETERMINE,
  "aucune-reponse-sur-plage": INDETERMINE,
  "aucune-reponse-sur-relecture": INDETERMINE,
  "aucune-reponse-temoin": INDETERMINE,
  "aucune-reponse-porteur": INDETERMINE,
  // Le décor sème ces comptes — mais quatre tâches travaillent SUR
  // l'authentification, et un agent qui verrouille le login produit le même
  // échec de connexion.
  "identite-admin-indisponible": INDETERMINE,
  "identite-temoin-indisponible": INDETERMINE,
  // Même raison pour le compte PORTEUR, semé par le gate avec son rôle : un
  // agent qui touche à l'authentification produit le même échec de connexion.
  "identite-porteur-indisponible": INDETERMINE,
  // Le semis passe par la ressource générée : son texte l'impute au décor, à
  // raison le plus souvent, mais un boot cassé donne le même compte.
  "semis-impossible": INDETERMINE,
  // Clés d'API du framework — absentes du décor, ou zone machine démontée par
  // l'agent de la tâche 26.
  "emission-de-cle-impossible": INDETERMINE,
  // La route vient du module de sécurité ; un agent qui démonte la zone de
  // login rend le même 404.
  "route-de-login-absente": INDETERMINE,
  // Application non construite (décor) OU code que l'agent vient de casser.
  // L'imputer d'office au décor blanchirait un agent qui a cassé le boot.
  "inspection-impossible": INDETERMINE,

  // ─── AGENT — le rouge décrit le logiciel produit ──────────────────────────
  // Rien n'a été monté là où l'énoncé le demandait.
  "route-absente": AGENT,
  "ressource-absente": AGENT,
  "page-absente": AGENT,
  "repere-de-zone-absent": AGENT,
  // Le repère de la hiérarchie est posé par le décor et COMMITÉ avant l'agent :
  // s'il a disparu, c'est un geste de l'agent (route renommée, controller
  // régénéré, application non rebâtie). Un `prepare` qui échoue, lui, ne laisse
  // pas jouer la tâche du tout.
  "repere-hierarchie-absent": AGENT,
  "echantillon-non-servi": AGENT,
  "aucun-module-local": AGENT,
  "module-non-charge": AGENT,
  "composant-sans-route": AGENT,
  // Monté, mais ne rend pas le service demandé.
  "page-en-erreur": AGENT,
  "page-sans-script": AGENT,
  "script-externe-introuvable": AGENT,
  "lecture-non-servie": AGENT,
  "creation-refusee": AGENT,
  "liste-vide": AGENT,
  "reponse-non-200": AGENT,
  "corps-inattendu": AGENT,
  "reponse-identique": AGENT,
  "valeur-non-reflete": AGENT,
  "plages-non-honorees": AGENT,
  "charge-tout": AGENT,
  "etat-non-persiste": AGENT,
  "etat-partage": AGENT,
  "jeton-rejoue-refuse": AGENT,
  "mutation-refusee-autrement": AGENT,
  "import-inaccessible": AGENT,
  "partenaire-toujours-refuse": AGENT,
  "cle-refusee": AGENT,
  "temoin-ferme-a-l-admin": AGENT,
  "admin-refuse": AGENT,
  // Une garde a cédé — la famille la plus grave.
  "route-ouverte-a-l-anonyme": AGENT,
  "suppression-ouverte-a-l-anonyme": AGENT,
  "import-ouvert-a-l-anonyme": AGENT,
  "zone-protegee-ouverte": AGENT,
  "temoin-ouvert": AGENT,
  "ouverte-sans-cle": AGENT,
  "role-non-discriminant": AGENT,
  // Une garde du DÉCOR a cédé : le repère porte le même rôle que la route de
  // l'énoncé, l'agent n'avait aucune raison d'y toucher, et il est devenu public.
  "repere-hierarchie-ouvert": AGENT,
  // Le rôle nommé par l'énoncé n'ouvre pas la route qu'il est censé ouvrir.
  "porteur-refuse": AGENT,
  // L'administration couvre la route écrite par l'agent, mais AUCUNE autre au
  // même rôle : la protection est locale (liste de rôles sur l'action) là où
  // l'énoncé demande une hiérarchie déclarée. Aucun décor ne produit cet écart —
  // le repère et son rôle sont posés avant l'agent, et servis à qui les couvre.
  "hierarchie-non-declaree": AGENT,
  "defense-csrf-demontee": AGENT,
  "mutation-sans-jeton": AGENT,
  "politique-absente": AGENT,
  "politique-script-desserree": AGENT,
  "script-inline-non-signe": AGENT,
  "session-semee": AGENT,
  "jamais-freine": AGENT,
  "pas-de-retry-after": AGENT,
  // Refus obtenu, mais pas celui qu'on attendait : la route échoue pour une
  // autre raison que la garde mesurée.
  "reponse-inattendue": AGENT,
  "reponse-inattendue-inconnu": AGENT,
  "reponse-inattendue-repere": AGENT,
  "reponse-inattendue-temoin": AGENT,
});

/**
 * Imputation d'une cause nommée.
 *
 * @param {string|null|undefined} nom - nom de la cause, tel qu'émis.
 * @returns {string|null} l'imputation, ou `null` si la cause est inconnue de la
 *   table — ce qui n'est pas un verdict sur l'agent mais un trou de l'instrument.
 */
export const imputationDe = (nom) =>
  nom && Object.hasOwn(IMPUTATIONS, nom) ? IMPUTATIONS[nom] : null;

/**
 * Extrait la cause d'une sortie de juge — ou d'un rapport qui la cite.
 *
 * Deux passes, dans cet ordre, et l'ordre importe :
 *
 * 1. le CONTRAT de sortie d'un juge — la première ligne commençant par
 *    `CAUSE=` dans stderr puis stdout ;
 * 2. à défaut, la première occurrence n'importe où dans le texte, pour relire
 *    l'`evidence` d'un run déjà joué (`exit 4 — CAUSE=… — …`), où la cause
 *    n'est plus en tête de ligne.
 *
 * La seconde passe seule capterait une cause simplement MENTIONNÉE dans un
 * journal ; la première seule ne saurait pas relire les runs d'avant le
 * marqueur. Une seule fonction pour les deux, sinon les deux lectures
 * divergent.
 *
 * @param {string} texte - sortie d'un juge, ou `evidence` d'un rapport.
 * @returns {{ligne: string, nom: string, imputation: string|null}|null} `null`
 *   si aucune cause n'est nommée — ce qui n'est pas un trou : les gates
 *   génériques (`npm test`, `typecheck`) n'en nomment aucune, et leur rouge
 *   reste opposable.
 */
export const lireCause = (texte) => {
  const brut = texte ?? "";
  const ligne =
    brut
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("CAUSE=")) ??
    brut.match(/CAUSE=[a-z0-9-]+.*/u)?.[0];
  if (!ligne) return null;
  const nom = ligne.slice("CAUSE=".length).trim().split(/[\s—]/u)[0];
  return { ligne, nom, imputation: imputationDe(nom) };
};

/**
 * Un rouge est-il OPPOSABLE à l'agent ?
 *
 * Seule une faute imputée à l'agent établit un FAIL. Le décor, l'indétermination
 * et l'inconnu retirent au run le droit de conclure — ils ne condamnent ni
 * n'absolvent.
 *
 * @param {string|null} imputation - valeur rendue par `imputationDe`.
 * @returns {boolean} `true` seulement pour `AGENT`.
 */
export const estOpposable = (imputation) => imputation === AGENT;

/**
 * Phrase courte expliquant pourquoi un rouge ne compte pas contre l'agent.
 *
 * Affichée dans le rapport : un run écarté sans motif se relit comme un bogue
 * du banc.
 *
 * @param {string|null} imputation
 * @returns {string}
 */
export const motifNonOpposable = (imputation) => {
  switch (imputation) {
    case DECOR:
      return "cause de DÉCOR — l'agent n'est pas en cause, run écarté";
    case INDETERMINE:
      return "cause INDÉTERMINÉE (agent ou décor) — à instruire, run écarté";
    default:
      return "cause NON CLASSÉE dans imputation.mjs — trou d'instrument, run écarté";
  }
};
