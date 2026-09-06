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
  "aucune-reponse-publique": INDETERMINE,
  // Aucun des deux chemins de handshake WS possibles n'accepte de connexion,
  // alors que l'HTTP répond (identités déjà établies) : le canal réel a pu
  // casser tout le sous-système realtime (agent), ou celui-ci est simplement
  // hors service (décor) — les deux se ressemblent depuis l'extérieur.
  "aucune-reponse-ws": INDETERMINE,
  // Le décor sème ces comptes — mais quatre tâches travaillent SUR
  // l'authentification, et un agent qui verrouille le login produit le même
  // échec de connexion.
  "identite-admin-indisponible": INDETERMINE,
  "identite-temoin-indisponible": INDETERMINE,
  // Même famille, sans suffixe : les juges qui n'ont qu'UNE identité à établir
  // nomment leur cause ainsi. Le décor sème le compte, mais un agent qui touche
  // à l'authentification produit exactement le même échec de connexion.
  "identite-indisponible": INDETERMINE,
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
  // Le juge a reçu 403 sans avoir pu se munir du jeton anti-rejeu. Deux
  // situations le produisent et RIEN dans la réponse ne les distingue : une
  // écriture correctement protégée dont aucune route sûre ne sème le cookie, et
  // une garde d'autorisation qui refuse tout le monde. Le produit s'y refuse
  // délibérément — `CsrfError` reste générique pour ne pas fuiter sa politique.
  //
  // Ce n'est donc PAS du décor : un geste de l'agent peut la produire, et la
  // classer « décor » éteindrait l'instruction d'une vraie faille. À instruire
  // ne coûte qu'une ligne ; innocenter à tort coûte la mesure entière.
  "jeton-csrf-absent": INDETERMINE,
  // Le témoin n'a pas été trouvé ET la ressource n'a pas pu être parcourue en
  // entier. Tentant de la classer DÉCOR — le juge s'abstient, après tout — mais
  // ce serait innocenter à tort : le parcours échoue aussi quand l'application
  // rend une forme que le contrat de page ne prévoit pas (un objet sans
  // `items`), et c'est alors un geste de l'agent. À instruire, jamais à
  // blanchir d'office.
  "recherche-non-concluante": INDETERMINE,
  "inspection-impossible": INDETERMINE,
  // Le compte de routes a été obtenu sur un kernel booté à FROID, faute de
  // porte ouverte : ce n'est pas l'application que l'agent a interrogée. Son
  // rapport peut être juste sur la sienne — l'écart ne prouve rien contre lui.
  "compte-sur-autre-application": INDETERMINE,

  // ─── AGENT — le rouge décrit le logiciel produit ──────────────────────────
  // Rien n'a été monté là où l'énoncé le demandait.
  "route-absente": AGENT,
  "ressource-absente": AGENT,
  "page-absente": AGENT,
  "repere-de-zone-absent": AGENT,
  // Le repère du préfixe est posé par le générateur AVANT l'agent et commité à
  // part : sa disparition est un geste de l'agent (ressource supprimée,
  // renommée, application non rebâtie).
  "repere-de-prefixe-absent": AGENT,
  // Le repère de la hiérarchie est posé par le décor et COMMITÉ avant l'agent :
  // s'il a disparu, c'est un geste de l'agent (route renommée, controller
  // régénéré, application non rebâtie). Un `prepare` qui échoue, lui, ne laisse
  // pas jouer la tâche du tout.
  "repere-hierarchie-absent": AGENT,
  // Ni l'un ni l'autre des deux chemins de handshake possibles n'annonce le
  // canal demandé, alors que la connexion WS fonctionne (au moins un chemin
  // répond) : le canal n'a simplement jamais été déclaré, ou sous un autre
  // nom — l'équivalent WS de `route-absente`.
  "canal-absent": AGENT,
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
  // Un canal realtime SANS politique est PUBLIC par défaut (comportement
  // documenté du framework) : rien ne l'a fermé.
  "canal-ouvert-a-l-anonyme": AGENT,
  // Le canal exige une identité mais pas un RÔLE — même famille que
  // `role-non-discriminant`, transposée au protocole WS.
  "canal-non-discriminant": AGENT,
  // Rien ne protège les routes de l'énoncé.
  "prefixe-ouvert-a-l-anonyme": AGENT,
  // Des décorateurs recopiés au lieu d'une zone : le repère du même préfixe,
  // que l'agent n'a aucune raison de toucher, est resté ouvert.
  "repere-de-prefixe-ouvert": AGENT,
  // La garde refuse aussi son destinataire légitime — service non rendu.
  "prefixe-inaccessible": AGENT,
  // La protection a débordé du préfixe demandé sur le reste de l'application.
  "prefixe-elargi-hors-cible": AGENT,
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
  "mutation-sans-token": AGENT,
  "politique-absente": AGENT,
  "politique-script-desserree": AGENT,
  "script-inline-non-signe": AGENT,
  "session-semee": AGENT,
  // Le témoin gratuit `live:ticker` (public par défaut, posé par le décor)
  // n'est plus lisible par un anonyme — une politique bien plus large que le
  // seul canal de l'énoncé a débordé sur lui. Même famille « ne pas
  // affaiblir » que `politique-script-desserree` / `defense-csrf-demontee`.
  "canal-temoin-ferme": AGENT,
  "jamais-freine": AGENT,
  "pas-de-retry-after": AGENT,
  // Refus obtenu, mais pas celui qu'on attendait : la route échoue pour une
  // autre raison que la garde mesurée.
  "reponse-inattendue": AGENT,
  "reponse-inattendue-inconnu": AGENT,
  "reponse-inattendue-repere": AGENT,
  "reponse-inattendue-temoin": AGENT,

  // ─── Le schéma a suivi, ou il n'a pas suivi (tâches 33 et 34) ────────────
  // Ces juges n'atteignent leur verdict qu'APRÈS une réponse de l'application :
  // l'absence de réponse porte sa propre cause (`aucune-reponse`), et le port
  // tenu par un tiers la sienne. Ce qui reste décrit donc le logiciel produit.
  //
  // La ligne, puis le compte, semés AVANT le travail et commités : leur
  // disparition n'est pas un aléa du décor, c'est une base refaite plutôt que
  // migrée — le geste que ces deux tâches existent pour attraper.
  "donnee-perdue": AGENT,
  "compte-perdu": AGENT,
  // Le rapport demandé n'a pas été écrit, ou n'annonce pas le compte mesuré sur
  // l'application même : c'est le travail demandé qui manque.
  "rapport-absent": AGENT,
  "compte-non-annonce": AGENT,
  // Un compte de plus à CHAQUE connexion du fournisseur externe : la recherche
  // du compte existant ne le retrouve plus.
  "compte-externe-double": AGENT,
  // La base a suivi et le contrat d'entrée non : la colonne existe, mais plus
  // rien ne peut naître (obligatoire sans défaut SQL) ou l'écriture est refusée.
  "creation-impossible": AGENT,
  "ressource-cassee": AGENT,
  // La ressource ne publie pas la colonne neuve : la base ne l'a pas reçue.
  "colonne-absente": AGENT,
  // Le champ vit en développement sans être écrit dans une migration : il
  // n'atteindra jamais la production.
  "colonne-non-deployable": AGENT,
  // Migrer une base VIERGE échoue : le premier déploiement tomberait, quel que
  // soit l'état de la base de développement.
  "migration-injouable": AGENT,
  // L'état déclaré par le produit lui-même ne dit pas « à jour ».
  "etat-non-a-jour": AGENT,
  // Rejouer applique encore : le contrat est qu'un second passage ne fasse rien.
  "non-idempotent": AGENT,

  // ─── Recevoir un fichier (tâche 35) ──────────────────────────────────────
  // Une garde a cédé, et c'est la plus grave de cette famille : le nom envoyé
  // par le client a décidé de la destination du fichier.
  "traversee-de-chemin": AGENT,
  // L'application répond, mais un envoi multipart légitime est refusé.
  "depot-refuse": AGENT,
  // Elle répond 2xx et n'a rien rangé : recevoir un fichier n'est pas le
  // conserver.
  "fichier-introuvable": AGENT,
  // Rangé, mais la réponse ne dit ni sous quel nom ni quelle taille : l'appelant
  // ne peut pas retrouver son fichier.
  "reponse-muette": AGENT,
  // Le juge n'a pas pu se munir du jeton anti-rejeu : un 403 ne dit alors rien
  // du logiciel produit, il dit que l'instrument est parti sans son jeton.
  // Accuser ici reviendrait à reprocher à l'agent d'avoir protégé sa route —
  // c'est exactement ce qui est arrivé, pendant que le banc validait la seule
  // route qui ne résistait pas : celle qui n'était pas protégée.
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

/**
 * Signatures d'un juge qui s'est CASSÉ, par opposition à un juge qui a JUGÉ.
 *
 * Le filet du socle (`http-probe.mjs`) rattrape les exceptions d'un juge qui a
 * démarré. Il ne peut rien pour celui qui meurt AVANT : une `SyntaxError`, un
 * `Cannot find module`, un import circulaire. Node sort alors en `1`, sans une
 * ligne `CAUSE=` — et un `1` sans cause est, par contrat, opposable à l'agent.
 *
 * On ne classe donc PAS sur l'absence de cause, mais sur une PREUVE positive de
 * plantage. La distinction n'est pas de la finesse : écarter un rouge sur simple
 * absence de cause innocenterait l'agent à tort dès qu'un juge se tait, et un
 * banc qui innocente à tort ne mesure plus rien. Les deux erreurs coûtent, en
 * sens inverse.
 */
const SIGNATURES_DE_PLANTAGE = [
  /^\s*(?:Uncaught\s+)?(?:Reference|Syntax|Type|Range)Error\b/mu,
  /\bCannot find (?:module|package)\b/u,
  /\bERR_MODULE_NOT_FOUND\b/u,
  /\bERR_REQUIRE_ESM\b/u,
  /^\s*at\s+\S+\s+\(?node:internal\//mu,
  /\bnode:internal\/modules\//u,
];

/**
 * Ce rouge vient-il d'un juge CASSÉ plutôt que d'un agent fautif ?
 *
 * @param {string} texte - la sortie complète du gate (stderr puis stdout).
 * @returns {boolean} vrai si la sortie porte une signature de plantage Node.
 */
export const estUnPlantageDeJuge = (texte) =>
  SIGNATURES_DE_PLANTAGE.some((re) => re.test(texte ?? ""));

/**
 * La cause synthétique d'un juge qui n'a pas pu rendre de verdict.
 *
 * Rendue au FORMAT que {@link lireCause} relit, pour qu'un rapport figé se
 * relise plus tard sans connaître ce chemin — le banc ne doit pas avoir deux
 * façons de porter une cause.
 *
 * @param {string} texte - la sortie du gate, dont la première ligne utile sert
 *   de détail.
 * @returns {{ligne: string, nom: string, imputation: string}}
 */
export const causeDuJugeCasse = (texte) => {
  const detail =
    (texte ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => SIGNATURES_DE_PLANTAGE.some((re) => re.test(l))) ??
    "plantage sans message lisible";
  return {
    ligne:
      `CAUSE=juge-en-erreur — le juge s'est cassé AVANT de rendre un verdict : ` +
      `${detail.slice(0, 160)}`,
    nom: "juge-en-erreur",
    imputation: IMPUTATIONS["juge-en-erreur"],
  };
};

/**
 * Ce gate lance-t-il un juge DÉDIÉ du banc ?
 *
 * Les gates sont de deux natures : des commandes écrites en ligne (`npm test`,
 * `tsgo`) et des juges en fichier (`lib/gate-*.mjs`). Seuls les seconds sont à
 * nous, et d'eux seuls on peut dire qu'un plantage est un défaut d'INSTRUMENT.
 * Un `npm test` qui lève une `TypeError` parle du code de l'agent, pas du nôtre
 * — l'y confondre innocenterait exactement ce qu'on cherche à mesurer.
 *
 * Le chemin est normalisé AVANT d'être filtré : il est construit par
 * `path.join`, donc en `\` sous Windows, où un motif écrit en `/` ne mordrait
 * pas — et une garde qui ne mord pas ne dit jamais qu'elle n'a pas mordu.
 *
 * @param {string[]} cmd - la commande du gate, telle que le banc la lance.
 * @returns {boolean}
 */
export const viseUnJuge = (cmd) =>
  /\/lib\/gate-[a-z0-9-]+\.mjs\b/u.test(
    (cmd ?? []).join(" ").replace(/\\/gu, "/"),
  );
