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
/**
 * Rend le décor SAIN pour le test suivant.
 *
 * Relancer un conteneur ne suffit pas : une base met plusieurs secondes à
 * accepter des connexions, et le test suivant échouait à son `connect()`
 * pour une raison qui n'avait rien à voir avec ce qu'il éprouve — le faux
 * rouge le plus coûteux à diagnostiquer, parce qu'il accuse le code.
 */
async function attendreServeur(url: string, maxMs: number): Promise<boolean> {
  const { Pool } = (await import("pg")) as unknown as {
    Pool: new (c: { connectionString: string }) => {
      query: (s: string) => Promise<unknown>;
      end: () => Promise<void>;
    };
  };
  return until(async () => {
    const sonde = new Pool({ connectionString: url });
    try {
      await sonde.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await sonde.end().catch(() => undefined);
    }
  }, maxMs);
}

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
        docker("unpause", PG_BOX as string);
      } catch {
        /* pas en pause */
      }
      try {
        docker("start", PG_BOX as string);
      } catch {
        /* déjà démarré */
      }
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
      // Attendre que la base ACCEPTE des connexions : sans cela, le test
      // suivant échoue à son `connect()` et accuse le code.
      await attendreServeur(PG_URL as string, 60_000);
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

    it("coupure PENDANT une transaction ouverte : elle échoue, et une transaction NEUVE repasse après", async () => {
      const client = orm.getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>().$client;
      await client.query("SELECT 1");

      // Une transaction emprunte UNE connexion au pool et la garde. Si le
      // serveur tombe pendant, la connexion doit être DÉTRUITE et non
      // recyclée : un `BEGIN` orphelin remis en circulation contaminerait la
      // requête suivante d'un autre appelant.
      await assert.rejects(
        orm.transaction(async (tx) => {
          await tx.savepoint("avant_coupure");
          docker("stop", PG_BOX as string);
          await tx.savepoint("apres_coupure");
          // Un savepoint est une vraie requête serveur ET il appartient au
          // contrat PORTABLE : ce banc ne dépend d’aucune trappe de driver.
        }),
        "une transaction ne peut pas aboutir sur un serveur tombé",
      );

      docker("start", PG_BOX as string);
      const repartie = await until(async () => {
        try {
          await orm.transaction(async (tx) => {
            await tx.savepoint("verification");
          });
          return true;
        } catch {
          return false;
        }
      }, 60_000);
      assert.ok(
        repartie,
        "une transaction NEUVE doit repasser après le retour",
      );
    }, 120_000);

    it("base GELÉE (docker pause) : la requête ne rend pas un faux succès", async () => {
      const client = orm.getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>().$client;
      await client.query("SELECT 1");

      // Le scénario de production le plus fréquent, et le plus vicieux : le
      // serveur ne FERME rien, il cesse simplement de répondre. Aucun socket
      // ne meurt, donc aucun événement n'est émis — un état déduit
      // d'événements ne peut, par construction, rien voir.
      docker("pause", PG_BOX as string);
      try {
        const verdict = await Promise.race([
          client.query("SELECT 1").then(
            () => "repondu",
            () => "echoue",
          ),
          new Promise<string>((r) => setTimeout(() => r("pend"), 5_000)),
        ]);
        assert.notEqual(
          verdict,
          "repondu",
          "une base gelée ne doit jamais rendre un succès",
        );
        // Ce que ce banc GRAVE : sur `pg`, la requête PEND (aucun timeout par
        // défaut) et l'état reste « connecté ». C'est une limite CONNUE et
        // assumée du modèle événementiel — la détecter demanderait un délai
        // de requête, décision produit non prise. Le test fige le fait pour
        // qu'un changement de comportement se voie.
        assert.equal(
          verdict,
          "pend",
          "comportement figé : pg pend sans timeout",
        );
      } finally {
        docker("unpause", PG_BOX as string);
      }
    }, 60_000);

    it("flapping : trois coupures serrées comptent trois pertes et trois reprises", async () => {
      const client = orm.getNativeConnection<{
        $client: { query: (s: string) => Promise<unknown> };
      }>().$client;
      const pertes0 = connectionMonitor.snapshot(ORM).lostCount;
      const reprises0 = connectionMonitor.snapshot(ORM).reconnectCount;

      for (let i = 0; i < 3; i++) {
        docker("stop", PG_BOX as string);
        assert.ok(
          await until(() => !orm.isConnected(), 20_000),
          `coupure ${i + 1} non constatée`,
        );
        docker("start", PG_BOX as string);
        assert.ok(
          await until(async () => {
            try {
              await client.query("SELECT 1");
              return orm.isConnected();
            } catch {
              return false;
            }
          }, 60_000),
          `reprise ${i + 1} non constatée`,
        );
      }

      const snap = connectionMonitor.snapshot(ORM);
      assert.equal(
        snap.lostCount - pertes0,
        3,
        "une perte par coupure, ni plus ni moins",
      );
      assert.equal(
        snap.reconnectCount - reprises0,
        3,
        "une reprise par retour",
      );
      assert.equal(orm.isConnected(), true);
    }, 240_000);

    it("disconnect() PENDANT la coupure : il rend la main, et n'inscrit aucun incident", async () => {
      docker("stop", PG_BOX as string);
      await until(() => !orm.isConnected(), 20_000);
      const pertes = connectionMonitor.snapshot(ORM).lostCount;

      // Un arrêt d'application pendant que la base est tombée est le cas le
      // plus banal d'un redéploiement raté. Il ne doit ni pendre, ni compter
      // un incident supplémentaire, ni faire tomber le process.
      const fini = await Promise.race([
        orm.disconnect().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 15_000)),
      ]);
      assert.ok(fini, "disconnect() doit rendre la main même serveur mort");
      assert.equal(orm.isConnected(), false);
      assert.equal(
        connectionMonitor.snapshot(ORM).lostCount,
        pertes,
        "fermer volontairement n'est pas une perte de plus",
      );
    }, 60_000);

    it("BATTEMENT : une base GELÉE finit par être constatée, là où aucun événement n'est émis", async () => {
      // Le cas que le modèle événementiel ne peut PAS voir, par construction :
      // le serveur ne ferme rien, il cesse de répondre. Aucun socket ne meurt,
      // donc `pg` n'émet rien, donc l'état restait « connecté » indéfiniment.
      // Mesuré avant le battement : `isConnected()` vrai pendant toute la gelée.
      const rapide = new DrizzleOrm(`${ORM}-beat`, {
        dialect: "postgres",
        url: PG_URL as string,
      });
      // Battement serré pour ne pas faire durer le banc — la période de
      // production est bien plus longue, le mécanisme est le même.
      (rapide as unknown as { heartbeatMs: number }).heartbeatMs = 500;
      await rapide.connect();
      try {
        assert.equal(rapide.isConnected(), true);

        docker("pause", PG_BOX as string);
        const vuTomber = await until(() => !rapide.isConnected(), 30_000);
        assert.ok(
          vuTomber,
          "sans battement, une base gelée reste « connectée » pour toujours",
        );

        docker("unpause", PG_BOX as string);
        const vuRevenir = await until(() => rapide.isConnected(), 30_000);
        assert.ok(vuRevenir, "le battement doit AUSSI constater le retour");
      } finally {
        try {
          docker("unpause", PG_BOX as string);
        } catch {
          /* déjà repris */
        }
        await rapide.disconnect().catch(() => undefined);
        ormRegistry.unregister(`${ORM}-beat`);
      }
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
