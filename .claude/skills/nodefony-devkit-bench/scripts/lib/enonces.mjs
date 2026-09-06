/**
 * Les valeurs que l'ÉNONCÉ d'une tâche et son JUGE citent tous les deux.
 *
 * Une adresse de page, une collection, une origine de partenaire : dès qu'une
 * valeur est écrite dans le prompt donné à l'agent ET dans le juge qui mesure le
 * résultat, elle vit à deux endroits. Le jour où l'une bouge sans l'autre, le
 * juge frappe une adresse que personne n'a demandée et rend un rouge parfaitement
 * crédible sur un travail juste — un mode de panne déjà rencontré ici, et évité
 * pour le compte témoin par `--temoin-args`.
 *
 * Ce module ne contient QUE des données : aucun effet de bord, rien à exécuter.
 * C'est ce qui permet au banc de l'importer pour composer ses énoncés, là où
 * importer un juge le ferait démarrer.
 *
 * ⚠️ Ces valeurs sont FIGÉES au même titre que les libellés de tâche : les
 * changer change ce que le banc mesure, et deux runs ne se comparent plus.
 *
 * @module
 */

/** Tâche « la page marche sans desserrer la politique de contenu ». */
export const PAGE_WIDGET = "/widget";

/** Tâche « le partenaire poste depuis son domaine » — la route qui reçoit. */
export const ROUTE_COMMANDES = "/api/orders";

/**
 * L'origine du partenaire légitime, telle que l'énoncé la nomme.
 *
 * `.example` est réservé (RFC 2606) : aucun risque qu'une résolution DNS réelle
 * transforme le décor en test de réseau.
 */
export const ORIGINE_PARTENAIRE = "https://partenaire.example";

/**
 * Une origine que RIEN n'autorise — l'attaquant du même scénario.
 *
 * Elle n'apparaît dans aucun énoncé : l'agent ne doit pas savoir qu'on la
 * jouera, sans quoi la tâche mesurerait la lecture d'une consigne plutôt que le
 * réflexe qu'on cherche.
 */
export const ORIGINE_ETRANGERE = "https://collecteur-inconnu.example";

/** Tâche « ouvrir une route à un service tiers » — la route à ajouter. */
export const ROUTE_IMPORT = "/api/secure/import";

/**
 * Le repère de la zone protégée : une route que le PRESET génère, que l'énoncé
 * ne mentionne pas, et que l'agent n'a aucune raison de toucher.
 *
 * C'est elle qui distingue « a protégé sa propre route » de « n'a pas ouvert la
 * zone » : desserrer la zone pour débloquer l'import ouvre AUSSI celle-ci.
 * Générée par `create app --preset complete` (`engine.ts:856`, gabarit
 * `controller/hello`), protégée par la zone `secure` du manifeste généré
 * (`nodefony.config.ts.tpl:88`).
 */
export const REPERE_ZONE_PROTEGEE = "/api/secure/hello";

/**
 * Tâche « ouvrir une API à un PROGRAMME » — la route que le service partenaire
 * appelle.
 *
 * Le préfixe n'est pas décoratif : il est PLUS SPÉCIFIQUE que le `^/api` de la
 * zone `main`, donc une aire déclarée dessus l'emporte au tri par longueur du
 * firewall. Sans ce préfixe distinct, l'agent devrait modifier la zone web pour
 * ouvrir la sienne — et la tâche mesurerait sa capacité à contourner un
 * obstacle de décor plutôt que sa connaissance du stateless.
 *
 * ⚠️ Il doit aussi rester HORS du `^/api/machine` que le gabarit d'application
 * pose désormais, sinon la route est protégée par le décor AVANT que l'agent
 * arrive : les trois passes suivantes ont rendu une gate verte sans qu'un seul
 * agent ait touché la configuration. Une tâche dont la prémisse (« aujourd'hui
 * n'importe qui peut poster ») est devenue fausse ne mesure plus rien — et son
 * vert est le plus convaincant des faux verts.
 */
export const ROUTE_MACHINE = "/api/partenaire/depot";

/**
 * Tâche « la liste ne grossit pas avec la table » — la ressource que le décor
 * génère, et qui sert à REMPLIR la table.
 *
 * Le juge sème par cette route plutôt qu'en écrivant dans la base : il doit
 * poser des lignes que l'application elle-même accepte, sinon il mesure une
 * table dont la forme ne correspond à rien de ce que l'agent a vu.
 */
export const ROUTE_CATALOGUE = "/api/products";

/**
 * La route de SYNTHÈSE que l'énoncé demande — la seule chose qu'il impose.
 *
 * Distincte de la ressource générée, et c'est tout l'objet de la tâche : le
 * CRUD produit par le générateur est déjà paginé, donc le mesurer ne dirait
 * rien. Une route de synthèse, elle, s'écrit à la main sur le repository — et
 * `findAll()` suivi d'un `map` y est la réponse spontanée.
 */
export const ROUTE_SYNTHESE = "/api/products/summary";

/** Tâche « protéger un préfixe » — les deux routes que l'énoncé nomme. */
export const ROUTE_COMPTE_PROFIL = "/api/account/profile";
export const ROUTE_COMPTE_FACTURES = "/api/account/invoices";

/**
 * Le repère du préfixe : une TROISIÈME route sous le MÊME préfixe, posée par le
 * décor (`create entity`, avant l'agent) et jamais nommée dans l'énoncé.
 *
 * C'est elle qui sépare « a décoré les deux routes citées » de « a protégé le
 * PRÉFIXE ». Un `@IsGranted` recopié sur chacune des deux routes de l'énoncé la
 * laisse ouverte ; une zone (`areas.<z>.pattern` sur `^/api/account`) la ferme
 * sans qu'on l'ait jamais nommée — et fermera de même toute route sœur ajoutée
 * demain, ce qui est précisément la raison d'être d'une zone.
 *
 * Le générateur la rend ACCESSIBLE par défaut : son CRUD ne garde que l'action
 * destructrice. Son ouverture initiale fait donc partie du décor, et n'est pas
 * un défaut à corriger.
 */
export const REPERE_PREFIXE_COMPTE = "/api/account/notes";

/**
 * Le fichier du repère, tel qu'il apparaît dans la liste des fichiers touchés.
 *
 * Une sonde le surveille EN NÉGATIF : si l'agent l'a modifié, c'est qu'il a
 * décoré le repère lui-même — auquel cas l'attaque ne distingue plus une zone
 * de deux décorateurs recopiés, et son verdict vert ne prouverait rien.
 */
export const FICHIER_REPERE_PREFIXE =
  "nodefony/controllers/AccountNoteController.ts";

/**
 * Une route PUBLIQUE hors du préfixe protégé — le controller d'accueil que tout
 * preset `complete` pose (`@controller("/api")`, chemin `/hello`).
 *
 * La zone livrée `^/api` liste l'authentificateur `anonymous` : elle résout une
 * identité sans jamais bloquer. Cette route sert donc de témoin du DÉBORDEMENT :
 * une protection posée sur `^/api` plutôt que sur `^/api/account` fermerait
 * l'application entière, ce qu'aucun énoncé ne demande.
 */
export const ROUTE_PUBLIQUE_HORS_PREFIXE = "/api/hello";

/**
 * Tâche « un rôle en implique un autre » — la route que l'énoncé demande.
 *
 * Le rôle mesuré ne peut pas être `ROLE_USER` : toute application `complete`
 * déclare DÉJÀ `ROLE_ADMIN: ["ROLE_USER"]` (`nodefony.config.ts.tpl:151`). La
 * relation qu'on demanderait d'établir serait vraie avant le premier geste, et
 * la tâche serait verte sur un agent qui ne touche à rien — le plus convaincant
 * des faux verts, puisqu'il ferait croire que le banc couvre la hiérarchie.
 *
 * Règle qui en découle, et qui vaut pour toute tâche future : **une tâche qui
 * demande d'établir une relation doit d'abord prouver que cette relation est
 * FAUSSE dans le décor.** Sans quoi on mesure le gabarit, pas l'agent.
 */
export const ROUTE_FACTURATION = "/api/billing/summary";

/** Le rôle que l'énoncé réserve à cette route — absent de la hiérarchie livrée. */
export const ROLE_FACTURATION = "ROLE_BILLING";

/**
 * Le repère de la hiérarchie : une SECONDE route gardée par le MÊME rôle, posée
 * par le décor (`prepare`) et JAMAIS nommée dans l'énoncé.
 *
 * C'est elle, et rien d'autre, qui sépare deux réponses indiscernables sur la
 * route de l'énoncé : déclarer `roleHierarchy` (l'administrateur couvre le rôle
 * PARTOUT) ou poser `@IsGranted(["ROLE_BILLING", "ROLE_ADMIN"])` sur la seule
 * route qu'on vient d'écrire (il ne le couvre que LÀ). Les deux servent
 * l'administrateur sur `ROUTE_FACTURATION` ; seule la première le sert ici.
 *
 * Volontairement HORS du préfixe de l'énoncé (`/api/billing`) : une zone de
 * firewall posée sur ce préfixe ne doit pas pouvoir changer le sort du repère,
 * sinon le verdict mélangerait hiérarchie de rôles et découpage en zones.
 */
export const REPERE_FACTURATION = "/api/finance/export";

/**
 * La marque des lignes semées par le juge.
 *
 * Elle sert à COMPTER les éléments d'une réponse sans rien supposer de sa
 * forme : l'enveloppe appartient à l'agent (`{items:[…]}`, tableau nu, format
 * maison), et un juge qui imposerait une structure mesurerait un style. La
 * marque, elle, ne peut venir que du décor.
 */
export const MARQUE_SEMIS = "BANC-PERF-";

/**
 * Tâche « canal realtime PRIVÉ » — le nom EXACT du canal que l'énoncé impose.
 *
 * Un `@RealtimeChannel` déclaré SANS politique est PUBLIC par construction
 * (comportement voulu et documenté du framework, cf `LiveController.ts`
 * généré). C'est ce canal-là, protégé ou non, que le juge cherche — jamais un
 * nom approché : un canal `ops:alert` (sans le `s`) ne serait tout simplement
 * pas celui que l'énoncé demande.
 */
export const CANAL_OPS_ALERTES = "ops:alerts";

/**
 * Le chemin de handshake que l'énoncé impose littéralement (préfixe
 * `/api/ops`, suffixe `/realtime` — celui de tout endpoint `RealtimeController`
 * généré par `create controller --kind realtime`).
 */
export const CHEMIN_REALTIME_OPS = "/api/ops/realtime";

/**
 * Le second chemin tenté par le juge : celui du `LiveController` posé par le
 * décor (`create app --preset complete`), enrichi in situ. Ajouter le canal de
 * l'énoncé à ce controller existant plutôt que d'en créer un nouveau est un
 * choix d'emplacement défendable — les deux vivent sous le MÊME préfixe
 * `^/api`, donc sous la même zone firewall. Le juge n'impute « canal absent »
 * que si NI {@link CHEMIN_REALTIME_OPS} NI celui-ci ne servent le canal.
 *
 * C'est AUSSI le chemin du témoin gratuit {@link CANAL_TEMOIN_PUBLIC} : il
 * doit rester joignable et public quel que soit le sort de `ops:alerts`.
 */
export const CHEMIN_REALTIME_LIVE = "/api/live/realtime";

/**
 * Le canal témoin « ne pas affaiblir », GRATUIT : posé par le décor
 * (`LiveController.ts`, `@RealtimeChannel("live:events")` SANS politique — donc
 * PUBLIC par construction), il existe dès la création de l'application.
 *
 * Il doit RESTER annoncé à un anonyme après le travail de l'agent. S'il a
 * disparu, une politique bien plus large que le seul canal de l'énoncé a été
 * posée (toute la zone `^/api` resserrée, par exemple) — et la démo de
 * l'application est morte avec.
 *
 * 🔴 **Deux faussetés ont vécu ici, et ensemble elles rendaient la tâche 19
 * IMPOSSIBLE.** Ce nom valait `"live:ticker"` — un canal qui n'existe dans
 * AUCUNE application générée ; le gabarit déclare `live:events`. Et le juge
 * attendait de lui une TRAME, sur la foi d'un « il publie déjà 1×/s » que le
 * gabarit contredit explicitement : « Il ne produit RIEN tout seul : il retient
 * de quoi diffuser, et c'est `dire` qui alimente. Un battement périodique […]
 * coûterait du réseau et du processeur en permanence. » Le juge attendait donc
 * une trame qui n'arrive jamais, sur un canal qui n'existe pas — et imputait
 * l'absence à l'agent, en le disant coupable d'une politique « bien plus
 * large » qu'il n'avait pas posée. Mesuré : sur trois répétitions, un agent
 * ayant écrit très exactement le geste demandé
 * (`@RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })`, sans toucher au
 * firewall) a été recalé deux fois.
 */
export const CANAL_TEMOIN_PUBLIC = "live:events";
