// Décor SQLite des camps témoins du banc ORM — `express-fair-sqlite` et
// `nest-fair-sqlite` (#507). UNE implémentation : deux copies de la lecture, de
// l'écriture ou de la garde d'identité divergeraient, et l'écart publié entre
// Express et NestJS mesurerait leur divergence au lieu des deux frameworks.
//
// Le POURQUOI de chaque exigence (même pilote, schéma importé, RETURNING,
// UPDATE plutôt qu'INSERT, base séparée, pilote synchrone) est écrit en tête
// d'`express-fair-sqlite.mjs`, le camp d'origine.
//
// ⚖️ L'ORM et le pilote viennent de la PASSERELLE, jamais d'un spécificateur nu
// écrit ici : ce dossier a son propre `node_modules`, un `import "drizzle-orm"`
// y atteindrait une SECONDE instance de drizzle, distincte de celle dont vient
// le schéma. Le pourquoi et le coût mesuré sont dans `../repo-drizzle-sqlite.mjs`.
import {
  drizzle,
  eq,
  Database,
  Column,
  getTableColumns,
} from "../repo-drizzle-sqlite.mjs";

const DB_FILE = process.env.NF_BENCH_SQLITE_DB;
if (!DB_FILE) {
  console.error(
    "❌ NF_BENCH_SQLITE_DB manquant — ce banc REFUSE de créer une base vide :\n" +
      "   une table vide répond plus vite qu'une table peuplée, et le chiffre\n" +
      "   aurait l'air d'un résultat. Passer la copie seedée du banc.",
  );
  process.exit(2);
}
export { DB_FILE };

// Le schéma vient du module test COMPILÉ — même définition que celle que
// Nodefony exécute. Le recopier ici ferait diverger les camps au premier
// changement de colonne, sans que rien ne le signale.
const { llx_facture } = await import(
  new URL(
    "../../../../src/modules/test/dist/nodefony/entity/dolibarr/llx_facture.js",
    import.meta.url,
  ).href
);

// ⚖️ GARDE D'ÉQUITÉ — UNE SEULE instance de drizzle dans ce process.
//
// Elle ne contrôle pas une version (la garde « installé == déclaré » de
// `bench.sh` le fait déjà) mais une IDENTITÉ : les colonnes du schéma sont-elles
// des instances de la classe `Column` que ce camp exécute ? Si non, deux copies
// de drizzle coexistent, `is()` perd son chemin rapide sur chacun des ~4 660
// tests de type d'une requête, et le camp mesure une résolution de modules au
// lieu d'un ORM. C'est le défaut qui a fait publier +46 % en notre faveur (#402).
{
  const column = Object.values(getTableColumns(llx_facture))[0];
  if (!(column instanceof Column)) {
    console.error(
      "❌ ÉQUITÉ ROMPUE — deux instances de drizzle-orm dans ce process.\n" +
        `   Les colonnes du schéma (${column?.constructor?.name}) ne sont pas des\n` +
        "   instances de la classe Column que ce camp exécute. `is()` retombe alors\n" +
        "   sur la remontée de prototypes : ×7,6 sur ~4 660 appels par requête,\n" +
        "   soit ~0,5 ms/req imputés à tort au framework.\n" +
        "   → importer l'ORM depuis `../repo-drizzle-sqlite.mjs`, jamais par un\n" +
        "     spécificateur nu écrit dans `bench-frameworks/`.",
    );
    process.exit(2);
  }
}

const sqlite = new Database(DB_FILE);
// ⚖️ MÊMES RÉGLAGES DE CONNEXION que Nodefony (`DrizzleOrm.ts`, ouverture d'un
// fichier) : WAL, `synchronous = NORMAL`, clés étrangères. Le mode WAL vit dans
// le fichier, mais `synchronous` et `foreign_keys` vivent sur la CONNEXION.
// Le camp les recevait déjà — par les défauts de compilation de
// `better-sqlite3` (constaté : 1 et 1) —, donc par hasard : un pilote qui
// change ses défauts ferait fsync le camp témoin à chaque écriture, et l'écart
// publié serait celui d'un réglage. Posés ici, puis RELUS : la garde porte sur
// l'état effectif, pas sur l'intention.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
{
  const got = {
    journal_mode: sqlite.pragma("journal_mode", { simple: true }),
    synchronous: sqlite.pragma("synchronous", { simple: true }),
    foreign_keys: sqlite.pragma("foreign_keys", { simple: true }),
  };
  if (
    got.journal_mode !== "wal" ||
    got.synchronous !== 1 ||
    got.foreign_keys !== 1
  ) {
    console.error(
      `❌ DÉCOR SQLite différent de Nodefony : ${JSON.stringify(got)} ` +
        "(attendu wal / 1 / 1) — la mesure comparerait deux réglages.",
    );
    process.exit(2);
  }
}
const db = drizzle(sqlite);
const BENCH_READ_USER = 7;

// La LECTURE est préparée (cache de forme côté Nodefony, `.prepare()` ici) ;
// l'ÉCRITURE ne l'est d'aucun côté — `updateOne` construit sa requête à chaque
// appel (`DrizzleRepository.ts`). Aligner l'un sans l'autre fabriquerait un
// écart qui n'appartient à aucun des frameworks.
const read = db
  .select()
  .from(llx_facture)
  .where(eq(llx_facture.fk_user_author, BENCH_READ_USER))
  .limit(20)
  .prepare();

let writeSeq = 0;

/** Les 20 lignes du lecteur du banc. */
export function readRows() {
  return read.all();
}

/**
 * Le cas APPLICATIF : 20 lignes lues, puis l'UPDATE … RETURNING de la ligne lue.
 * `.returning()` n'est pas un détail d'API : le repository de Nodefony rend la
 * ligne persistée, et un camp qui l'ignore travaillerait moins.
 *
 * @param ht - base du total HT écrit
 * @param ttc - base du total TTC écrit
 * @returns le corps rendu par les trois camps
 */
export function readWrite(ht, ttc) {
  const rows = read.all();
  const seq = ++writeSeq;
  const target = rows[0];
  const maj = target?.rowid
    ? db
        .update(llx_facture)
        .set({ total_ht: ht + (seq % 100), total_ttc: ttc + (seq % 100) })
        .where(eq(llx_facture.rowid, target.rowid))
        .returning()
        .get()
    : null;
  return { lus: rows.length, seq, maj: maj ? 1 : 0 };
}

/**
 * Règles du POST validé, écrites à la main — miroir de `validateInvoice` de
 * `BenchOrmController` et des décorateurs `class-validator` de
 * `nest-fair-sqlite` : mêmes règles, mêmes messages (`fair-parity` les compare).
 *
 * @param body - corps JSON reçu
 * @returns les violations, vide si le corps est valide
 */
export function validateInvoice(body) {
  const errors = [];
  const b = typeof body === "object" && body !== null ? body : {};
  const { total_ht: ht, total_ttc: ttc, ref } = b;
  const htOk = typeof ht === "number" && Number.isFinite(ht);
  if (!htOk)
    errors.push(
      "total_ht must be a number conforming to the specified constraints",
    );
  if (!(typeof ht === "number" && ht >= 0))
    errors.push("total_ht must not be less than 0");
  if (!(typeof ttc === "number" && Number.isFinite(ttc)))
    errors.push(
      "total_ttc must be a number conforming to the specified constraints",
    );
  if (!(typeof ttc === "number" && htOk && ttc >= ht))
    errors.push("total_ttc must be greater than or equal to total_ht");
  if (ref !== undefined && ref !== null) {
    if (typeof ref !== "string") errors.push("ref must be a string");
    if (!(typeof ref === "string" && ref.length <= 30))
      errors.push("ref must be shorter than or equal to 30 characters");
  }
  return errors;
}

/** Corps d'erreur commun — la forme que rend le `ValidationPipe` de NestJS. */
export function unprocessable(message) {
  return { message, error: "Unprocessable Entity", statusCode: 422 };
}

/** Chemins des routes du banc ORM, identiques à `BenchOrmController`. */
export const ORM_PATHS = {
  read: "/nodefony/test/bench-orm/read",
  readLean: "/nodefony/test/bench-orm/read-lean",
  readWrite: "/nodefony/test/bench-orm/read-write",
  readWriteBody: "/nodefony/test/bench-orm/read-write-body",
  readWriteValid: "/nodefony/test/bench-orm/read-write-valid",
};
