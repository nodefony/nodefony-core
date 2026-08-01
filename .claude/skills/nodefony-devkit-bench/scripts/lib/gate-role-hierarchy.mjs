/**
 * Juge de la tâche « un rôle en implique un autre » (`security.roleHierarchy`).
 *
 * Une hiérarchie de rôles est un mécanisme GLOBAL : déclarer une fois qu'un rôle
 * d'administration couvre le rôle de facturation profite à toute route future
 * gardée par ce dernier. Le geste qui la contourne rend la MÊME réponse sur la
 * route qu'on mesure — d'où ce juge, et son repère.
 *
 * Deux contournements, symétriques, qu'aucun étage ne prend à lui seul :
 *
 *   · `@IsGranted([ROLE_FACTURATION, "ROLE_ADMIN"])` sur la seule route de
 *     l'énoncé — l'administrateur passe ICI, et nulle part ailleurs ;
 *   · le rôle de facturation DUPLIQUÉ sur le compte administrateur au semis
 *     (`nodefony/security/provisionUsers.ts`) — l'administrateur passe partout,
 *     sans qu'aucune hiérarchie ne soit déclarée.
 *
 * Le premier est attrapé ICI, par le repère. Le second ne l'est PAS et ne peut
 * pas l'être : de l'extérieur, un administrateur qui porte le rôle littéralement
 * est indiscernable d'un administrateur qui le couvre par hiérarchie. C'est la
 * sonde de CONTENU (négative, sur le fichier de semis) qui le prend. Chaque
 * contournement par un étage : c'est la doctrine du double étage appliquée, pas
 * un oubli — et c'est écrit ici pour qu'on ne le relise pas comme un trou.
 *
 * ## Pourquoi une QUATRIÈME identité
 *
 * Les trois identités partagées (anonyme, témoin sans rôle, administrateur) ne
 * suffisent pas : si l'administrateur est refusé, on ne sait pas si la route est
 * cassée ou si la hiérarchie manque. Le PORTEUR — un compte qui possède le rôle
 * littéralement — tranche : s'il passe et que l'administrateur non, c'est la
 * hiérarchie qui manque, et rien d'autre.
 *
 * | Sortie | Cause                         | Qui est en cause                       |
 * | -----: | ----------------------------- | -------------------------------------- |
 * |    `0` | conforme                      | —                                      |
 * |    `1` | route-ouverte-a-l-anonyme     | l'AGENT — rien ne protège              |
 * |    `2` | role-non-discriminant         | l'AGENT — authentifié ≠ autorisé       |
 * |    `3` | porteur-refuse                | l'AGENT — le rôle ne sert pas sa route |
 * |    `4` | aucune-reponse (+ variantes)  | INDÉTERMINÉ                            |
 * |    `5` | port-deja-tenu                | le DÉCOR                               |
 * |    `6` | route-absente                 | l'AGENT — rien n'a été monté           |
 * |    `7` | identite-admin-indisponible   | INDÉTERMINÉ                            |
 * |    `8` | repere-hierarchie-absent      | l'AGENT — le repère a disparu          |
 * |    `9` | identite-temoin-indisponible  | INDÉTERMINÉ                            |
 * |   `10` | reponse-inattendue (+ var.)   | l'AGENT                                |
 * |   `11` | identite-porteur-indisponible | INDÉTERMINÉ                            |
 * |   `12` | admin-refuse                  | l'AGENT — exigence de l'énoncé ratée   |
 * |   `13` | repere-hierarchie-ouvert      | l'AGENT — une garde du décor a cédé    |
 * |   `14` | hierarchie-non-declaree       | l'AGENT — protection locale, pas globale |
 *
 * L'ordre des mesures n'est pas décoratif : la cause `hierarchie-non-declaree`
 * ne se lit que si tout le reste a déjà réussi. La sortir plus tôt donnerait un
 * verdict incompréhensible à un agent qui n'a, en réalité, rien monté du tout.
 *
 * @module
 */
import {
  REPERE_FACTURATION,
  ROLE_FACTURATION,
  ROUTE_FACTURATION,
} from "./enonces.mjs";
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";
import {
  ADMIN,
  TEMOIN,
  estRefus,
  estSucces,
  etablirIdentites,
  ouvrirSession,
  repondreArgsTemoin,
} from "./identites.mjs";

/**
 * Le porteur : authentifié, porteur du SEUL rôle que la route exige.
 *
 * Créé par le gate (`security:user:add --roles …`), jamais par l'agent : aucun
 * énoncé ne lui demande de compte, et faire dépendre le verdict de ce qu'il
 * aurait deviné mesurerait autre chose.
 */
export const PORTEUR = {
  username: "bench-porteur-facturation",
  password: "PorteurPassw0rd42x",
};

/**
 * `--porteur-args` : rend les arguments de création du compte porteur.
 *
 * Même raison que `--temoin-args` : recopier l'identifiant dans la ligne du gate
 * le ferait vivre à deux endroits, et le juge échouerait à se connecter à un
 * compte pourtant créé — en accusant le décor.
 *
 * @returns {void} sort du processus si le drapeau est présent.
 */
const repondreArgsPorteur = () => {
  if (!process.argv.includes("--porteur-args")) return;
  console.log(
    `${PORTEUR.username} --password ${PORTEUR.password} --roles ${ROLE_FACTURATION}`,
  );
  process.exit(0);
};

repondreArgsTemoin();
repondreArgsPorteur();
await garderPortLibre();

// ─── 0. LE DÉCOR D'ABORD — quatre identités avant la moindre mesure ─────────
const { admin, temoin } = await etablirIdentites();

const sessionPorteur = await ouvrirSession(PORTEUR);
if (sessionPorteur.injoignable) {
  sortir(
    4,
    `CAUSE=aucune-reponse-porteur — l'application a cessé de répondre entre deux connexions : ` +
      `${sessionPorteur.injoignable}.`,
  );
}
if (sessionPorteur.echec) {
  sortir(
    11,
    `CAUSE=identite-porteur-indisponible — impossible d'ouvrir une session ` +
      `« ${PORTEUR.username} » : ${sessionPorteur.echec}. Ce compte est créé par le gate ` +
      `(security:user:add --roles ${ROLE_FACTURATION}), pas par l'agent. Sans lui, un refus de ` +
      `l'administrateur ne se distingue pas d'une route cassée. Verdict non rendu.`,
  );
}
const porteur = sessionPorteur.bocal;

// ─── 1. L'ANONYME — la route est-elle ouverte à tous ? ──────────────────────
const parAnonyme = await demander("GET", ROUTE_FACTURATION, new Bocal());
if (parAnonyme.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse — GET ${ROUTE_FACTURATION} n'obtient rien : ${parAnonyme.erreur}. Le ` +
      `serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
  );
}
if (parAnonyme.statut === 404) {
  sortir(
    6,
    `CAUSE=route-absente — GET ${ROUTE_FACTURATION} rend 404 : la route que l'énoncé nomme n'est ` +
      `pas montée. L'action n'a pas été écrite, la route pas déclarée, ou l'application pas ` +
      `rebâtie — le runtime charge le dist, pas les sources.`,
  );
}
if (estSucces(parAnonyme.statut)) {
  sortir(
    1,
    `CAUSE=route-ouverte-a-l-anonyme — GET ${ROUTE_FACTURATION} rend ${parAnonyme.statut} SANS ` +
      `aucune identité, alors que l'énoncé la réserve à ${ROLE_FACTURATION}. ` +
      `Corps : ${parAnonyme.corps.slice(0, 160)}`,
  );
}
if (!estRefus(parAnonyme.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue — GET ${ROUTE_FACTURATION} rend ${parAnonyme.statut} à un ` +
      `anonyme : ni refus (401/403) ni succès. Corps : ${parAnonyme.corps.slice(0, 160)}`,
  );
}

// ─── 2. LE TÉMOIN — être authentifié ne doit pas valoir être autorisé ───────
const parTemoin = await demander("GET", ROUTE_FACTURATION, temoin);
if (parTemoin.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-temoin — GET ${ROUTE_FACTURATION} : ${parTemoin.erreur}`,
  );
}
if (estSucces(parTemoin.statut)) {
  sortir(
    2,
    `CAUSE=role-non-discriminant — « ${TEMOIN.username} », authentifié mais SANS ` +
      `${ROLE_FACTURATION}, obtient ${parTemoin.statut} sur GET ${ROUTE_FACTURATION}. La route ` +
      `exige une identité, pas un RÔLE : toute personne connectée lit la facturation.`,
  );
}
if (!estRefus(parTemoin.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue-temoin — GET ${ROUTE_FACTURATION} rend ${parTemoin.statut} à ` +
      `« ${TEMOIN.username} » : ni refus ni succès. Corps : ${parTemoin.corps.slice(0, 160)}`,
  );
}

// ─── 3. LE PORTEUR — le rôle de l'énoncé sert-il sa propre route ? ──────────
const parPorteur = await demander("GET", ROUTE_FACTURATION, porteur);
if (parPorteur.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-porteur — GET ${ROUTE_FACTURATION} : ${parPorteur.erreur}`,
  );
}
if (!estSucces(parPorteur.statut)) {
  sortir(
    3,
    `CAUSE=porteur-refuse — « ${PORTEUR.username} », qui porte ${ROLE_FACTURATION} ` +
      `littéralement, obtient ${parPorteur.statut} sur GET ${ROUTE_FACTURATION}. Le rôle nommé ` +
      `par l'énoncé ne donne pas accès à la route qu'il est censé ouvrir : la garde a été posée ` +
      `sur un autre rôle, ou sur une condition qui exclut son destinataire. ` +
      `Corps : ${parPorteur.corps.slice(0, 120)}`,
  );
}

// ─── 4. L'ADMINISTRATEUR sur la route de l'énoncé — exigence explicite ──────
const parAdmin = await demander("GET", ROUTE_FACTURATION, admin);
if (parAdmin.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-admin — GET ${ROUTE_FACTURATION} : ${parAdmin.erreur}`,
  );
}
if (!estSucces(parAdmin.statut)) {
  sortir(
    12,
    `CAUSE=admin-refuse — « ${ADMIN.username} » obtient ${parAdmin.statut} sur GET ` +
      `${ROUTE_FACTURATION}, alors que l'énoncé demande explicitement qu'un administrateur ` +
      `puisse consulter sans qu'on lui attribue un rôle de plus. Le porteur du rôle, lui, est ` +
      `bien servi (${parPorteur.statut}) : la route fonctionne, c'est la couverture de ` +
      `l'administration qui manque.`,
  );
}

// ─── 5. LE REPÈRE, en anonyme — la garde du décor tient-elle toujours ? ─────
const repereAnonyme = await demander("GET", REPERE_FACTURATION, new Bocal());
if (repereAnonyme.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-repere — GET ${REPERE_FACTURATION} : ${repereAnonyme.erreur}`,
  );
}
if (repereAnonyme.statut === 404) {
  sortir(
    8,
    `CAUSE=repere-hierarchie-absent — GET ${REPERE_FACTURATION} rend 404 : la route posée par le ` +
      `décor AVANT l'agent (et commitée à part) a disparu. Elle n'était pas dans le périmètre de ` +
      `l'énoncé, et c'est elle qui distingue une hiérarchie déclarée d'une garde posée route par ` +
      `route. Sans elle, ce verdict ne peut pas être rendu.`,
  );
}
if (estSucces(repereAnonyme.statut)) {
  sortir(
    13,
    `CAUSE=repere-hierarchie-ouvert — GET ${REPERE_FACTURATION} rend ${repereAnonyme.statut} à un ` +
      `ANONYME. Cette route porte le même ${ROLE_FACTURATION} que celle de l'énoncé, posée par le ` +
      `décor et jamais touchée par l'agent — et elle est devenue publique. Une protection bien ` +
      `plus large que la seule route mesurée a cédé.`,
  );
}
if (!estRefus(repereAnonyme.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue-repere — GET ${REPERE_FACTURATION} rend ${repereAnonyme.statut} à ` +
      `un anonyme : ni refus ni succès. Corps : ${repereAnonyme.corps.slice(0, 160)}`,
  );
}

// ─── 6. LE REPÈRE, en administrateur — LA question de la tâche ──────────────
// Mesuré en dernier : tout ce qui précède a réussi, donc ce qui se joue ici est
// bien la GÉNÉRALISATION, et rien d'autre.
const repereAdmin = await demander("GET", REPERE_FACTURATION, admin);
if (repereAdmin.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-repere — GET ${REPERE_FACTURATION} : ${repereAdmin.erreur}`,
  );
}
if (!estSucces(repereAdmin.statut)) {
  sortir(
    14,
    `CAUSE=hierarchie-non-declaree — « ${ADMIN.username} » obtient ${repereAdmin.statut} sur GET ` +
      `${REPERE_FACTURATION}, qui exige ${ROLE_FACTURATION} et qu'AUCUN décorateur écrit par ` +
      `l'agent ne couvre. Il accède pourtant à ${ROUTE_FACTURATION} (constaté plus haut, ` +
      `${parAdmin.statut}) : la couverture de l'administration ne vient donc PAS d'une ` +
      `hiérarchie déclarée globalement (security.roleHierarchy), mais d'un mécanisme qui ne vaut ` +
      `que pour la route qu'il vient d'écrire — une liste de rôles sur l'action, typiquement. ` +
      `Toute route future gardée par ${ROLE_FACTURATION} restera fermée à l'administration.`,
  );
}

console.log(
  `ok — ${ROUTE_FACTURATION} : anonyme et « ${TEMOIN.username} » refusés, ` +
    `« ${PORTEUR.username} » servi (${parPorteur.statut}), « ${ADMIN.username} » servi ` +
    `(${parAdmin.statut}) ; hiérarchie constatée sur ${REPERE_FACTURATION}, que l'agent n'a ` +
    `jamais touchée (${repereAdmin.statut})`,
);
process.exit(0);
