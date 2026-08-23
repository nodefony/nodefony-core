import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { ormRegistry, connectionMonitor } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

/**
 * **Coupure RÉELLE d'un serveur MongoDB** — le serveur est arrêté, puis
 * relancé, pendant que l'ORM est connecté.
 *
 * Complémentaire d'`outage.test.ts` (qui ÉMET l'événement) : seul l'arrêt d'un
 * vrai serveur prouve que Mongoose émet vraiment, et QUAND. C'est ce banc qui a
 * mesuré qu'une requête lancée pendant la coupure ne rend la main qu'au bout de
 * 30 s (`serverSelectionTimeoutMS` par défaut du driver) — un chiffre qu'aucune
 * lecture de code ne donne, et qui décide de la tenue d'une requête HTTP.
 *
 * GATE : `NF_RUN_DB_OUTAGE=1` **et** `NF_DB_OUTAGE_MONGO_CONTAINER`.
 */

const ON = process.env.NF_RUN_DB_OUTAGE === "1";
const BOX = process.env.NF_DB_OUTAGE_MONGO_CONTAINER;
const ORM = "mongo_outage_real";
const URI = mongoTestUri(ORM);

const docker = (...args: string[]): void => {
  execFileSync("docker", args, { encoding: "utf8" });
};
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

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

describe.skipIf(!ON || !URI || !BOX)(
  "MongooseOrm — coupure RÉELLE de MongoDB",
  () => {
    let orm: MongooseOrm;

    beforeEach(async () => {
      ormRegistry.unregister(ORM);
      orm = new MongooseOrm(ORM, URI as string);
      await orm.connect();
    });
    afterEach(async () => {
      try {
        docker("start", BOX as string);
      } catch {
        /* déjà démarré */
      }
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
    });

    it("le serveur tombe : l'état bascule, le process survit, la reprise est automatique", async () => {
      const pertes = connectionMonitor.snapshot(ORM).lostCount;
      assert.equal(orm.isConnected(), true);

      docker("stop", BOX as string);

      const vuTomber = await until(() => !orm.isConnected(), 30_000);
      assert.ok(
        vuTomber,
        "la perte du primaire doit être CONSTATÉE (topologyDescriptionChanged)",
      );
      assert.equal(connectionMonitor.snapshot(ORM).lostCount, pertes + 1);

      docker("start", BOX as string);

      const revenu = await until(() => orm.isConnected(), 90_000);
      assert.ok(revenu, "Mongoose doit rétablir la connexion tout seul");
      assert.ok(connectionMonitor.snapshot(ORM).reconnectCount >= 1);
    }, 180_000);
  },
);
