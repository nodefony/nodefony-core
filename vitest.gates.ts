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

/** Une cible d'infra dont l'exécution dépend de variables d'environnement. */
export interface EnvGate {
  /** Nom lisible de la cible (ex. `"PostgreSQL"`). */
  label: string;
  /** Variables requises — **toutes** doivent être présentes et non vides. */
  env: readonly string[];
  /** Comment l'activer : lignes de commande copiables telles quelles. */
  how: readonly string[];
}

/** Identifiants du `docker/docker-compose.yml` (dev), repris dans les exemples. */
const DEV_PASSWORD = "nodefony-dev";
const COMPOSE = "docker compose -f docker/docker-compose.yml";

export const PG_GATE: EnvGate = {
  label: "PostgreSQL",
  env: ["NF_PG_URL"],
  how: [
    `${COMPOSE} --profile postgres up -d postgres`,
    `NF_PG_URL=postgres://nodefony:${DEV_PASSWORD}@127.0.0.1:5432/nodefony npm test`,
  ],
};

export const MYSQL_GATE: EnvGate = {
  label: "MySQL / MariaDB",
  env: ["NF_MYSQL_URL"],
  how: [
    `${COMPOSE} --profile mariadb up -d mariadb    # ou --profile mysql (port 3307)`,
    `NF_MYSQL_URL=mysql://nodefony:${DEV_PASSWORD}@127.0.0.1:3306/nodefony npm test`,
  ],
};

/**
 * Redis exige **deux** variables : `REDIS_URL` (bancs de pagination) et
 * `REDIS_TEST_URL` (banc comportemental, sur un index dédié pour ne pas polluer
 * la base de travail). Les deux portent le mot de passe — le serveur du compose
 * tourne en `requirepass`, et sans lui la connexion échoue en `NOAUTH`.
 */
export const REDIS_GATE: EnvGate = {
  label: "Redis (serveur réel)",
  env: ["REDIS_URL", "REDIS_TEST_URL"],
  how: [
    `${COMPOSE} up -d redis`,
    `REDIS_URL=redis://:${DEV_PASSWORD}@127.0.0.1:6379 \\`,
    `REDIS_TEST_URL=redis://:${DEV_PASSWORD}@127.0.0.1:6379/15 npm test`,
  ],
};

/** Les variables manquantes (ou vides) d'une gate ; `[]` = gate satisfaite. */
function missingVars(gate: EnvGate): string[] {
  return gate.env.filter((name) => {
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
        for (const how of gate.how) lines.push(`      ${how}`);
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
