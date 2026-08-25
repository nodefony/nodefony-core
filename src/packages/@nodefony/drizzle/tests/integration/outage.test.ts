import assert from "node:assert/strict";
import { ormRegistry, connectionMonitor } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * **Traduction du cycle de vie des drivers SQL en signaux `orm-core`.**
 *
 * Le contrat lui-même est prouvé sans driver (`@nodefony/orm-core`,
 * `ormResilience.test.ts`). Ce qui se prouve ICI, et nulle part ailleurs, c'est
 * que l'adapter écoute les BONS événements du VRAI pool — un contrat honoré en
 * théorie par une classe de base ne dit rien de ce que `pg` émet réellement.
 *
 * Les coupures sont provoquées à la source (`pool.emit("error")` reproduit
 * exactement `pg-pool/index.js:62`, la ligne qui s'exécute quand un client
 * inactif tombe) : le comportement est donc déterministe et ne demande ni
 * Docker ni droits d'administration. La coupure RÉELLE, elle, se joue au banc
 * `NF_RUN_DB_OUTAGE=1` — les deux sont complémentaires, pas redondants.
 *
 * GATE : `NF_PG_URL` / `NF_MYSQL_URL` (sinon skip).
 */

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!PG_URL)("DrizzleOrm — coupure PostgreSQL (pool `pg`)", () => {
  const ORM = "outage_pg";
  let orm: DrizzleOrm;

  beforeEach(async () => {
    ormRegistry.unregister(ORM);
    orm = new DrizzleOrm(ORM, {
      dialect: "postgres",
      url: PG_URL as string,
    });
    await orm.connect();
  });
  afterEach(async () => {
    await orm.disconnect().catch(() => undefined);
    ormRegistry.unregister(ORM);
  });

  it("un BOOT n'est pas une reprise (pas de reconnexion fantôme)", () => {
    // Le câblage est posé AVANT le premier `SELECT 1`, et ce premier client
    // fait émettre `connect` puis `acquire` à `pg`. Tant que l'idempotence
    // reposait sur le seul `alive` — encore faux pendant l'établissement —
    // chaque démarrage inscrivait une reconnexion et annonçait un
    // rétablissement AVANT même la mise en service.
    const snap = connectionMonitor.snapshot(ORM);
    assert.equal(snap.reconnectCount, 0, "aucune reprise au démarrage");
    assert.equal(snap.lostCount, 0, "aucune perte au démarrage");
  });

  it("🔴 une erreur du pool NE TUE PAS le process — elle a un auditeur", () => {
    const pool = orm.getNativeConnection<{
      $client: {
        emit: (e: string, ...a: unknown[]) => boolean;
        listenerCount: (e: string) => number;
      };
    }>().$client;
    // Sans auditeur, `EventEmitter.emit("error")` LÈVE : le pod tombait pour un
    // serveur PostgreSQL redémarré. C'est la raison d'être de ce câblage.
    assert.ok(
      pool.listenerCount("error") > 0,
      "le pool pg doit avoir au moins un auditeur d'erreur",
    );
    assert.doesNotThrow(() => {
      pool.emit("error", new Error("Connection terminated unexpectedly"), null);
    });
  });

  it("la coupure bascule `isConnected()` et compte l'incident", () => {
    const pool = orm.getNativeConnection<{
      $client: { emit: (e: string, ...a: unknown[]) => boolean };
    }>().$client;
    const avant = connectionMonitor.snapshot(ORM).lostCount;
    assert.equal(orm.isConnected(), true);

    pool.emit("error", new Error("terminating connection"), null);

    assert.equal(orm.isConnected(), false, "la santé ORM doit voir la coupure");
    assert.equal(connectionMonitor.snapshot(ORM).lostCount, avant + 1);
  });

  it("le retour d'un client rétablit l'état (pg ne reconnecte pas, il rouvre)", async () => {
    const reprisesAvant = connectionMonitor.snapshot(ORM).reconnectCount;
    const pool = orm.getNativeConnection<{
      $client: { emit: (e: string, ...a: unknown[]) => boolean };
    }>().$client;
    pool.emit("error", new Error("terminating connection"), null);
    assert.equal(orm.isConnected(), false);

    // Une acquisition réussie crée un client neuf → `connect` → reprise.
    await orm
      .getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>()
      .$client.query("SELECT 1");

    assert.equal(orm.isConnected(), true);
    assert.equal(
      connectionMonitor.snapshot(ORM).reconnectCount - reprisesAvant,
      1,
      "exactement UNE reprise — un >= laissait passer la reconnexion fantôme du boot",
    );
  });

  it("après `disconnect()`, nos auditeurs sont partis — mais l'erreur reste absorbée", async () => {
    const pool = orm.getNativeConnection<{
      $client: {
        listenerCount: (e: string) => number;
        emit: (e: string, ...a: unknown[]) => boolean;
      };
    }>().$client;
    const pertesAvant = connectionMonitor.snapshot(ORM).lostCount;

    await orm.disconnect();

    // Nos traducteurs de cycle de vie sont retirés : un cycle
    // connect/disconnect répété empilerait sinon un jeu par tour.
    assert.equal(pool.listenerCount("connect"), 0);
    assert.equal(pool.listenerCount("acquire"), 0);
    // Mais `error` garde un PUITS, et ce n'est pas un oubli : drainer un pool
    // en fait émettre, et un `EventEmitter` qui émet `error` sans le moindre
    // auditeur fait tomber le process. Détacher « proprement » juste avant de
    // fermer rouvrirait exactement le défaut que ce câblage existe pour clore.
    assert.ok(
      pool.listenerCount("error") > 0,
      "la fenêtre de fermeture doit rester couverte",
    );
    assert.doesNotThrow(() => {
      pool.emit("error", new Error("écho tardif du drainage"), null);
    });
    // …et ce qui est absorbé ne doit RIEN inscrire : un arrêt volontaire n'est
    // pas un incident.
    assert.equal(
      connectionMonitor.snapshot(ORM).lostCount,
      pertesAvant,
      "fermer proprement ne compte aucune perte",
    );
  });
});

describe.skipIf(!MYSQL_URL)(
  "DrizzleOrm — coupure MySQL (pool `mysql2`)",
  () => {
    const ORM = "outage_mysql";
    let orm: DrizzleOrm;

    beforeEach(async () => {
      ormRegistry.unregister(ORM);
      orm = new DrizzleOrm(ORM, {
        dialect: "mysql",
        url: MYSQL_URL as string,
      });
      await orm.connect();
    });
    afterEach(async () => {
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
    });

    it("l'erreur d'une CONNEXION du pool bascule l'état", async () => {
      const pool = orm.getNativeConnection<{
        $client: {
          getConnection: () => Promise<{
            connection: { emit: (e: string, x: Error) => boolean };
            release: () => void;
          }>;
        };
      }>().$client;
      const avant = connectionMonitor.snapshot(ORM).lostCount;
      assert.equal(orm.isConnected(), true);

      // `mysql2` n'émet rien sur le Pool : ce sont les `PoolConnection` qui
      // portent l'erreur — d'où l'abonnement par connexion créée.
      const cx = await pool.getConnection();
      cx.connection.emit("error", new Error("PROTOCOL_CONNECTION_LOST"));

      assert.equal(orm.isConnected(), false);
      assert.equal(connectionMonitor.snapshot(ORM).lostCount, avant + 1);
    });
  },
);
