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
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
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
await ensurePortFree();

// ─── 0. LE DÉCOR D'ABORD — quatre identités avant la moindre mesure ─────────
const { admin, temoin } = await etablirIdentites();

const sessionPorteur = await ouvrirSession(PORTEUR);
if (sessionPorteur.injoignable) {
  exit(
    4,
    `CAUSE=aucune-reponse-porteur — l'application a cessé de répondre entre deux connexions : ` +
      `${sessionPorteur.injoignable}.`,
  );
}
if (sessionPorteur.echec) {
  exit(
    11,
    `CAUSE=identite-porteur-indisponible — impossible d'ouvrir une session ` +
      `« ${PORTEUR.username} » : ${sessionPorteur.echec}. Ce compte est créé par le gate ` +
      `(security:user:add --roles ${ROLE_FACTURATION}), pas par l'agent. Sans lui, un refus de ` +
      `l'administrateur ne se distingue pas d'une route cassée. Verdict non rendu.`,
  );
}
const porteur = sessionPorteur.jar;

// ─── 1. L'ANONYME — la route est-elle ouverte à tous ? ──────────────────────
const parAnonyme = await request("GET", ROUTE_FACTURATION, new CookieJar());
if (parAnonyme.error) {
  exit(
    4,
    `CAUSE=aucune-reponse — GET ${ROUTE_FACTURATION} n'obtient rien : ${parAnonyme.error}. Le ` +
      `serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
  );
}
if (parAnonyme.status === 404) {
  exit(
    6,
    `CAUSE=route-absente — GET ${ROUTE_FACTURATION} rend 404 : la route que l'énoncé nomme n'est ` +
      `pas montée. L'action n'a pas été écrite, la route pas déclarée, ou l'application pas ` +
      `rebâtie — le runtime charge le dist, pas les sources.`,
  );
}
if (estSucces(parAnonyme.status)) {
  exit(
    1,
    `CAUSE=route-ouverte-a-l-anonyme — GET ${ROUTE_FACTURATION} rend ${parAnonyme.status} SANS ` +
      `aucune identité, alors que l'énoncé la réserve à ${ROLE_FACTURATION}. ` +
      `Corps : ${parAnonyme.body.slice(0, 160)}`,
  );
}
if (!estRefus(parAnonyme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — GET ${ROUTE_FACTURATION} rend ${parAnonyme.status} à un ` +
      `anonyme : ni refus (401/403) ni succès. Corps : ${parAnonyme.body.slice(0, 160)}`,
  );
}

// ─── 2. LE TÉMOIN — être authentifié ne doit pas valoir être autorisé ───────
const parTemoin = await request("GET", ROUTE_FACTURATION, temoin);
if (parTemoin.error) {
  exit(
    4,
    `CAUSE=aucune-reponse-temoin — GET ${ROUTE_FACTURATION} : ${parTemoin.error}`,
  );
}
if (estSucces(parTemoin.status)) {
  exit(
    2,
    `CAUSE=role-non-discriminant — « ${TEMOIN.username} », authentifié mais SANS ` +
      `${ROLE_FACTURATION}, obtient ${parTemoin.status} sur GET ${ROUTE_FACTURATION}. La route ` +
      `exige une identité, pas un RÔLE : toute personne connectée lit la facturation.`,
  );
}
if (!estRefus(parTemoin.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue-temoin — GET ${ROUTE_FACTURATION} rend ${parTemoin.status} à ` +
      `« ${TEMOIN.username} » : ni refus ni succès. Corps : ${parTemoin.body.slice(0, 160)}`,
  );
}

// ─── 3. LE PORTEUR — le rôle de l'énoncé sert-il sa propre route ? ──────────
const parPorteur = await request("GET", ROUTE_FACTURATION, porteur);
if (parPorteur.error) {
  exit(
    4,
    `CAUSE=aucune-reponse-porteur — GET ${ROUTE_FACTURATION} : ${parPorteur.error}`,
  );
}
if (!estSucces(parPorteur.status)) {
  exit(
    3,
    `CAUSE=porteur-refuse — « ${PORTEUR.username} », qui porte ${ROLE_FACTURATION} ` +
      `littéralement, obtient ${parPorteur.status} sur GET ${ROUTE_FACTURATION}. Le rôle nommé ` +
      `par l'énoncé ne donne pas accès à la route qu'il est censé ouvrir : la garde a été posée ` +
      `sur un autre rôle, ou sur une condition qui exclut son destinataire. ` +
      `Corps : ${parPorteur.body.slice(0, 120)}`,
  );
}

// ─── 4. L'ADMINISTRATEUR sur la route de l'énoncé — exigence explicite ──────
const parAdmin = await request("GET", ROUTE_FACTURATION, admin);
if (parAdmin.error) {
  exit(
    4,
    `CAUSE=aucune-reponse-admin — GET ${ROUTE_FACTURATION} : ${parAdmin.error}`,
  );
}
if (!estSucces(parAdmin.status)) {
  exit(
    12,
    `CAUSE=admin-refuse — « ${ADMIN.username} » obtient ${parAdmin.status} sur GET ` +
      `${ROUTE_FACTURATION}, alors que l'énoncé demande explicitement qu'un administrateur ` +
      `puisse consulter sans qu'on lui attribue un rôle de plus. Le porteur du rôle, lui, est ` +
      `bien servi (${parPorteur.status}) : la route fonctionne, c'est la couverture de ` +
      `l'administration qui manque.`,
  );
}

// ─── 5. LE REPÈRE, en anonyme — la garde du décor tient-elle toujours ? ─────
const repereAnonyme = await request("GET", REPERE_FACTURATION, new CookieJar());
if (repereAnonyme.error) {
  exit(
    4,
    `CAUSE=aucune-reponse-repere — GET ${REPERE_FACTURATION} : ${repereAnonyme.error}`,
  );
}
if (repereAnonyme.status === 404) {
  exit(
    8,
    `CAUSE=repere-hierarchie-absent — GET ${REPERE_FACTURATION} rend 404 : la route posée par le ` +
      `décor AVANT l'agent (et commitée à part) a disparu. Elle n'était pas dans le périmètre de ` +
      `l'énoncé, et c'est elle qui distingue une hiérarchie déclarée d'une garde posée route par ` +
      `route. Sans elle, ce verdict ne peut pas être rendu.`,
  );
}
if (estSucces(repereAnonyme.status)) {
  exit(
    13,
    `CAUSE=repere-hierarchie-ouvert — GET ${REPERE_FACTURATION} rend ${repereAnonyme.status} à un ` +
      `ANONYME. Cette route porte le même ${ROLE_FACTURATION} que celle de l'énoncé, posée par le ` +
      `décor et jamais touchée par l'agent — et elle est devenue publique. Une protection bien ` +
      `plus large que la seule route mesurée a cédé.`,
  );
}
if (!estRefus(repereAnonyme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue-repere — GET ${REPERE_FACTURATION} rend ${repereAnonyme.status} à ` +
      `un anonyme : ni refus ni succès. Corps : ${repereAnonyme.body.slice(0, 160)}`,
  );
}

// ─── 6. LE REPÈRE, en administrateur — LA question de la tâche ──────────────
// Mesuré en dernier : tout ce qui précède a réussi, donc ce qui se joue ici est
// bien la GÉNÉRALISATION, et rien d'autre.
const repereAdmin = await request("GET", REPERE_FACTURATION, admin);
if (repereAdmin.error) {
  exit(
    4,
    `CAUSE=aucune-reponse-repere — GET ${REPERE_FACTURATION} : ${repereAdmin.error}`,
  );
}
if (!estSucces(repereAdmin.status)) {
  exit(
    14,
    `CAUSE=hierarchie-non-declaree — « ${ADMIN.username} » obtient ${repereAdmin.status} sur GET ` +
      `${REPERE_FACTURATION}, qui exige ${ROLE_FACTURATION} et qu'AUCUN décorateur écrit par ` +
      `l'agent ne couvre. Il accède pourtant à ${ROUTE_FACTURATION} (constaté plus haut, ` +
      `${parAdmin.status}) : la couverture de l'administration ne vient donc PAS d'une ` +
      `hiérarchie déclarée globalement (security.roleHierarchy), mais d'un mécanisme qui ne vaut ` +
      `que pour la route qu'il vient d'écrire — une liste de rôles sur l'action, typiquement. ` +
      `Toute route future gardée par ${ROLE_FACTURATION} restera fermée à l'administration.`,
  );
}

console.log(
  `ok — ${ROUTE_FACTURATION} : anonyme et « ${TEMOIN.username} » refusés, ` +
    `« ${PORTEUR.username} » servi (${parPorteur.status}), « ${ADMIN.username} » servi ` +
    `(${parAdmin.status}) ; hiérarchie constatée sur ${REPERE_FACTURATION}, que l'agent n'a ` +
    `jamais touchée (${repereAdmin.status})`,
);
process.exit(0);
