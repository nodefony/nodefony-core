import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleIdempotencyStore } from "../../nodefony/src/DrizzleIdempotencyStore";
import {
  registerIdempotencyEntities,
  createIdempotencyTable,
  IDEMPOTENCY_ENTITY_NAME,
} from "../../nodefony/entity/idempotencyEntity";
import type { DrizzleDb } from "../../nodefony/src/orm-core/DrizzleRepository";

/**
 * e2e **MySQL/MariaDB** du store d'idempotence (S4 multi-dialecte) — LE point
 * dur du lot : ni `RETURNING` ni `WHERE` sur l'`ON DUPLICATE KEY UPDATE`, et
 * un `affectedRows` d'ODKU ambigu sous mysql2 (`CLIENT_FOUND_ROWS`) — la
 * réservation atomique de `begin` est reconstruite en `INSERT IGNORE` + vol
 * par `UPDATE … WHERE expiré` (queryKit `reserveIdempotencyKeyMysql`). Cette suite
 * prouve la MÊME sémantique que sqlite (12 tests) et pg (e2e cross-pod) :
 * verdicts, vol d'expiré, empreinte préservée post-complétion, gc — PLUS la
 * **concurrence réelle 2 pods** (2 pools distincts) : à chaque round, EXACTEMENT
 * un `fresh` (l'invariant anti double-effet).
 *
 * GATE : `NF_MYSQL_URL` (sinon skip) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */

const MYSQL_URL = process.env.NF_MYSQL_URL;
const ORM_A = "idem_mysql_e2e_a";
const ORM_B = "idem_mysql_e2e_b";

let CLOCK = 1_000_000;
const now = () => CLOCK;
const LEASE_MS = 1_000;
const TTL_MS = 5_000;

/** Store branché sur un ORM donné (résolution lazy, horloge injectée). */
function makeStore(orm: DrizzleOrm): DrizzleIdempotencyStore {
  return new DrizzleIdempotencyStore(
    () => (orm.isConnected() ? orm.getNativeConnection<DrizzleDb>() : null),
    now,
    LEASE_MS,
    TTL_MS,
    createIdempotencyTable("mysql"),
  );
}

describe.skipIf(!MYSQL_URL)(
  "DrizzleIdempotencyStore — e2e MySQL (S4 multi-dialecte)",
  () => {
    let ormA: DrizzleOrm;
    let ormB: DrizzleOrm;
    let podA: DrizzleIdempotencyStore;
    let podB: DrizzleIdempotencyStore;

    beforeAll(async () => {
      CLOCK = 1_000_000;
      // Deux « pods » = deux pools mysql2 DISTINCTS sur la même base.
      registerIdempotencyEntities(ORM_A, "mysql");
      registerIdempotencyEntities(ORM_B, "mysql");
      ormA = new DrizzleOrm(ORM_A, { dialect: "mysql", url: MYSQL_URL });
      ormB = new DrizzleOrm(ORM_B, { dialect: "mysql", url: MYSQL_URL });
      await ormA.connect();
      await ormB.connect();
      podA = makeStore(ormA);
      podB = makeStore(ormB);
      await ormA.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
    });

    afterAll(async () => {
      await ormA.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
      await ormA.disconnect();
      await ormB.disconnect();
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM_A);
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM_B);
      ormRegistry.unregister(ORM_A);
      ormRegistry.unregister(ORM_B);
    });

    it("verdicts de base : fresh → in-flight (même empreinte) → mismatch (autre empreinte)", async () => {
      assert.deepEqual(await podA.begin("k1", "fp-1"), { state: "fresh" });
      assert.deepEqual(await podA.begin("k1", "fp-1"), { state: "in-flight" });
      assert.deepEqual(await podA.begin("k1", "fp-OTHER"), {
        state: "mismatch",
      });
    });

    it("complete → replayed avec la réponse mémorisée ; empreinte PRÉSERVÉE (mismatch post-complétion)", async () => {
      await podA.begin("k2", "fp-2");
      await podA.complete("k2", { status: 201, body: { id: "res-42" } });
      const replay = await podA.begin("k2", "fp-2");
      assert.equal(replay.state, "replayed");
      assert.deepEqual(
        (replay as { response?: unknown }).response,
        { status: 201, body: { id: "res-42" } },
        "réponse JSON round-trip mysql",
      );
      assert.deepEqual(
        await podA.begin("k2", "fp-OTHER"),
        { state: "mismatch" },
        "le fingerprint survit à complete (draft §2.7)",
      );
    });

    it("abort libère la clé : le begin suivant est fresh", async () => {
      await podA.begin("k3", "fp-3");
      await podA.abort("k3");
      assert.deepEqual(await podA.begin("k3", "fp-3b"), { state: "fresh" });
    });

    it("vol d'une entrée MORTE : bail expiré → begin re-réserve atomiquement (UPDATE conditionnel)", async () => {
      await podA.begin("k4", "fp-4");
      CLOCK += LEASE_MS + 1; // le bail in-flight expire
      assert.deepEqual(
        await podB.begin("k4", "fp-4-new"),
        { state: "fresh" },
        "l'AUTRE pod vole l'entrée morte via le DO UPDATE conditionnel",
      );
      // La clé volée est bien VIVANTE pour son nouveau propriétaire :
      assert.deepEqual(await podA.begin("k4", "fp-4-new"), {
        state: "in-flight",
      });
    });

    it("concurrence 2 pods × 10 rounds : EXACTEMENT 1 fresh par round (anti double-effet)", async () => {
      for (let round = 0; round < 10; round++) {
        const key = `race-${round}`;
        const outcomes = await Promise.all([
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
        ]);
        const fresh = outcomes.filter((o) => o.state === "fresh").length;
        const contended = outcomes.filter(
          (o) => o.state === "in-flight",
        ).length;
        assert.equal(fresh, 1, `round ${round}: un seul fresh`);
        assert.equal(contended, 5, `round ${round}: le reste en contention`);
      }
    });

    it("gc : purge les entrées mortes avec compteur affectedRows réel", async () => {
      CLOCK += TTL_MS + LEASE_MS + 1; // tout expire
      const purged = await podA.gc();
      assert.ok(
        purged >= 10,
        `gc compte les lignes purgées (affectedRows) — reçu ${purged}`,
      );
      assert.equal(
        await ormA.getRepository(IDEMPOTENCY_ENTITY_NAME).count(),
        0,
      );
    });
  },
);
