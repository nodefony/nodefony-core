/**
 * Mise en WAL d'une base SQLite — UNE implémentation, appelée par les deux
 * ouvreurs de fichier du paquet : l'adapter ORM (`DrizzleOrm`) et le pilote de
 * migration (`sqliteDriver`). Une base migrée puis ouverte par l'application ne
 * doit pas changer de mode en route, et les deux doivent survivre à la même
 * concurrence.
 */

/** Ce que la mise en WAL lit d'une connexion `better-sqlite3`. */
export interface ISqlitePragmaClient {
  pragma(source: string, options?: { simple?: boolean }): unknown;
}

/** Réglages de la mise en WAL — injectables pour l'éprouver sans attendre. */
export interface IWriteAheadLogOptions {
  /** Durée maximale des réessais, en millisecondes. */
  deadlineMs?: number;
  /** Attente entre deux essais. */
  sleep?: (ms: number) => Promise<void>;
  /** Horloge (millisecondes). */
  now?: () => number;
}

/** Échéance par défaut : au-delà, une base occupée l'est pour de bon. */
export const WAL_DEADLINE_MS = 10_000;

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * L'erreur est-elle un conflit de verrou, qui se règle en réessayant ?
 *
 * @param e - erreur levée par `better-sqlite3`
 * @returns vrai pour `SQLITE_BUSY*` et `SQLITE_LOCKED*`
 */
export function isSqliteBusy(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
  );
}

/**
 * Passe la base en WAL (`synchronous = NORMAL`), en tolérant les ouvertures
 * CONCURRENTES d'une base neuve.
 *
 * Basculer en WAL exige un verrou exclusif. Deux processus qui ouvrent la même
 * base neuve au même instant — l'application et `orm:migrate` lancé par
 * `docker exec`, ou les workers de `nodefony cluster` — tiennent chacun un
 * verrou partagé et veulent l'exclusif : SQLite tranche l'impasse par un
 * `SQLITE_BUSY` IMMÉDIAT, sans passer par l'attente (`timeout`) de la
 * connexion. Mesuré : 23 ouvertures sur 40 échouaient avec trois processus
 * synchronisés, et la forge a vu un `orm:migrate` refusé au démarrage.
 *
 * Le mode WAL est PERSISTANT (écrit dans le fichier) : on le lit d'abord, et
 * seul le premier ouvreur bascule. Un conflit se réessaie, à délai croissant,
 * jusqu'à {@link WAL_DEADLINE_MS} ; toute autre erreur remonte telle quelle.
 *
 * @param db - connexion ouverte sur un FICHIER (sans objet sur `:memory:`)
 * @param options - échéance, attente et horloge (injectées en test)
 * @throws La dernière erreur `SQLITE_BUSY` si l'échéance est dépassée, ou
 *   toute autre erreur au premier essai
 */
export async function enableWriteAheadLog(
  db: ISqlitePragmaClient,
  options: IWriteAheadLogOptions = {},
): Promise<void> {
  const deadlineMs = options.deadlineMs ?? WAL_DEADLINE_MS;
  const sleep = options.sleep ?? sleepFor;
  const now = options.now ?? Date.now;
  const start = now();
  for (let attempt = 1; ; attempt++) {
    try {
      if (db.pragma("journal_mode", { simple: true }) !== "wal") {
        const mode = db.pragma("journal_mode = WAL", { simple: true });
        // Un refus peut aussi se dire par le mode RENDU, sans erreur.
        if (mode !== "wal") {
          throw Object.assign(
            new Error(`journal_mode resté « ${String(mode)} »`),
            {
              code: "SQLITE_BUSY",
            },
          );
        }
      }
      db.pragma("synchronous = NORMAL");
      return;
    } catch (e) {
      if (!isSqliteBusy(e) || now() - start >= deadlineMs) throw e;
      await sleep(Math.min(20 * attempt, 250));
    }
  }
}
