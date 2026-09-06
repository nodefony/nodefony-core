/**
 * **Gates d'infrastructure des suites de test — source unique du monorepo.**
 *
 * Deux rôles, volontairement dans le MÊME fichier (l'un ment sans l'autre) :
 *
 * 1. **Le catalogue** des variables d'environnement qui conditionnent l'accès à
 *    un serveur réel (PostgreSQL, MySQL/MariaDB, Redis). Une variable écrite à
 *    deux endroits finit par diverger — vécu : la suite Redis se gate sur
 *    `NF_REDIS_TEST_URL` alors que le reste du package lit `NF_REDIS_URL`, et lancer la
 *    suite avec la seconde skippait 14 tests **en silence, tout en restant vert**.
 * 2. **Le rapporteur** qui, en fin de suite, dit à voix haute ce qui n'a PAS été
 *    exécuté, comment l'exécuter — et qui **fait ÉCHOUER la passe en intégration
 *    continue** quand une cible déclarée n'a pas été exercée.
 *
 * ## Pourquoi c'est nécessaire
 *
 * Vitest compte un test skippé comme un test qui ne bloque pas : la suite finit
 * verte. Sur `@nodefony/drizzle`, un `npm test` sans variables laisse **442 tests
 * sur 781 non exécutés** — soit les deux dialectes de PRODUCTION (PostgreSQL et
 * MySQL) — et annonce quand même un succès. Le vert par défaut ne prouve alors
 * que sqlite, sans jamais le dire.
 *
 * ## Deux régimes, une seule règle
 *
 * La règle est « un test non exécuté n'est pas un test réussi ». Sa sanction
 * dépend de qui lit :
 *
 * - **En local** (`CI` absent) : un AVERTISSEMENT. Travailler sur sqlite sans
 *   lever trois conteneurs est légitime ; bloquer y serait une punition.
 * - **En intégration continue** (`CI` posé) : un ÉCHEC. Personne ne lit un
 *   avertissement jaune dans un job vert — c'est très exactement le silence que
 *   ce fichier existe pour rompre.
 *
 * Un décor sciemment absent s'ÉNONCE, il ne s'oublie pas : `NF_GATES_ALLOW`
 * (ci-dessous) le déclare et le rapport le nomme.
 *
 * ## Deux preuves, pas une
 *
 * Les variables présentes ne prouvent que le DÉCOR. Une URL mal formée, un
 * serveur injoignable : les variables sont là, les suites SAUTENT, et le vert
 * revient. D'où `proof` — au moins un cas PASSÉ dont le nom contient le motif.
 * C'est la seule affirmation qu'un décor absent ne peut pas satisfaire.
 *
 * ## Usage (dans un `vitest.config.ts` de workspace)
 *
 * ```ts
 * import { gateReporter, PG_GATE, MYSQL_GATE } from "../../../../vitest.gates";
 *
 * export default defineConfig({
 *   test: {
 *     reporters: [
 *       "default",
 *       gateReporter([
 *         { gate: PG_GATE, proof: "(postgres)" },
 *         { gate: MYSQL_GATE, proof: "(mysql)" },
 *       ]),
 *     ],
 *   },
 * });
 * ```
 *
 * ## ⚠️ Ce rapporteur se DÉSARME en silence
 *
 * `--reporter=…` en ligne de commande **REMPLACE** `test.reporters` au lieu de
 * s'y ajouter. Une étape qui demande un rapport JSON par la ligne de commande
 * retire donc cette garde — sans un mot, et en restant verte. C'est arrivé au
 * workflow du gate mémoire le jour même où la garde y a été posée : la variable
 * était bien passée, le rapporteur n'était pas chargé.
 *
 * Un rapport supplémentaire se déclare donc DANS la configuration, où il
 * cohabite :
 *
 * ```ts
 * reporters: process.env.CI
 *   ? ["default", ["json", { outputFile: "rapport.json" }], gateReporter(gates)]
 *   : ["default", gateReporter(gates)],
 * ```
 *
 * ## Variables d'environnement lues par le rapporteur
 *
 * | Variable          | Effet                                                        |
 * | ----------------- | ------------------------------------------------------------ |
 * | `CI`              | non vide → une attente non tenue fait ÉCHOUER la passe        |
 * | `NF_GATES_ALLOW`  | liste (virgules) de variables/interrupteurs sciemment absents |
 * | `NF_GATES_EXPECT` | attentes ponctuelles `motif=N` posées par un workflow         |
 */
/**
 * Une cible d'infra dont l'exécution dépend de variables d'environnement.
 *
 * **Une seule source par cible** : `values()` produit les variables ET leurs
 * valeurs (lues dans le compose). Le nom des variables (`env`) et le mode d'emploi
 * (`how`) en DÉRIVENT — les écrire séparément recréerait la liste dupliquée que ce
 * fichier existe précisément pour supprimer, et un mode d'emploi faux est pire
 * qu'absent.
 */
export interface EnvGate {
  /** Nom lisible de la cible (ex. `"PostgreSQL"`). */
  label: string;
  /**
   * Service docker qui fournit cette cible, et son profil compose éventuel.
   * Absent = cible sans conteneur dédié.
   */
  service?: {
    name: string;
    profile?: string;
  };
  /**
   * Variables à poser pour exercer la cible, avec leurs valeurs de dev.
   *
   * **Fonction, pas objet** : les identifiants sont LUS dans le compose au moment
   * de l'appel. Rien n'est donc lu tant qu'on n'en a pas besoin.
   */
  values: () => Record<string, string>;
  /** Note libre affichée sous le mode d'emploi (variante, piège connu). */
  note?: string;
}
/**
 * Interrupteurs qui n'ouvrent pas une INFRA mais un COÛT : bancs de performance,
 * boots CLI réels, ruptures de charge. Ils sont fermés par défaut à raison — mais
 * leur silence ressemble à s'y méprendre à une suite complète.
 *
 * Le rapport les nomme pour que « 47 sautés » cesse d'être un chiffre opaque.
 */
export declare const OPT_IN_SWITCHES: ReadonlyArray<{
  env: string;
  what: string;
}>;
/**
 * Masque le secret d'une URL de connexion pour l'affichage.
 *
 * Un rapport lisible ne doit pas devenir une fuite : ces URL finissent dans des
 * copies d'écran, des tickets et des journaux de CI.
 */
export declare function redactUrl(url: string): string;
/** Les variables requises par une gate — dérivées de {@link EnvGate.values}. */
export declare function gateEnv(gate: EnvGate): string[];
/**
 * La valeur POSÉE pour une variable de cette gate — `undefined` si absente ou vide.
 *
 * **À préférer à `process.env.X` dans un banc.** Un banc qui nomme sa variable
 * lui-même finit par nommer une AUTRE variable que celle dont son propre
 * rapporteur constate l'absence : le décor est là, les cas tournent, et la passe
 * échoue en annonçant « cible non exercée » — ou pire, ils sautent en silence
 * pendant que la gate voit sa variable posée. Passer par ici rend les deux
 * impossibles : le nom demandé doit être un nom que la gate exige.
 *
 * @param gate - la cible dont on veut lire le décor.
 * @param name - la variable, telle que la gate la nomme.
 * @returns la valeur posée, ou `undefined`.
 * @throws Error si `name` n'est pas une variable de cette gate — c'est un banc
 *   qui a inventé un nom, exactement la faute que ce helper existe pour rendre
 *   visible.
 */
export declare function gateValue(
  gate: EnvGate,
  name: string,
): string | undefined;
/** Commande docker qui démarre la cible, ou `null` si elle n'a pas de service. */
export declare function gateUpCommand(gate: EnvGate): string | null;
/** Mode d'emploi copiable — dérivé du service et des valeurs, jamais retapé. */
export declare function gateHow(gate: EnvGate): string[];
export declare const PG_GATE: EnvGate;
/**
 * Le dialecte `mysql` couvre MySQL Community ET MariaDB : le compose expose les
 * deux (MariaDB en quotidien, MySQL sur un autre port pour prouver la compat),
 * d'où les deux commandes — avec les ports réels de CE compose.
 */
export declare const MYSQL_GATE: EnvGate;
/**
 * MySQL **Community** — la même variable que MariaDB, un serveur différent.
 *
 * MariaDB est un fork : même protocole, même driver, même dialecte drizzle. Mais
 * « même dialecte » n'est pas « même serveur » — la collation par défaut, les
 * bornes numériques et le comportement de `ON DUPLICATE KEY UPDATE` ont déjà
 * divergé entre les deux. Exercer l'un ne dit rien de l'autre.
 *
 * Les deux partagent `NF_MYSQL_URL` : on ne peut pas les couvrir dans la même
 * passe, il faut rejouer les suites ORM en pointant l'autre serveur. C'est ce que
 * fait `npm run test:all -- --dialects`.
 */
export declare const MYSQL_COMMUNITY_GATE: EnvGate;
/**
 * Redis exige **deux** variables : `NF_REDIS_URL` (bancs de pagination) et
 * `NF_REDIS_TEST_URL` (banc comportemental, sur un index dédié pour ne pas polluer
 * la base de travail). Les deux portent le mot de passe — le serveur du compose
 * tourne en `requirepass`, et sans lui la connexion échoue en `NOAUTH`.
 */
export declare const REDIS_GATE: EnvGate;
/**
 * MongoDB exige un **replica set**, pas seulement un serveur : sans lui, Mongo
 * refuse toute session transactionnelle, et les bancs qui prouvent l'atomicité
 * échoueraient sur une erreur qui ne parle pas du décor.
 *
 * Particularité de cette cible : à défaut de `NF_MONGO_TEST_URI`, la suite tente de
 * télécharger et lancer un `mongod` éphémère. Quand ça échoue (hors ligne, binaire
 * absent), elle **skippe sans rien casser** — 146 tests peuvent rester muets
 * derrière un vert. D'où cette gate : nommer la cible non exercée est le seul
 * moyen de distinguer « couvert » de « silencieusement absent ».
 */
export declare const MONGO_GATE: EnvGate;
/**
 * Loki (destination de logs LB.4, driver `loki`). Le driver mocké prouve le
 * format LogQL/push ; SEUL un vrai Loki prouve qu'il l'ACCEPTE (labels, fenêtre
 * de rejet des timestamps, `query_range`). Serveur du compose = HTTP simple sans
 * auth (dev). Une seule variable : l'URL de base (le driver ajoute les chemins).
 */
export declare const LOKI_GATE: EnvGate;
/**
 * OpenSearch (destination de logs LB.4, driver `opensearch`). Idem Loki : le
 * mock prouve le corps `_bulk`/`_search`, un vrai serveur prouve qu'il l'accepte
 * ET que l'index/refresh se comportent comme attendu. Le compose désactive le
 * plugin de sécurité en dev → HTTP simple sans TLS ni auth sur :9200.
 */
export declare const OPENSEARCH_GATE: EnvGate;
/**
 * Reverse-proxy RÉELS devant le serveur (profil compose `proxy`) — nginx pose
 * les `X-Forwarded-*` de fait, haproxy le `Forwarded` standard (RFC 7239) et
 * re-chiffre vers le backend avec validation complète de la chaîne.
 *
 * Ce que ce décor prouve et qu'aucun test unitaire ne peut prouver : que ce
 * qu'un VRAI proxy pose correspond à ce que le serveur ATTEND. Le parser se
 * teste contre l'idée qu'on se fait du format ; un seul mot de configuration
 * renverse l'entrée (`$proxy_add_x_forwarded_for` PRÉSERVE la chaîne forgée par
 * le client, `$remote_addr` l'écrase) sans qu'aucun test unitaire ne bouge — et
 * l'écart est une usurpation d'adresse, pas une différence de style.
 *
 * Trois portes, trois questions distinctes : nginx en clair, haproxy en clair
 * (le lien interne est chiffré, le client NON), haproxy en TLS de bout en bout.
 *
 * ⚠️ Décor à deux versants — le serveur doit écouter une adresse joignable
 * depuis un conteneur (`NF_BIND_ALL=1`, qui active aussi `trustProxy`), et
 * `nodefony.com` doit résoudre vers l'hôte des DEUX côtés (`extra_hosts` dans le
 * compose, `/etc/hosts` côté client).
 */
export declare const PROXY_GATE: EnvGate;
/**
 * Ce qu'une suite doit avoir exercé pour que son vert veuille dire quelque chose.
 *
 * Trois façons de l'exprimer, combinables :
 *
 * - `gate` — un décor d'infra ; ses variables doivent être posées ;
 * - `switch` — un interrupteur de coût ({@link OPT_IN_SWITCHES}) qui doit être ouvert ;
 * - `proof` — le motif d'un nom de test qui doit avoir PASSÉ.
 *
 * `proof` est ce qui distingue « le décor était là » de « le décor a servi ».
 * Les deux se trompent séparément : une URL peut être posée et mal formée, un
 * interrupteur ouvert sur une suite dont les cas ont été renommés.
 */
export interface GateExpectation {
  /** Décor d'infra requis — ses variables doivent être posées. */
  gate?: EnvGate;
  /** Interrupteur de coût requis (nom de la variable, ex. `"NF_RUN_CLUSTER_E2E"`). */
  switch?: string;
  /** Étiquette lisible ; par défaut celle de la gate ou le nom de l'interrupteur. */
  label?: string;
  /**
   * Motif(s) qu'au moins un test PASSÉ doit contenir dans son nom complet.
   * Plusieurs motifs = plusieurs preuves indépendantes, toutes exigées.
   */
  proof?: string | readonly string[];
}
/**
 * Rapporteur vitest qui clôt la suite par un état des cibles NON testées — et
 * qui **fait échouer la passe en intégration continue** quand l'une d'elles n'a
 * pas été exercée.
 *
 * Silencieux au sens strict quand tout est couvert : il confirme en une ligne
 * (l'information « les 3 dialectes ont tourné » vaut d'être affirmée, pas
 * seulement déduite d'une absence d'avertissement).
 *
 * Il ne lève JAMAIS : il pose `process.exitCode`. Une exception ici masquerait
 * le rapport de la suite elle-même, qui est ce qu'on est venu lire.
 *
 * @param entries - les cibles que CE paquet sait exercer, en {@link EnvGate}
 *   nue (décor seul) ou en {@link GateExpectation} (décor + preuve d'exécution).
 *   Une FONCTION est acceptée : elle est appelée à la fin de la passe, pas au
 *   chargement de la configuration — indispensable quand une attente dépend d'un
 *   fait CONSTATÉ au démarrage (le mode du serveur visé, sondé par un
 *   `globalSetup`, n'est pas connu quand vitest lit le fichier de configuration).
 * @returns un reporter à placer dans `test.reporters`.
 */
export declare function gateReporter(
  entries:
    | ReadonlyArray<EnvGate | GateExpectation>
    | (() => ReadonlyArray<EnvGate | GateExpectation>),
): {
  onInit(vitest: unknown): void;
  onTestRunEnd(testModules: ReadonlyArray<unknown>): void;
};
