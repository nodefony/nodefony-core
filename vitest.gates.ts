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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  service?: { name: string; profile?: string };
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
export const OPT_IN_SWITCHES: ReadonlyArray<{ env: string; what: string }> = [
  {
    env: "NF_RUN_PERF",
    what: "micro-bancs de performance (seuils non déterministes)",
  },
  {
    env: "NF_RUN_CLI_BOOT",
    what: "boots CLI réels (lents : un kernel par cas)",
  },
  { env: "NF_RUN_CLUSTER_E2E", what: "scénarios cluster multi-process" },
  {
    env: "NF_RUN_WS_RUPTURE",
    what: "sondes de rupture WebSocket (épuisent les ports)",
  },
  {
    env: "NF_RUN_DB_OUTAGE",
    what:
      "coupures RÉELLES de base (arrête et relance un conteneur ; exige aussi " +
      "NF_DB_OUTAGE_{PG,MYSQL,MONGO}_CONTAINER)",
  },
];

/**
 * Masque le secret d'une URL de connexion pour l'affichage.
 *
 * Un rapport lisible ne doit pas devenir une fuite : ces URL finissent dans des
 * copies d'écran, des tickets et des journaux de CI.
 */
export function redactUrl(url: string): string {
  return url.replace(/(:\/\/[^:/@]*:)[^@]*@/, "$1***@");
}

/** Les variables requises par une gate — dérivées de {@link EnvGate.values}. */
export function gateEnv(gate: EnvGate): string[] {
  return Object.keys(gate.values());
}

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
export function gateValue(gate: EnvGate, name: string): string | undefined {
  const attendues = gateEnv(gate);
  if (!attendues.includes(name)) {
    throw new Error(
      `${name} n'est pas une variable de « ${gate.label} » ` +
        `(attendues : ${attendues.join(", ")}). Un banc ne choisit pas le nom ` +
        `de son décor : il le tient de la gate qui le contrôle.`,
    );
  }
  const value = (process.env[name] ?? "").trim();
  return value === "" ? undefined : value;
}

/** Commande docker qui démarre la cible, ou `null` si elle n'a pas de service. */
export function gateUpCommand(gate: EnvGate): string | null {
  if (!gate.service) return null;
  const profile = gate.service.profile
    ? ` --profile ${gate.service.profile}`
    : "";
  return `${COMPOSE}${profile} up -d ${gate.service.name}`;
}

/** Mode d'emploi copiable — dérivé du service et des valeurs, jamais retapé. */
export function gateHow(gate: EnvGate): string[] {
  const lines: string[] = [];
  const up = gateUpCommand(gate);
  if (up) lines.push(up);
  const assignments = Object.entries(gate.values()).map(
    ([k, v]) => `${k}=${v}`,
  );
  lines.push(`${assignments.join(" ")} npm test`);
  if (gate.note) lines.push(`# ${gate.note}`);
  return lines;
}

const COMPOSE_FILE = "docker/docker-compose.yml";
const COMPOSE = `docker compose -f ${COMPOSE_FILE}`;

/**
 * Identifiants par défaut **lus dans `docker/docker-compose.yml`**, jamais
 * recopiés ici.
 *
 * Le compose est entièrement paramétré (`${POSTGRES_PORT:-5432}`, …) : ces
 * `:-défaut` SONT la vérité de l'infra de dev. Les retaper dans ce fichier en
 * ferait une seconde source — la liste dupliquée, version identifiants — qui
 * mentirait dès que quelqu'un change un port ou un mot de passe. Un message
 * d'aide faux est pire que pas de message.
 *
 * `docker/.env` est lu en priorité quand il existe, parce que c'est ce que
 * docker compose lui-même fait : la commande affichée reste celle qui marche.
 */
let composeCache: Map<string, string> | null = null;

function composeDefaults(): Map<string, string> {
  if (composeCache) return composeCache;
  const values = new Map<string, string>();
  try {
    // Les modules natifs sont importés statiquement (ESM strict, règle projet) ;
    // c'est la LECTURE qui est paresseuse — rien n'est lu tant qu'aucun rapport
    // n'est affiché, et ce fichier est chargé par toutes les configs vitest.
    const root = dirname(fileURLToPath(import.meta.url));

    const yaml = readFileSync(join(root, COMPOSE_FILE), "utf8");
    for (const m of yaml.matchAll(/\$\{([A-Z_]+):-([^}]*)\}/g)) {
      values.set(m[1]!, m[2]!);
    }
    // `docker/.env` gagne sur les `:-défaut`, exactement comme pour compose.
    const envFile = join(root, "docker", ".env");
    if (existsSync(envFile)) {
      for (const line of readFileSync(envFile, "utf8").split("\n")) {
        const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) values.set(m[1]!, m[2]!.replace(/^["']|["']$/g, ""));
      }
    }
  } catch {
    // Compose absent (paquet publié, checkout partiel) → on retombe sur les
    // valeurs passées en `fallback`. Informer ne doit jamais faire échouer.
  }
  composeCache = values;
  return values;
}

/** Valeur du compose pour `name`, ou `fallback` si l'infra n'est pas lisible. */
function fromCompose(name: string, fallback: string): string {
  return composeDefaults().get(name) ?? fallback;
}

export const PG_GATE: EnvGate = {
  label: "PostgreSQL",
  service: { name: "postgres", profile: "postgres" },
  values: () => ({
    NF_PG_URL:
      `postgres://${fromCompose("POSTGRES_USER", "nodefony")}` +
      `:${fromCompose("POSTGRES_PASSWORD", "nodefony-dev")}` +
      `@127.0.0.1:${fromCompose("POSTGRES_PORT", "5432")}` +
      `/${fromCompose("POSTGRES_DB", "nodefony")}`,
  }),
};

/**
 * Le dialecte `mysql` couvre MySQL Community ET MariaDB : le compose expose les
 * deux (MariaDB en quotidien, MySQL sur un autre port pour prouver la compat),
 * d'où les deux commandes — avec les ports réels de CE compose.
 */
export const MYSQL_GATE: EnvGate = {
  label: "MySQL / MariaDB",
  service: { name: "mariadb", profile: "mariadb" },
  values: () => ({
    NF_MYSQL_URL:
      `mysql://${fromCompose("MARIADB_USER", "nodefony")}` +
      `:${fromCompose("MARIADB_PASSWORD", "nodefony-dev")}` +
      `@127.0.0.1:${fromCompose("MARIADB_PORT", "3306")}` +
      `/${fromCompose("MARIADB_DATABASE", "nodefony")}`,
  }),
  note: `MySQL Community est un AUTRE serveur (profil "mysql", port ${fromCompose("MYSQL_PORT", "3307")}) — cf MYSQL_COMMUNITY_GATE`,
};

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
export const MYSQL_COMMUNITY_GATE: EnvGate = {
  label: "MySQL Community",
  service: { name: "mysql", profile: "mysql" },
  values: () => ({
    NF_MYSQL_URL:
      `mysql://${fromCompose("MYSQL_USER", "nodefony")}` +
      `:${fromCompose("MYSQL_PASSWORD", "nodefony-dev")}` +
      `@127.0.0.1:${fromCompose("MYSQL_PORT", "3307")}` +
      `/${fromCompose("MYSQL_DATABASE", "nodefony")}`,
  }),
  note: "partage NF_MYSQL_URL avec MariaDB — se joue dans une passe séparée",
};

/**
 * Redis exige **deux** variables : `NF_REDIS_URL` (bancs de pagination) et
 * `NF_REDIS_TEST_URL` (banc comportemental, sur un index dédié pour ne pas polluer
 * la base de travail). Les deux portent le mot de passe — le serveur du compose
 * tourne en `requirepass`, et sans lui la connexion échoue en `NOAUTH`.
 */
export const REDIS_GATE: EnvGate = {
  label: "Redis (serveur réel)",
  service: { name: "redis" },
  values: () => {
    const pass = fromCompose("REDIS_PASSWORD", "nodefony-dev");
    const port = fromCompose("REDIS_PORT", "6379");
    return {
      NF_REDIS_URL: `redis://:${pass}@127.0.0.1:${port}`,
      // Index dédié : le banc comportemental purge sa base, il ne doit pas
      // emporter celle des bancs de pagination.
      NF_REDIS_TEST_URL: `redis://:${pass}@127.0.0.1:${port}/15`,
    };
  },
};

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
export const MONGO_GATE: EnvGate = {
  label: "MongoDB (replica set)",
  service: { name: "mongo", profile: "mongo" },
  values: () => ({
    NF_MONGO_TEST_URI:
      `mongodb://127.0.0.1:${fromCompose("MONGO_PORT", "27017")}` +
      `/?replicaSet=${fromCompose("MONGO_REPLSET", "rs0")}`,
  }),
};

/**
 * Loki (destination de logs LB.4, driver `loki`). Le driver mocké prouve le
 * format LogQL/push ; SEUL un vrai Loki prouve qu'il l'ACCEPTE (labels, fenêtre
 * de rejet des timestamps, `query_range`). Serveur du compose = HTTP simple sans
 * auth (dev). Une seule variable : l'URL de base (le driver ajoute les chemins).
 */
export const LOKI_GATE: EnvGate = {
  label: "Loki (serveur réel)",
  service: { name: "loki", profile: "loki" },
  values: () => ({
    NF_LOKI_TEST_URL: `http://127.0.0.1:${fromCompose("LOKI_PORT", "3100")}`,
  }),
};

/**
 * OpenSearch (destination de logs LB.4, driver `opensearch`). Idem Loki : le
 * mock prouve le corps `_bulk`/`_search`, un vrai serveur prouve qu'il l'accepte
 * ET que l'index/refresh se comportent comme attendu. Le compose désactive le
 * plugin de sécurité en dev → HTTP simple sans TLS ni auth sur :9200.
 */
export const OPENSEARCH_GATE: EnvGate = {
  label: "OpenSearch (serveur réel)",
  service: { name: "opensearch", profile: "opensearch" },
  values: () => ({
    NF_OPENSEARCH_TEST_URL: `http://127.0.0.1:${fromCompose("OPENSEARCH_PORT", "9200")}`,
  }),
};

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
export const PROXY_GATE: EnvGate = {
  label: "Reverse-proxy réels (nginx + haproxy)",
  service: { name: "nginx", profile: "proxy" },
  values: () => ({
    NF_PROXY_NGINX_URL: `http://localhost:${fromCompose("NGINX_PORT", "8080")}`,
    NF_PROXY_HAPROXY_URL: `http://localhost:${fromCompose("HAPROXY_PORT", "8081")}`,
    NF_PROXY_HAPROXY_TLS_URL: `https://nodefony.com:${fromCompose("HAPROXY_TLS_PORT", "8443")}`,
  }),
  note:
    "Exige un serveur lancé avec NF_BIND_ALL=1 (bind 0.0.0.0 + trustProxy), " +
    "`bash docker/certs/build-haproxy-pem.sh` (cert SAN=nodefony.com), et " +
    "`nodefony.com` dans /etc/hosts côté client.",
};

/** Les variables manquantes (ou vides) d'une gate ; `[]` = gate satisfaite. */
function missingVars(gate: EnvGate): string[] {
  return gateEnv(gate).filter((name) => isBlank(name));
}

/** Une variable absente ou vide — « posée à vide » vaut absente. */
function isBlank(name: string): boolean {
  return (process.env[name] ?? "").trim() === "";
}

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

/** Une attente non tenue, prête à être affichée. */
interface Unmet {
  label: string;
  /** Variables/interrupteurs absents. */
  missing: string[];
  /** Motifs sans aucun cas passé. */
  unproven: string[];
  /** Mode d'emploi copiable, quand une gate le fournit. */
  how: string[];
  /** Clés qui permettraient d'écarter cette attente via `NF_GATES_ALLOW`. */
  keys: string[];
}

/** Accepte la forme courte (`EnvGate` nue) comme la forme complète. */
function asExpectation(entry: EnvGate | GateExpectation): GateExpectation {
  return "values" in entry ? { gate: entry } : entry;
}

/** Les clés par lesquelles `NF_GATES_ALLOW` peut écarter une attente. */
function expectationKeys(x: GateExpectation): string[] {
  const keys = x.gate ? gateEnv(x.gate) : [];
  return x.switch ? [...keys, x.switch] : keys;
}

/** Les cibles que cette passe écarte SCIEMMENT (`NF_GATES_ALLOW`). */
function allowedKeys(): Set<string> {
  return new Set(
    (process.env.NF_GATES_ALLOW ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Attentes ponctuelles posées par un workflow, sans toucher à la configuration
 * du paquet : `NF_GATES_EXPECT="backoff NIST=1,NIST PARTAGÉ"`.
 *
 * Existe pour les preuves qui n'appartiennent PAS au paquet mais à la passe —
 * typiquement une sélection par `-t` dont le motif peut cesser de mordre après
 * un renommage, laissant vitest sortir 0 avec zéro cas exécuté.
 *
 * Le compte par défaut est 1 : la question posée est « ce cas a-t-il tourné »,
 * pas « combien de fois » — un plancher chiffré se périme au premier test ajouté.
 */
function envExpectations(): Array<{ pattern: string; min: number }> {
  return (process.env.NF_GATES_EXPECT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const at = item.lastIndexOf("=");
      if (at === -1) return { pattern: item, min: 1 };
      const min = Number.parseInt(item.slice(at + 1), 10);
      return Number.isFinite(min)
        ? { pattern: item.slice(0, at), min }
        : { pattern: item, min: 1 };
    });
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
export function gateReporter(
  entries:
    | ReadonlyArray<EnvGate | GateExpectation>
    | (() => ReadonlyArray<EnvGate | GateExpectation>),
) {
  /**
   * Vrai quand la passe a sélectionné ses cas par NOM (`-t`).
   *
   * Une telle passe n'exerce, par construction, qu'une fraction du paquet : lui
   * opposer les attentes du paquet la rendrait rouge à chaque fois, et le seul
   * moyen d'en sortir serait d'éteindre le rapporteur — c'est-à-dire de perdre
   * aussi `NF_GATES_EXPECT`, la seule chose qui protège une sélection (un motif
   * qui ne mord plus laisse vitest sortir 0 avec zéro cas exécuté). Les attentes
   * du PAQUET sont donc écartées ici, celles de la PASSE restent exigées.
   */
  let selective = false;
  return {
    onInit(vitest: unknown): void {
      try {
        const pattern = (
          vitest as { config?: { testNamePattern?: unknown } } | undefined
        )?.config?.testNamePattern;
        selective = pattern !== undefined && pattern !== null;
      } catch {
        // Forme interne inattendue : on préfère exiger que taire.
        selective = false;
      }
    },
    onTestRunEnd(testModules: ReadonlyArray<unknown>): void {
      const expectations = (
        typeof entries === "function" ? entries() : entries
      ).map(asExpectation);
      const skipped = countSkipped(testModules);
      const total = countAll(testModules);
      const allowed = allowedKeys();
      const blocking = (process.env.CI ?? "").trim() !== "";

      if (selective) {
        // Énoncé, jamais tu : une passe qui ne peut pas prouver la couverture du
        // paquet doit le DIRE, sinon son vert se lit comme celui d'une passe
        // complète — exactement le silence que ce rapporteur existe pour rompre.
        const expectFailures = evaluateEnvExpectations(testModules);
        if (expectFailures.length > 0) {
          reportUnmet([], expectFailures, [], skipped, total, blocking);
          if (blocking) process.exitCode = 1;
          return;
        }
        const motifs = envExpectations()
          .map((e) => `« ${e.pattern} »`)
          .join(", ");
        console.log(
          `\n\x1b[33m○ Sélection par nom (-t) : les attentes du paquet ne sont pas ` +
            `évaluées${motifs ? ` — attentes de la passe tenues : ${motifs}` : ""}.\x1b[0m`,
        );
        return;
      }

      // Une attente écartée par `NF_GATES_ALLOW` reste NOMMÉE : un choix énoncé
      // doit se lire dans le journal, sinon il redevient un oubli silencieux.
      const waived = expectations.filter((x) =>
        expectationKeys(x).some((k) => allowed.has(k)),
      );
      const examined = expectations.filter((x) => !waived.includes(x));
      const verdicts = examined.map(
        (x) => [x, evaluate(x, testModules)] as const,
      );
      const unmet = verdicts
        .map(([, u]) => u)
        .filter((u): u is Unmet => u !== null);
      // Une attente TENUE se nomme, qu'elle repose sur un décor (`gate`/`switch`)
      // ou sur la seule preuve qu'un cas a tourné (`proof`). Ne retenir que les
      // premières faisait afficher « cibles d'infra toutes exercées » à une passe
      // qui n'en déclare aucune — un message qui parle d'autre chose que de ce
      // qui vient d'être prouvé, donc un message qu'on apprend à ne plus lire.
      const met = verdicts
        .filter(([x, u]) => u === null && (x.gate ?? x.switch ?? x.proof))
        .map(([x]) => x);
      /** Vrai si au moins une attente tenue repose sur un vrai décor d'infra. */
      const anyInfra = met.some((x) => x.gate ?? x.switch);
      const expectFailures = evaluateEnvExpectations(testModules);

      if (unmet.length > 0 || expectFailures.length > 0) {
        reportUnmet(unmet, expectFailures, waived, skipped, total, blocking);
        if (blocking) process.exitCode = 1;
        return;
      }

      {
        // Rien de déclaré, rien à dire. Une suite qui ne dépend d'aucune cible
        // (le rapporteur n'est là que pour `NF_GATES_EXPECT`) ne doit pas se
        // voir affirmer que « tout a été exercé » : ce serait vrai au sens
        // logique et faux au sens utile, et un tel message finit par être lu
        // comme une preuve alors qu'il n'en porte aucune.
        const envExpected = envExpectations();
        if (expectations.length === 0 && envExpected.length === 0) return;

        // Aucune cible d'infra déclarée : ce qui vient d'être tenu, ce sont les
        // attentes de la PASSE. Le dire autrement ferait porter au décor une
        // preuve qu'il n'a pas fournie.
        if (expectations.length === 0) {
          const motifs = envExpected.map((e) => `« ${e.pattern} »`).join(", ");
          console.log(
            `\n\x1b[32m✔ Attentes de la passe tenues : ${motifs}.\x1b[0m`,
          );
          return;
        }

        const names = met.map(expectationLabel).join(", ");
        // Une exemption qui ne se voit plus est une exemption qu'on n'ôte
        // jamais : `NF_GATES_ALLOW` posé une fois dans un workflow y resterait
        // pour toujours, et « toutes exercées » deviendrait faux en silence.
        const head = waived.length
          ? `\n\x1b[32m✔ Cibles exercées${names ? ` : ${names}` : ""}.\x1b[0m` +
            `\n\x1b[33m  ○ écartées sciemment (NF_GATES_ALLOW) : ${waived.map(expectationLabel).join(", ")}\x1b[0m`
          : anyInfra
            ? `\n\x1b[32m✔ Cibles d'infra toutes exercées${names ? ` : ${names}` : ""}.\x1b[0m`
            : `\n\x1b[32m✔ Attentes tenues${names ? ` : ${names}` : ""}.\x1b[0m`;
        // L'infra n'est qu'une des deux façons de rester muet. Des tests peuvent
        // dormir derrière un INTERRUPTEUR DE COÛT (`NF_RUN_PERF`, `NF_RUN_CLUSTER_E2E`…),
        // fermé à raison mais dont le silence ressemble trait pour trait à une
        // suite complète. Annoncer « toutes exercées » en laissant N tests sautés
        // sans un mot, c'est signer un vert qu'on n'a pas gagné.
        const closed = OPT_IN_SWITCHES.filter(
          (sw) => !(process.env[sw.env] ?? "").trim(),
        );
        if (skipped === 0 || closed.length === 0) {
          console.log(head);
          return;
        }
        const pctSkipped = total > 0 ? Math.round((skipped / total) * 100) : 0;
        console.log(
          [
            head,
            `\x1b[33m  …mais ${skipped} test(s) sur ${total} n'ont pas tourné (${pctSkipped} %) — interrupteurs fermés :\x1b[0m`,
            ...closed.map(
              (sw) => `      \x1b[2m○ ${sw.env.padEnd(18)} ${sw.what}\x1b[0m`,
            ),
            `      \x1b[2m→ ${closed.map((c) => `${c.env}=1`).join(" ")} npm test\x1b[0m`,
          ].join("\n"),
        );
        return;
      }
    },
  };
}

/** L'étiquette lisible d'une attente. */
function expectationLabel(x: GateExpectation): string {
  return x.label ?? x.gate?.label ?? x.switch ?? "cible sans nom";
}

/** Les motifs d'une attente, sous forme de liste. */
function proofsOf(x: GateExpectation): string[] {
  if (!x.proof) return [];
  return typeof x.proof === "string" ? [x.proof] : [...x.proof];
}

/**
 * Confronte une attente à la passe qui vient de finir.
 *
 * @returns `null` si l'attente est tenue, sinon ce qui manque.
 */
function evaluate(
  x: GateExpectation,
  testModules: ReadonlyArray<unknown>,
): Unmet | null {
  const missing = x.gate ? missingVars(x.gate) : [];
  if (x.switch && isBlank(x.switch)) missing.push(x.switch);

  // Les preuves ne sont cherchées que si le décor est là : quand la variable
  // manque, exiger EN PLUS le motif noierait la cause sous sa conséquence.
  const unproven =
    missing.length === 0
      ? proofsOf(x).filter((p) => countPassedMatching(testModules, p) === 0)
      : [];

  if (missing.length === 0 && unproven.length === 0) return null;
  return {
    label: expectationLabel(x),
    missing,
    unproven,
    how: x.gate ? gateHow(x.gate) : x.switch ? [`${x.switch}=1 npm test`] : [],
    keys: expectationKeys(x),
  };
}

/** Les attentes `NF_GATES_EXPECT` non tenues par cette passe. */
function evaluateEnvExpectations(
  testModules: ReadonlyArray<unknown>,
): string[] {
  return envExpectations()
    .map(({ pattern, min }) => {
      const seen = countPassedMatching(testModules, pattern);
      return seen >= min
        ? null
        : `« ${pattern} » — ${seen} cas passé(s) au lieu de ${min} attendu(s)`;
    })
    .filter((m): m is string => m !== null);
}

/**
 * Le bloc de fin de passe quand une cible n'a pas été exercée.
 *
 * @param blocking - `true` en intégration continue : le vocabulaire devient
 *   celui d'un échec, parce que c'en est un.
 */
function reportUnmet(
  unmet: readonly Unmet[],
  expectFailures: readonly string[],
  waived: readonly GateExpectation[],
  skipped: number,
  total: number,
  blocking: boolean,
): void {
  const color = blocking ? "\x1b[31m" : "\x1b[33m";
  const bar = "─".repeat(72);
  const count = unmet.length + expectFailures.length;
  const lines: string[] = [
    "",
    `${color}${bar}`,
    blocking
      ? `✗ COUVERTURE INCOMPLÈTE — ${count} cible(s) n'ont PAS été exercées`
      : `⚠  COUVERTURE PARTIELLE — ${count} cible(s) n'ont PAS été testées`,
    bar + "\x1b[0m",
  ];

  for (const u of unmet) {
    const cause = u.missing.length
      ? `${u.missing.join(", ")} absente(s)`
      : `décor présent mais AUCUN cas passé pour ${u.unproven.map((p) => `« ${p} »`).join(", ")}`;
    lines.push(`  \x1b[1m${u.label}\x1b[0m — ${cause}`);
    for (const how of u.how) lines.push(`      ${how}`);
    lines.push("");
  }

  for (const failure of expectFailures) {
    lines.push(`  \x1b[1mNF_GATES_EXPECT\x1b[0m — ${failure}`);
    lines.push(
      "      \x1b[2mle motif de sélection ne mord plus (cas renommé ou déplacé)\x1b[0m",
    );
    lines.push("");
  }

  if (waived.length > 0) {
    lines.push(
      `  \x1b[2m○ écartées sciemment (NF_GATES_ALLOW) : ${waived.map(expectationLabel).join(", ")}\x1b[0m`,
    );
  }
  if (skipped > 0) {
    const pct = total > 0 ? Math.round((skipped / total) * 100) : 0;
    lines.push(
      `  ${color}${skipped} test(s) sur ${total} n'ont pas été exécutés (${pct} %).\x1b[0m`,
    );
  }
  lines.push(
    blocking
      ? "  \x1b[2mUn test skippé compte comme vert : cette passe échoue pour que ce vert ne mente pas.\x1b[0m\n" +
          `  \x1b[2mSi cette absence est VOULUE, énoncez-la : NF_GATES_ALLOW=${unmet.flatMap((u) => u.keys).join(",") || "<VARIABLE>"}\x1b[0m`
      : "  \x1b[2mUn test skippé compte comme vert : ce succès ne dit rien de ces cibles.\x1b[0m",
  );
  lines.push(`${color}${bar}\x1b[0m`);
  console.log(lines.join("\n"));
}

/**
 * Le nombre de cas PASSÉS dont le nom complet contient `pattern`.
 *
 * Toute surprise de forme rend 0 — ce qui rend l'attente non tenue, donc
 * bruyante. Un rapporteur d'honnêteté ne doit jamais se taire par accident.
 */
function countPassedMatching(
  testModules: ReadonlyArray<unknown>,
  pattern: string,
): number {
  let n = 0;
  for (const mod of testModules) {
    const children = (mod as { children?: { allTests?: unknown } }).children;
    const allTests = children?.allTests;
    if (typeof allTests !== "function") continue;
    try {
      for (const test of allTests.call(children, "passed") as Iterable<{
        fullName?: string;
      }>) {
        if ((test.fullName ?? "").includes(pattern)) n++;
      }
    } catch {
      // Module non collecté (échec d'import) → rien à compter ici.
    }
  }
  return n;
}

/** Compte les cas skippés, sans dépendre de la forme interne d'un module. */
function countSkipped(testModules: ReadonlyArray<unknown>): number {
  return countBy(testModules, "skipped");
}

/** Compte tous les cas collectés (exécutés ou non). */
function countAll(testModules: ReadonlyArray<unknown>): number {
  return countBy(testModules, undefined);
}

/**
 * Parcourt les modules via l'API publique `children.allTests(state?)`. Toute
 * surprise de forme (version de vitest, module non collecté) rend `0` plutôt que
 * de faire échouer la fin de suite : ce rapporteur ne doit JAMAIS être la cause
 * d'un échec — son rôle est d'informer.
 */
function countBy(
  testModules: ReadonlyArray<unknown>,
  state: "skipped" | undefined,
): number {
  let n = 0;
  for (const mod of testModules) {
    const children = (mod as { children?: { allTests?: unknown } }).children;
    const allTests = children?.allTests;
    if (typeof allTests !== "function") continue;
    try {
      for (const _ of allTests.call(children, state) as Iterable<unknown>) n++;
    } catch {
      // Module non collecté (échec d'import) → rien à compter ici.
    }
  }
  return n;
}
