import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { entity, ormRegistry, connectionMonitor } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

/**
 * **Coupures RÉELLES d'un serveur MongoDB** — arrêté, gelé, dégradé, puis
 * relancé, pendant que l'ORM est connecté.
 *
 * Complémentaire d'`outage.test.ts`, qui ÉMET lui-même l'événement du driver :
 * celui-là prouve le câblage en SUPPOSANT que Mongoose émettra. Ici, personne
 * ne simule rien — c'est le serveur qui tombe.
 *
 * Mongo est le seul des trois dialectes dont le driver surveille ses serveurs
 * en permanence (SDAM) : il sait qu'une base est tombée même sans trafic, là où
 * `pg` et `mysql2` n'apprennent l'état que par leurs requêtes. Ce banc vérifie
 * que Nodefony exploite CE qu'il sait — et qu'il ne le compte qu'une fois.
 *
 * 🎯 **La cible se PROUVE.** Le décor de test peut fournir soit le conteneur
 * Docker, soit un `mongod` éphémère téléchargé (`mongodb-memory-server`).
 * Arrêter le conteneur en éprouvant l'éphémère donnerait un banc vert qui
 * n'aurait rien mesuré : ces cas exigent donc `NF_MONGO_TEST_URI`, la forme qui
 * court-circuite le spawn et désigne sans ambiguïté le serveur qu'on va couper.
 *
 * GATE : `NF_RUN_DB_OUTAGE=1` + `NF_MONGO_TEST_URI` + `NF_DB_OUTAGE_MONGO_CONTAINER`.
 */

const ON = process.env.NF_RUN_DB_OUTAGE === "1";
const BOX = process.env.NF_DB_OUTAGE_MONGO_CONTAINER;
/** URI du serveur RÉEL — jamais celle d'un `mongod` éphémère (cf ci-dessus). */
const URI_REELLE = process.env.NF_MONGO_TEST_URI;
const ORM = "mongo_outage_real";

// Entité minimale du banc : une transaction Mongo ne se prouve que par une
// ÉCRITURE — `savepoint()` y est un no-op documenté (pas de savepoints côté
// MongoDB), donc inapte à révéler un serveur tombé.
@entity({
  connector: ORM,
  name: "OutageDoc",
  schema: { libelle: { type: String, required: true } },
})
class OutageDocEntity {}
void OutageDocEntity;

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

/** `mongosh` dans le conteneur — la seule voie pour dégrader la topologie. */
function mongosh(script: string): string {
  return execFileSync(
    "docker",
    ["exec", BOX as string, "mongosh", "--quiet", "--eval", script],
    { encoding: "utf8" },
  ).trim();
}

/** Le serveur accepte-t-il des écritures (donc : un primaire est élu) ? */
async function attendrePrimaire(maxMs: number): Promise<boolean> {
  return until(() => {
    try {
      return mongosh("rs.status().members[0].stateStr").includes("PRIMARY");
    } catch {
      return false;
    }
  }, maxMs);
}

/** URI de banc, scopée sur une base propre au fichier. */
function uri(db: string): string {
  const base = URI_REELLE as string;
  const qi = base.indexOf("?");
  const chemin = qi === -1 ? base : base.slice(0, qi);
  const query = qi === -1 ? "" : base.slice(qi);
  return `${chemin.endsWith("/") ? chemin : `${chemin}/`}${db}${query}`;
}

describe.skipIf(!ON || !URI_REELLE || !BOX)(
  "MongooseOrm — coupures RÉELLES de MongoDB",
  () => {
    let orm: MongooseOrm;

    beforeEach(async () => {
      ormRegistry.unregister(ORM);
      orm = new MongooseOrm(ORM, uri(ORM));
      await orm.connect();
    });

    afterEach(async () => {
      // Rendre le décor SAIN pour le test suivant : relancer un conteneur ne
      // suffit pas, Mongo doit avoir réélu un primaire. Sans cette attente, le
      // test suivant échoue à son `connect()` et accuse le code.
      try {
        docker("unpause", BOX as string);
      } catch {
        /* pas en pause */
      }
      try {
        docker("start", BOX as string);
      } catch {
        /* déjà démarré */
      }
      await orm.disconnect().catch(() => undefined);
      ormRegistry.unregister(ORM);
      await attendrePrimaire(90_000);
    });

    it("un BOOT n'est pas une reprise (pas de reconnexion fantôme)", () => {
      const snap = connectionMonitor.snapshot(ORM);
      assert.equal(snap.reconnectCount, 0, "aucune reprise au démarrage");
      assert.equal(snap.lostCount, 0, "aucune perte au démarrage");
      assert.equal(orm.isConnected(), true);
    });

    it("le serveur tombe : le process SURVIT, l'état bascule, la reprise est automatique", async () => {
      const pertes = connectionMonitor.snapshot(ORM).lostCount;
      assert.equal(orm.isConnected(), true);

      docker("stop", BOX as string);

      assert.ok(
        await until(() => !orm.isConnected(), 30_000),
        "la perte du primaire doit être CONSTATÉE (topologyDescriptionChanged)",
      );
      assert.equal(connectionMonitor.snapshot(ORM).lostCount, pertes + 1);
      assert.equal(
        connectionMonitor.snapshot(ORM).connectedSince,
        null,
        "l'uptime ne doit plus courir",
      );

      docker("start", BOX as string);

      assert.ok(
        await until(() => orm.isConnected(), 120_000),
        "Mongoose doit rétablir la connexion tout seul",
      );
      assert.ok(connectionMonitor.snapshot(ORM).reconnectCount >= 1);
    }, 180_000);

    it("BASCULE DE PRIMAIRE : perte du primaire vue comme UN incident, reprise automatique", async () => {
      // Le cas propre à Mongo : perdre le PRIMAIRE sans perdre le serveur.
      // Un `replSetStepDown` fait partir plusieurs
      // `topologyDescriptionChanged` d'affilée — le nœud quitte PRIMARY, la
      // topologie devient sans primaire, puis un primaire revient.
      //
      // ⚠️ Ce que ce banc prouve exactement : que la bascule est VUE, et
      // qu'elle ne laisse qu'UN incident derrière elle. Il ne prouve pas à lui
      // seul l'idempotence de nos hooks — mesuré : il passe même en la
      // débranchant, parce que Mongoose dédoublonne déjà en amont (le setter
      // de `readyState` n'émet que sur CHANGEMENT d'état). L'idempotence, elle,
      // est éprouvée là où elle discrimine : `outage.test.ts` (rafale émise à
      // la main) et le contrat portable d'`orm-core`.
      const pertes0 = connectionMonitor.snapshot(ORM).lostCount;
      const reprises0 = connectionMonitor.snapshot(ORM).reconnectCount;
      const pertes: number[] = [];
      orm.on("onOrmLost", () => pertes.push(Date.now()));

      mongosh("db.adminCommand({replSetStepDown: 8, force: true})");

      assert.ok(
        await until(() => !orm.isConnected(), 30_000),
        "la perte du primaire doit être vue — un secondaire ne sert pas d'écriture",
      );
      assert.ok(
        await attendrePrimaire(90_000),
        "le nœud doit redevenir primaire tout seul",
      );
      assert.ok(
        await until(() => orm.isConnected(), 60_000),
        "et l'ORM doit le constater",
      );

      const snap = connectionMonitor.snapshot(ORM);
      assert.equal(
        snap.lostCount - pertes0,
        1,
        "UNE bascule = UN incident, quelle que soit la rafale d'événements",
      );
      assert.equal(snap.reconnectCount - reprises0, 1, "et UNE reprise");
      assert.equal(pertes.length, 1, "un seul `onOrmLost` émis");
    }, 240_000);

    it("coupure PENDANT une transaction ouverte : elle échoue, et une transaction NEUVE repasse après", async () => {
      // ⚠️ Une transaction se sonde par une ÉCRITURE, pas par un `savepoint()` :
      // MongoDB n'a pas de savepoints, et le contrat les rend en no-op
      // documenté. Un banc qui s'y fierait croirait interroger le serveur
      // sans jamais lui parler — et passerait au vert sur une base éteinte.
      const depot = orm.getRepository<{ id?: string; libelle: string }>(
        "OutageDoc",
      );

      await assert.rejects(
        orm.transaction(async () => {
          await depot.create({ libelle: "avant la coupure" });
          docker("stop", BOX as string);
          await depot.create({ libelle: "après la coupure" });
        }),
        "une transaction ne peut pas aboutir sur un serveur tombé",
      );

      docker("start", BOX as string);
      assert.ok(await attendrePrimaire(120_000), "primaire réélu");

      const repartie = await until(async () => {
        try {
          await orm.transaction(async () => {
            await depot.create({ libelle: "après le retour" });
          });
          return true;
        } catch {
          return false;
        }
      }, 90_000);
      assert.ok(
        repartie,
        "une transaction NEUVE doit repasser après le retour",
      );
    }, 240_000);

    it("base GELÉE (docker pause) : la requête ne rend pas un faux succès", async () => {
      const cx = orm.getNativeConnection<{
        db: { admin: () => { ping: () => Promise<unknown> } };
      }>();
      docker("pause", BOX as string);
      try {
        const verdict = await Promise.race([
          cx.db
            .admin()
            .ping()
            .then(
              () => "repondu",
              () => "echoue",
            ),
          new Promise<string>((r) => setTimeout(() => r("pend"), 8_000)),
        ]);
        assert.notEqual(
          verdict,
          "repondu",
          "une base gelée ne doit jamais rendre un succès",
        );
      } finally {
        docker("unpause", BOX as string);
      }
    }, 90_000);

    it("BATTEMENT : une base GELÉE finit par être constatée", async () => {
      // Même sur Mongo, dont le driver surveille pourtant ses serveurs : un
      // serveur GELÉ ne ferme rien et ne répond pas, la sélection de serveur
      // attend son propre délai (30 s par défaut). Le battement, lui, a sa
      // montre — c'est ce qui le rend utile ici aussi.
      const rapide = new MongooseOrm(`${ORM}-beat`, uri(`${ORM}_beat`));
      (rapide as unknown as { heartbeatMs: number }).heartbeatMs = 500;
      (rapide as unknown as { heartbeatTimeoutMs: number }).heartbeatTimeoutMs =
        2_000;
      await rapide.connect();
      try {
        assert.equal(rapide.isConnected(), true);

        docker("pause", BOX as string);
        assert.ok(
          await until(() => !rapide.isConnected(), 60_000),
          "une base gelée doit finir par être constatée",
        );

        docker("unpause", BOX as string);
        assert.ok(
          await until(() => rapide.isConnected(), 60_000),
          "le battement doit AUSSI constater le retour",
        );
      } finally {
        try {
          docker("unpause", BOX as string);
        } catch {
          /* déjà repris */
        }
        await rapide.disconnect().catch(() => undefined);
        ormRegistry.unregister(`${ORM}-beat`);
      }
    }, 180_000);

    it("flapping : trois coupures serrées comptent trois pertes et trois reprises", async () => {
      const pertes0 = connectionMonitor.snapshot(ORM).lostCount;
      const reprises0 = connectionMonitor.snapshot(ORM).reconnectCount;

      for (let i = 0; i < 3; i++) {
        docker("stop", BOX as string);
        assert.ok(
          await until(() => !orm.isConnected(), 30_000),
          `coupure ${i + 1} non constatée`,
        );
        docker("start", BOX as string);
        assert.ok(await attendrePrimaire(120_000), `primaire ${i + 1} réélu`);
        assert.ok(
          await until(() => orm.isConnected(), 60_000),
          `reprise ${i + 1} non constatée`,
        );
      }

      const snap = connectionMonitor.snapshot(ORM);
      assert.equal(snap.lostCount - pertes0, 3, "une perte par coupure");
      assert.equal(
        snap.reconnectCount - reprises0,
        3,
        "une reprise par retour",
      );
      assert.equal(orm.isConnected(), true);
    }, 420_000);

    it("disconnect() PENDANT la coupure : il rend la main, et n'inscrit aucun incident", async () => {
      docker("stop", BOX as string);
      await until(() => !orm.isConnected(), 30_000);
      const pertes = connectionMonitor.snapshot(ORM).lostCount;

      const fini = await Promise.race([
        orm.disconnect().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
      ]);
      assert.ok(fini, "disconnect() doit rendre la main même serveur mort");
      assert.equal(orm.isConnected(), false);
      assert.equal(
        connectionMonitor.snapshot(ORM).lostCount,
        pertes,
        "fermer volontairement n'est pas une perte de plus",
      );
    }, 90_000);
  },
);
