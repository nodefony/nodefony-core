// Décor du banc ORM (opt-in `NF_BENCH_ORM=1`) — tables du corpus `erp` sur un
// connecteur DÉDIÉ + seed déterministe. Chaîne FK exercée :
// llx_facture.fk_user_author → llx_user, fk_soc → llx_societe.
//
// ⚠️ Le corpus `entity/benchCorpus/` est GITIGNORÉ (licence tierce, jamais
// versionné) : il est écrit par `bench-orm-corpus.mjs` (skill
// `nodefony-devkit-bench`) depuis les descriptions NEUTRES du corpus, puis
// compilé par le build du module. Ce fichier est versionné, lui : il charge le
// corpus DYNAMIQUEMENT au runtime (URL construite → hors du graphe statique
// rolldown/tsgo). Sur un clone sans corpus : build et boot normaux ; seul
// `NF_BENCH_ORM=1` échoue, fail-loud, avec la marche à suivre.
//
// Les tables sont des descriptions du kit de colonnes : le connecteur en tire
// la table de SON dialecte.
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";

/**
 * Drapeau du décor, lu UNE fois : l'index du module (routes, entités, seed)
 * et sa config (connecteur) le partagent.
 */
export const BENCH_ORM = process.env.NF_BENCH_ORM === "1";

/**
 * Connecteur du banc, DÉDIÉ, déclaré par la config du module
 * (`config.ts`, `module-drizzle`) en `ddl: "auto"` : le banc crée lui-même
 * ses tables, quel que soit le régime de schéma de l'application (`migrate`
 * dès qu'elle versionne ses migrations, `none` en production), et le corpus
 * ne se mêle pas à la base applicative. Fichier SQLite sous
 * `var/databases/` (règle `defaultConnectorFilename`), que les camps
 * témoins copient.
 */
export const BENCH_ORM_CONNECTOR = "bench-orm";
export const BENCH_ORM_USERS = 50;
export const BENCH_ORM_SOCIETES = 200;
export const BENCH_ORM_FACTURES = 10_000;

/**
 * User ciblé par la route de lecture du banc : ~200 factures seedées portent
 * `fk_user_author = 7` (répartition modulo) — le SELECT filtré rend toujours
 * des lignes, jamais un résultat vide (un banc qui lit du vide mesure l'échec).
 */
export const BENCH_READ_USER = 7;

/** Les tables que le banc lit et écrit — le corpus porte aussi leurs cibles. */
const BENCH_TABLES = ["llx_user", "llx_societe", "llx_facture"] as const;

/**
 * Montant d'une facture sous la forme qu'attend la colonne : `total_ht` et
 * `total_ttc` sont des `decimal(24,8)`, que le kit lit et écrit en CHAÎNE
 * (exacte) — un `number` y serait refusé.
 *
 * @param value - montant.
 * @returns son écriture décimale.
 */
export function benchAmount(value: number): string {
  return String(value);
}

let corpus: ReadonlyMap<string, unknown> | null = null;

/** Charge le corpus local (dist voisin) — fail-loud s'il n'existe pas. */
async function loadCorpus(): Promise<ReadonlyMap<string, unknown>> {
  if (corpus) {
    return corpus;
  }
  const url = new URL("./benchCorpus/corpus.js", import.meta.url).href;
  let loaded: unknown;
  try {
    const mod: unknown = await import(/* @vite-ignore */ url);
    loaded =
      typeof mod === "object" && mod !== null && "BENCH_CORPUS" in mod
        ? mod.BENCH_CORPUS
        : undefined;
  } catch (e) {
    throw new Error(
      "bench-orm : corpus introuvable (dossier gitignoré, écrit localement — " +
        "jamais dans un clone frais). NF_BENCH_ORM=1 exige : node " +
        ".claude/skills/nodefony-devkit-bench/scripts/bench-orm-corpus.mjs, " +
        "puis un build du module test.",
      { cause: e },
    );
  }
  if (!(loaded instanceof Map)) {
    throw new Error(`bench-orm : ${url} n'exporte pas BENCH_CORPUS (Map)`);
  }
  const tables: ReadonlyMap<string, unknown> = loaded;
  for (const name of BENCH_TABLES) {
    if (!tables.has(name)) {
      throw new Error(`bench-orm : table ${name} absente du corpus`);
    }
  }
  corpus = tables;
  return tables;
}

/**
 * Enregistre les tables du corpus dans le `entityRegistry` (connecteur
 * {@link BENCH_ORM_CONNECTOR}). À appeler à `onKernelRegister` — AVANT le `connect()` du
 * DrizzleService (hook `onBoot`), qui matérialise les tables enregistrées.
 */
export async function registerBenchOrmEntities(): Promise<void> {
  const tables = await loadCorpus();
  for (const [name, schema] of tables) {
    entityRegistry.register({
      connector: BENCH_ORM_CONNECTOR,
      module: "test",
      name,
      schema,
    });
  }
}

/**
 * Seed déterministe du décor (idempotent : ne fait rien si le volume est déjà
 * présent). Insertion par lots via le repository (`createMany`) — même chemin
 * sur les trois dialectes ; 10 000 `create()` unitaires hors transaction
 * paieraient un fsync chacun.
 *
 * @param log - relais vers le logger du module appelant.
 */
export async function seedBenchOrm(log: (msg: string) => void): Promise<void> {
  // `get()` lève lui-même, en nommant le connecteur absent.
  const orm = ormRegistry.get(BENCH_ORM_CONNECTOR);
  const repo = (name: string) =>
    orm.getRepository<Record<string, unknown>>(name);
  const factures = repo("llx_facture");
  const present = await factures.count();
  if (present >= BENCH_ORM_FACTURES) {
    log(`bench-orm : seed déjà en place (${present} factures)`);
    return;
  }
  if ((await repo("llx_user").count()) === 0) {
    await repo("llx_user").createMany(
      Array.from({ length: BENCH_ORM_USERS }, (_, i) => ({
        rowid: i + 1,
        login: `bench-user-${i + 1}`,
      })),
    );
  }
  if ((await repo("llx_societe").count()) === 0) {
    await repo("llx_societe").createMany(
      Array.from({ length: BENCH_ORM_SOCIETES }, (_, i) => ({ rowid: i + 1 })),
    );
  }
  const rows = Array.from({ length: BENCH_ORM_FACTURES - present }, (_, i) => ({
    ref: `SEED-${present + i + 1}`,
    fk_soc: ((present + i) % BENCH_ORM_SOCIETES) + 1,
    fk_user_author: ((present + i) % BENCH_ORM_USERS) + 1,
    total_ht: benchAmount(100),
    total_ttc: benchAmount(120),
  }));
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await factures.createMany(rows.slice(i, i + BATCH));
  }
  log(
    `bench-orm : seed écrit — ${BENCH_ORM_USERS} users, ${BENCH_ORM_SOCIETES} societes, ${BENCH_ORM_FACTURES} factures`,
  );
}
