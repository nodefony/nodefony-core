import assert from "node:assert/strict";
import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { sql } from "drizzle-orm";
import {
  IDEMPOTENCY_ENTITY_NAME,
  registerIdempotencyEntities,
} from "../../nodefony/entity/idempotencyEntity";

/**
 * Une colonne à valeurs énumérées est-elle VRAIMENT bornée en base ?
 *
 * L'union `"if" | "done"` vivait sur le seul type `Row` : elle protégeait le
 * code qui passe par le store, et personne d'autre. Une commande d'exploitation,
 * un correctif appliqué à la main, un futur écrivain qui contourne la frontière
 * typée — tous pouvaient poser un troisième état, et la reprise après incident
 * l'aurait lu comme une réservation ni vivante ni terminée.
 *
 * Le contrôle porte donc sur ce que le SERVEUR refuse, pas sur ce que le type
 * interdit : on écrit par la trappe native, en contournant délibérément le
 * store, exactement comme le ferait un opérateur pressé.
 *
 * Le test vaut AVANT que la migration `0000` soit publiée : après, la contrainte
 * est gravée dans l'historique de chaque utilisateur et ne se corrige plus que
 * par une migration correctrice, publique et visible à jamais.
 */
const ORM = "test-ddl-checks";

/**
 * La contrainte a-t-elle mordu ?
 *
 * Drizzle enveloppe l'erreur du driver dans un `DrizzleError` dont le message
 * ne dit que « Failed to run the query » : le motif du refus vit dans la CAUSE.
 * Chercher le texte dans le message de surface reviendrait à ne rien vérifier —
 * ou pire, à passer au vert le jour où la requête échoue pour une autre raison.
 *
 * ⚠️ **Écrite en fonction fléchée, et pas en `function`** : `assert.rejects`
 * distingue un validateur d'une classe d'erreur sur la présence d'un
 * `prototype`. Une déclaration `function` en a un — Node tente alors un
 * `instanceof`, qui échoue toujours, et le test rougit en affichant l'erreur
 * qu'il attendait pourtant.
 */
const isCheckViolation = (error: unknown): true => {
  const chain: unknown[] = [];
  for (let cur = error; cur; cur = (cur as { cause?: unknown }).cause) {
    chain.push(cur);
    if ((cur as { code?: string }).code === "SQLITE_CONSTRAINT_CHECK") {
      return true;
    }
  }
  assert.fail(
    `attendu une violation de CHECK, obtenu : ${chain
      .map((err) => String((err as Error)?.message ?? err))
      .join(" ← ")}`,
  );
};

/** Handle natif (trappe SQL brut) — le chemin qui ignore la frontière typée. */
function nativeDb(orm: DrizzleOrm): {
  run(query: unknown): Promise<unknown>;
  all(query: unknown): Promise<Record<string, unknown>[]>;
} {
  return orm.getNativeConnection() as {
    run(query: unknown): Promise<unknown>;
    all(query: unknown): Promise<Record<string, unknown>[]>;
  };
}

describe("DDL de développement — les valeurs énumérées sont bornées en base", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    registerIdempotencyEntities(ORM, "sqlite");
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
    ormRegistry.unregister(ORM);
  });

  it("la contrainte figure dans le DDL que la base a réellement exécuté", async () => {
    const rows = await nativeDb(orm).all(
      sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'idempotency_key'`,
    );
    const ddl = String(rows[0]?.sql ?? "");
    assert.match(
      ddl,
      /CONSTRAINT "idempotency_key_state_check" CHECK \("state" IN \('if', 'done'\)\)/,
      `le CREATE TABLE stocké par SQLite doit porter la contrainte — obtenu : ${ddl}`,
    );
  });

  it("un état hors énumération est REFUSÉ, même par la trappe native", async () => {
    await assert.rejects(
      // `async` OBLIGATOIRE : better-sqlite3 est synchrone, donc `run` JETTE au
      // lieu de rendre une promesse rejetée — et `assert.rejects` laisse alors
      // passer l'erreur sans jamais appeler le validateur.
      async () =>
        nativeDb(orm).run(
          sql`INSERT INTO "idempotency_key" ("key", "fingerprint", "state", "expiresAt")
              VALUES ('k-bogus', 'fp', 'zombie', 1)`,
        ),
      isCheckViolation,
      "le serveur doit rejeter un troisième état, pas seulement le typage",
    );
  });

  it("les deux états légitimes passent (la contrainte n'est pas trop serrée)", async () => {
    const db = nativeDb(orm);
    await db.run(
      sql`INSERT INTO "idempotency_key" ("key", "fingerprint", "state", "expiresAt")
          VALUES ('k-if', 'fp', 'if', 1)`,
    );
    await db.run(
      sql`INSERT INTO "idempotency_key" ("key", "fingerprint", "state", "expiresAt")
          VALUES ('k-done', 'fp', 'done', 1)`,
    );
    const rows = await db.all(
      sql`SELECT "state" FROM "idempotency_key" ORDER BY "key"`,
    );
    assert.deepEqual(
      rows.map((row) => row.state),
      ["done", "if"],
    );
  });

  it("une transition d'état vers une valeur inconnue est refusée aussi", async () => {
    await assert.rejects(
      async () =>
        nativeDb(orm).run(
          sql`UPDATE "idempotency_key" SET "state" = 'zombie' WHERE "key" = 'k-if'`,
        ),
      isCheckViolation,
      "un CHECK borne l'UPDATE autant que l'INSERT",
    );
  });
});
