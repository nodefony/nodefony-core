import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ormRegistry, connectionMonitor } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * **Coupure RÉELLE d'un serveur SQL** — le serveur est arrêté, puis relancé,
 * pendant que l'ORM est connecté.
 *
 * Pourquoi ce banc existe alors qu'`outage.test.ts` couvre déjà la traduction :
 * ce dernier ÉMET l'événement du driver, donc il prouve le câblage en supposant
 * que le driver émettra. Seul l'arrêt d'un vrai serveur prouve qu'il émet
 * VRAIMENT, et ce qu'il émet. C'est ce banc qui a montré qu'un `docker stop`
 * sur PostgreSQL tuait le process Node — un défaut qu'aucun test « propre »
 * n'exposait, parce que les suites ferment toujours leurs connexions
 * proprement et qu'un client ne tombe jamais pendant qu'il est INACTIF.
 *
 * GATE : `NF_RUN_DB_OUTAGE=1` **et** `NF_DB_OUTAGE_PG_CONTAINER` (le nom du
 * conteneur à couper). Fermé par défaut : il arrête une infra partagée, ce
 * qu'une suite ordinaire n'a pas le droit de faire.
 */

const ON = process.env.NF_RUN_DB_OUTAGE === "1";
const PG_URL = process.env.NF_PG_URL;
const PG_BOX = process.env.NF_DB_OUTAGE_PG_CONTAINER;
const MYSQL_URL = process.env.NF_MYSQL_URL;
const MYSQL_BOX = process.env.NF_DB_OUTAGE_MYSQL_CONTAINER;

const docker = (...args: string[]): void => {
  execFileSync("docker", args, { encoding: "utf8" });
};
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Attend une condition, ou rend `false` au bout de `maxMs`. */
async function until(
  check: () => boolean | Promise<boolean>,
  maxMs: number,
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await check()) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

describe.skipIf(!ON || !PG_URL || !PG_BOX)(
  "DrizzleOrm — coupure RÉELLE de PostgreSQL",
  () => {
    const ORM = "outage_real_pg";
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
      try {
        docker("start", PG_BOX as string);
      } catch {
        /* déjà démarré */
      }
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
    });

    it("le serveur tombe : le process SURVIT, l'état bascule, la reprise est automatique", async () => {
      const client = orm.getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>().$client;
      await client.query("SELECT 1");
      const pertes = connectionMonitor.snapshot(ORM).lostCount;

      docker("stop", PG_BOX as string);

      // 🔴 Le seul fait d'arriver à la ligne suivante est déjà un résultat :
      // avant le câblage du pool, `pool.emit("error")` sans auditeur faisait
      // tomber tout le process ici même.
      const vuTomber = await until(() => !orm.isConnected(), 15_000);
      assert.ok(
        vuTomber,
        "la coupure doit être CONSTATÉE, pas subie en silence",
      );
      assert.equal(connectionMonitor.snapshot(ORM).lostCount, pertes + 1);

      await assert.rejects(
        client.query("SELECT 1"),
        "une requête pendant la coupure doit échouer, jamais rendre un faux résultat",
      );

      docker("start", PG_BOX as string);

      const revenu = await until(async () => {
        try {
          await client.query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      }, 60_000);
      assert.ok(revenu, "le pool doit rouvrir une connexion tout seul");
      assert.equal(orm.isConnected(), true, "l'état doit repartir vert");
      assert.ok(connectionMonitor.snapshot(ORM).reconnectCount >= 1);
    }, 120_000);
  },
);

describe.skipIf(!ON || !MYSQL_URL || !MYSQL_BOX)(
  "DrizzleOrm — coupure RÉELLE de MySQL",
  () => {
    const ORM = "outage_real_mysql";
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
      try {
        docker("start", MYSQL_BOX as string);
      } catch {
        /* déjà démarré */
      }
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
    });

    it("le serveur tombe : l'état bascule et la reprise est automatique", async () => {
      const client = orm.getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>().$client;
      await client.query("SELECT 1");

      docker("stop", MYSQL_BOX as string);
      await assert.rejects(client.query("SELECT 1"));
      assert.ok(
        await until(() => !orm.isConnected(), 15_000),
        "la coupure doit être CONSTATÉE",
      );

      docker("start", MYSQL_BOX as string);
      const revenu = await until(async () => {
        try {
          await client.query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      }, 60_000);
      assert.ok(revenu, "le pool doit rouvrir une connexion tout seul");
      assert.equal(orm.isConnected(), true);
    }, 120_000);
  },
);
