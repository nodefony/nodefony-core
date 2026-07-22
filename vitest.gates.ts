/**
 * **Gates d'infrastructure des suites de test — source unique du monorepo.**
 *
 * Deux rôles, volontairement dans le MÊME fichier (l'un ment sans l'autre) :
 *
 * 1. **Le catalogue** des variables d'environnement qui conditionnent l'accès à
 *    un serveur réel (PostgreSQL, MySQL/MariaDB, Redis). Une variable écrite à
 *    deux endroits finit par diverger — vécu : la suite Redis se gate sur
 *    `REDIS_TEST_URL` alors que le reste du package lit `REDIS_URL`, et lancer la
 *    suite avec la seconde skippait 14 tests **en silence, tout en restant vert**.
 * 2. **Le rapporteur** qui, en fin de suite, dit à voix haute ce qui n'a PAS été
 *    exécuté et comment l'exécuter.
 *
 * ## Pourquoi c'est nécessaire
 *
 * Vitest compte un test skippé comme un test qui ne bloque pas : la suite finit
 * verte. Sur `@nodefony/drizzle`, un `npm test` sans variables laisse **442 tests
 * sur 781 non exécutés** — soit les deux dialectes de PRODUCTION (PostgreSQL et
 * MySQL) — et annonce quand même un succès. Le vert par défaut ne prouve alors
 * que sqlite, sans jamais le dire. Ce rapporteur transforme ce silence en
 * avertissement lisible : un banc non joué n'est pas un banc réussi.
 *
 * ## Usage (dans un `vitest.config.ts` de workspace)
 *
 * ```ts
 * import { gateReporter, PG_GATE, MYSQL_GATE } from "../../../../vitest.gates";
 *
 * export default defineConfig({
 *   test: { reporters: ["default", gateReporter([PG_GATE, MYSQL_GATE])] },
 * });
 * ```
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
    env: "RUN_PERF",
    what: "micro-bancs de performance (seuils non déterministes)",
  },
  { env: "RUN_CLI_BOOT", what: "boots CLI réels (lents : un kernel par cas)" },
  { env: "RUN_CLUSTER_E", what: "scénarios cluster multi-process" },
  {
    env: "RUN_WS_RUPTURE",
    what: "sondes de rupture WebSocket (épuisent les ports)",
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
 * Redis exige **deux** variables : `REDIS_URL` (bancs de pagination) et
 * `REDIS_TEST_URL` (banc comportemental, sur un index dédié pour ne pas polluer
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
      REDIS_URL: `redis://:${pass}@127.0.0.1:${port}`,
      // Index dédié : le banc comportemental purge sa base, il ne doit pas
      // emporter celle des bancs de pagination.
      REDIS_TEST_URL: `redis://:${pass}@127.0.0.1:${port}/15`,
    };
  },
};

/**
 * MongoDB exige un **replica set**, pas seulement un serveur : sans lui, Mongo
 * refuse toute session transactionnelle, et les bancs qui prouvent l'atomicité
 * échoueraient sur une erreur qui ne parle pas du décor.
 *
 * Particularité de cette cible : à défaut de `MONGO_TEST_URI`, la suite tente de
 * télécharger et lancer un `mongod` éphémère. Quand ça échoue (hors ligne, binaire
 * absent), elle **skippe sans rien casser** — 146 tests peuvent rester muets
 * derrière un vert. D'où cette gate : nommer la cible non exercée est le seul
 * moyen de distinguer « couvert » de « silencieusement absent ».
 */
export const MONGO_GATE: EnvGate = {
  label: "MongoDB (replica set)",
  service: { name: "mongo", profile: "mongo" },
  values: () => ({
    MONGO_TEST_URI:
      `mongodb://127.0.0.1:${fromCompose("MONGO_PORT", "27017")}` +
      `/?replicaSet=${fromCompose("MONGO_REPLSET", "rs0")}`,
  }),
};

/** Les variables manquantes (ou vides) d'une gate ; `[]` = gate satisfaite. */
function missingVars(gate: EnvGate): string[] {
  return gateEnv(gate).filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
}

/**
 * Rapporteur vitest qui clôt la suite par un état des cibles NON testées.
 *
 * Silencieux au sens strict quand tout est couvert : il confirme en une ligne
 * (l'information « les 3 dialectes ont tourné » vaut d'être affirmée, pas
 * seulement déduite d'une absence d'avertissement).
 *
 * @param gates - les cibles que CE package sait exercer.
 * @returns un reporter à placer dans `test.reporters`.
 */
export function gateReporter(gates: readonly EnvGate[]) {
  return {
    onTestRunEnd(testModules: ReadonlyArray<unknown>): void {
      const skipped = countSkipped(testModules);
      const total = countAll(testModules);
      const unmet = gates.filter((gate) => missingVars(gate).length > 0);
      const met = gates.filter((gate) => missingVars(gate).length === 0);

      if (unmet.length === 0) {
        const names = met.map((g) => g.label).join(", ");
        console.log(
          `\n\x1b[32m✔ Cibles d'infra toutes exercées${names ? ` : ${names}` : ""}.\x1b[0m`,
        );
        return;
      }

      const bar = "─".repeat(72);
      const pct = total > 0 ? Math.round((skipped / total) * 100) : 0;
      const lines: string[] = [
        "",
        `\x1b[33m${bar}`,
        `⚠  COUVERTURE PARTIELLE — ${unmet.length} cible(s) n'ont PAS été testées`,
        bar + "\x1b[0m",
      ];
      for (const gate of unmet) {
        lines.push(
          `  \x1b[1m${gate.label}\x1b[0m — ${missingVars(gate).join(", ")} absente(s)`,
        );
        for (const how of gateHow(gate)) lines.push(`      ${how}`);
        lines.push("");
      }
      if (skipped > 0) {
        lines.push(
          `  \x1b[33m${skipped} test(s) sur ${total} n'ont pas été exécutés (${pct} %).\x1b[0m`,
        );
      }
      lines.push(
        "  \x1b[2mUn test skippé compte comme vert : ce succès ne dit rien de ces cibles.\x1b[0m",
      );
      lines.push(`\x1b[33m${bar}\x1b[0m`);
      console.log(lines.join("\n"));
    },
  };
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
