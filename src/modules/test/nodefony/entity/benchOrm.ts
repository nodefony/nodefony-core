// Décor du banc ORM (opt-in `NF_BENCH_ORM=1`) — entités du corpus Dolibarr sur le
// connector `default` + seed déterministe. Chaîne FK exercée :
// llx_facture.fk_user_author → llx_user, fk_soc → llx_societe.
//
// ⚠️ Le corpus `entity/dolibarr/` est GITIGNORÉ (généré localement — schéma issu
// de Dolibarr GPLv3, jamais versionné ici). Ce fichier est versionné, lui : il
// charge le corpus DYNAMIQUEMENT au runtime (URL construite → hors du graphe
// statique rolldown/tsgo). Sur un clone sans corpus : build et boot normaux ;
// seul `NF_BENCH_ORM=1` échoue, fail-loud, avec la marche à suivre.
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";

export const BENCH_ORM_CONNECTOR = "default";
export const BENCH_ORM_USERS = 50;
export const BENCH_ORM_SOCIETES = 200;
export const BENCH_ORM_FACTURES = 10_000;

/**
 * User ciblé par la route de lecture du banc : ~200 factures seedées portent
 * `fk_user_author = 7` (répartition modulo) — le SELECT filtré rend toujours
 * des lignes, jamais un résultat vide (un banc qui lit du vide mesure l'échec).
 */
export const BENCH_READ_USER = 7;

/** Les trois tables Drizzle du banc (schémas opaques ici — portés par le corpus). */
interface IBenchCorpus {
  llx_user: unknown;
  llx_societe: unknown;
  llx_facture: unknown;
}

/**
 * Sous-ensemble structurel du db Drizzle natif (`getNativeConnection`) utilisé
 * par le seed — évite toute dépendance de type sur `drizzle-orm` (qui n'est pas
 * une dépendance déclarée de ce module, le corpus vit hors du repo).
 */
interface INativeSqliteDb {
  insert(table: unknown): {
    values(rows: Record<string, unknown>[]): PromiseLike<unknown> & {
      onConflictDoNothing(): PromiseLike<unknown>;
    };
  };
}

let corpus: IBenchCorpus | null = null;

/** Charge le corpus Dolibarr local (dist voisin) — fail-loud s'il n'existe pas. */
async function loadCorpus(): Promise<IBenchCorpus> {
  if (corpus) {
    return corpus;
  }
  const base = new URL("./dolibarr/", import.meta.url).href;
  try {
    const [u, s, f] = await Promise.all([
      import(/* @vite-ignore */ `${base}llx_user.js`),
      import(/* @vite-ignore */ `${base}llx_societe.js`),
      import(/* @vite-ignore */ `${base}llx_facture.js`),
    ]);
    corpus = {
      llx_user: u.llx_user,
      llx_societe: s.llx_societe,
      llx_facture: f.llx_facture,
    };
    return corpus;
  } catch (e) {
    throw new Error(
      "bench-orm : corpus dolibarr introuvable (dossier gitignoré, généré " +
        "localement — jamais dans un clone frais). NF_BENCH_ORM=1 exige une " +
        "machine qui porte le corpus + un build local du module test.",
      { cause: e },
    );
  }
}

/**
 * Enregistre les entités du banc dans le `entityRegistry` (connector `default`).
 * À appeler à `onKernelRegister` — AVANT le `connect()` du DrizzleService
 * (hook `onBoot`), qui matérialise les tables des entités enregistrées.
 */
export async function registerBenchOrmEntities(): Promise<void> {
  const tables = await loadCorpus();
  for (const name of ["llx_user", "llx_societe", "llx_facture"] as const) {
    entityRegistry.register({
      connector: BENCH_ORM_CONNECTOR,
      module: "test",
      name,
      schema: tables[name],
    });
  }
}

/**
 * Seed déterministe du décor (idempotent : ne fait rien si le volume est déjà
 * présent). Insertion par batchs via le db Drizzle natif — 10 000 `create()`
 * unitaires hors transaction paieraient un fsync chacun.
 *
 * @param log - relais vers le logger du module appelant.
 */
export async function seedBenchOrm(log: (msg: string) => void): Promise<void> {
  const tables = await loadCorpus();
  const orm = ormRegistry.get(BENCH_ORM_CONNECTOR);
  const factures = orm?.getRepository<Record<string, unknown>>("llx_facture");
  if (!orm || !factures) {
    throw new Error("bench-orm : ORM default ou repository llx_facture absent");
  }
  const present = await factures.count();
  if (present >= BENCH_ORM_FACTURES) {
    log(`bench-orm : seed déjà en place (${present} factures)`);
    return;
  }
  const db = orm.getNativeConnection<INativeSqliteDb>();

  const users = Array.from({ length: BENCH_ORM_USERS }, (_, i) => ({
    rowid: i + 1,
    login: `bench-user-${i + 1}`,
  }));
  const societes = Array.from({ length: BENCH_ORM_SOCIETES }, (_, i) => ({
    rowid: i + 1,
  }));
  const rows = Array.from({ length: BENCH_ORM_FACTURES - present }, (_, i) => ({
    ref: `SEED-${present + i + 1}`,
    fk_soc: ((present + i) % BENCH_ORM_SOCIETES) + 1,
    fk_user_author: ((present + i) % BENCH_ORM_USERS) + 1,
    total_ht: 100,
    total_ttc: 120,
  }));
  if (present === 0) {
    await db.insert(tables.llx_user).values(users).onConflictDoNothing();
    await db.insert(tables.llx_societe).values(societes).onConflictDoNothing();
  }
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(tables.llx_facture).values(rows.slice(i, i + BATCH));
  }
  log(
    `bench-orm : seed écrit — ${BENCH_ORM_USERS} users, ${BENCH_ORM_SOCIETES} societes, ${BENCH_ORM_FACTURES} factures`,
  );
}
