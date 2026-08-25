import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { ormRegistry, connectionMonitor } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

/**
 * **Traduction du cycle de vie Mongoose en signaux `orm-core`.**
 *
 * Le contrat lui-même est prouvé sans driver (`@nodefony/orm-core`,
 * `ormResilience.test.ts`). Ce qui se prouve ICI : que l'adapter écoute les
 * bons événements de la vraie `Connection`.
 *
 * Mongoose SAVAIT déjà — le setter de `readyState` émet `disconnected` /
 * `connected`, et le driver le pilote depuis la topologie
 * (`serverDescriptionChanged` en nœud simple, `topologyDescriptionChanged` et
 * perte du primaire en replica set). Personne n'écoutait : la santé ORM
 * annonçait « connecté » pendant toute une coupure.
 *
 * La coupure RÉELLE (serveur arrêté) se joue au banc `NF_RUN_DB_OUTAGE=1` :
 * ici on émet l'événement natif, ce qui est déterministe et sans infra lourde.
 */

const ORM = "mongo_outage";
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)("MongooseOrm — coupure MongoDB", () => {
  let orm: MongooseOrm;

  beforeEach(async () => {
    ormRegistry.unregister(ORM);
    orm = new MongooseOrm(ORM, URI as string);
    await orm.connect();
  });
  afterEach(async () => {
    await orm.disconnect().catch(() => undefined);
    ormRegistry.unregister(ORM);
  });

  it("`disconnected` bascule `isConnected()` et compte l'incident", () => {
    const cx = orm.getNativeConnection<{ emit: (e: string) => boolean }>();
    const avant = connectionMonitor.snapshot(ORM).lostCount;
    assert.equal(orm.isConnected(), true);

    cx.emit("disconnected");

    assert.equal(orm.isConnected(), false, "la santé ORM doit voir la coupure");
    assert.equal(connectionMonitor.snapshot(ORM).lostCount, avant + 1);
    assert.equal(
      connectionMonitor.snapshot(ORM).connectedSince,
      null,
      "l'uptime ne doit plus courir",
    );
  });

  it("une RAFALE d'événements de topologie ne laisse qu'UN incident", () => {
    // Le cas discriminant, celui que le banc réel ne peut pas isoler : une
    // bascule de replica set fait partir plusieurs signaux d'affilée. Un
    // compteur naïf inscrirait autant d'incidents qu'il reçoit d'événements, et
    // le tableau de bord annoncerait une tempête là où il n'y a eu qu'une
    // bascule. Mongoose dédoublonne déjà en amont (son `readyState` n'émet que
    // sur changement) — raison de plus pour éprouver NOTRE garde ici, où elle
    // est seule en cause.
    const cx = orm.getNativeConnection<{ emit: (e: string) => boolean }>();
    const pertes = connectionMonitor.snapshot(ORM).lostCount;
    const vus: unknown[] = [];
    orm.on("onOrmLost", (o: unknown) => vus.push(o));

    cx.emit("disconnected");
    cx.emit("close");
    cx.emit("disconnected");

    assert.equal(connectionMonitor.snapshot(ORM).lostCount, pertes + 1);
    assert.equal(vus.length, 1, "un seul `onOrmLost` pour une seule bascule");
    // Les trois erreurs restent tracées, elles : compter les incidents n'est
    // pas taire ce qui les compose.
    assert.ok(connectionMonitor.snapshot(ORM).errorCount >= 3);
  });

  it("`reconnected` rétablit l'état et compte la reprise", () => {
    const cx = orm.getNativeConnection<{ emit: (e: string) => boolean }>();
    const avant = connectionMonitor.snapshot(ORM).reconnectCount;

    cx.emit("disconnected");
    assert.equal(orm.isConnected(), false);
    cx.emit("reconnected");

    assert.equal(orm.isConnected(), true);
    assert.equal(connectionMonitor.snapshot(ORM).reconnectCount, avant + 1);
  });

  it("une `error` de la connexion NE TUE PAS le process — elle a un auditeur", () => {
    const cx = orm.getNativeConnection<{
      emit: (e: string, ...a: unknown[]) => boolean;
      listenerCount: (e: string) => number;
    }>();
    // Une `Connection` mongoose est un `EventEmitter` : sans auditeur, une
    // erreur émise ferait tomber le process, exactement comme le pool `pg`.
    assert.ok(cx.listenerCount("error") > 0);
    assert.doesNotThrow(() => {
      cx.emit("error", new Error("topology closed"));
    });
    assert.equal(orm.isConnected(), false);
  });

  it("`disconnect()` volontaire ne compte PAS une perte", async () => {
    const avant = connectionMonitor.snapshot(ORM).lostCount;
    // `close()` émet `close` : sans détachement préalable, chaque arrêt propre
    // du serveur inscrirait un incident au tableau de bord.
    await orm.disconnect();
    assert.equal(orm.isConnected(), false);
    assert.equal(connectionMonitor.snapshot(ORM).lostCount, avant);
  });
});
describe.skipIf(!URI)("MongooseOrm — délais d'attente par défaut", () => {
  const lire = (o: MongooseOrm): { selection?: number; connexion?: number } => {
    const cx = o.getNativeConnection<{
      getClient: () => {
        options: {
          serverSelectionTimeoutMS?: number;
          connectTimeoutMS?: number;
        };
      };
    }>();
    const opts = cx.getClient().options;
    return {
      selection: opts.serverSelectionTimeoutMS,
      connexion: opts.connectTimeoutMS,
    };
  };
  const noms: string[] = [];
  afterEach(() => {
    for (const n of noms.splice(0)) {
      ormRegistry.unregister(n);
    }
  });
  const monter = async (
    nom: string,
    uri: string,
    opts?: Record<string, unknown>,
  ): Promise<MongooseOrm> => {
    noms.push(nom);
    const o = new MongooseOrm(nom, uri, opts as never);
    await o.connect();
    return o;
  };

  it("par défaut : 5 s, et non les 30 s du driver", async () => {
    // Mesuré sur une base arrêtée : avec le défaut du driver, une requête PEND
    // 30 s avant d'échouer — le client a abandonné depuis longtemps et le
    // worker attend une base dont on sait déjà qu'elle ne répond pas.
    const orm = await monter("delais_defaut", URI as string);
    try {
      assert.deepEqual(lire(orm), { selection: 5_000, connexion: 5_000 });
    } finally {
      await orm.disconnect().catch(() => undefined);
    }
  });

  it("un choix EXPLICITE par options gagne sur notre défaut", async () => {
    const orm = await monter("delais_options", URI as string, {
      serverSelectionTimeoutMS: 12_000,
    });
    try {
      assert.equal(lire(orm).selection, 12_000);
      // …et ce qui n'est PAS choisi garde le défaut sain.
      assert.equal(lire(orm).connexion, 5_000);
    } finally {
      await orm.disconnect().catch(() => undefined);
    }
  });

  it("un choix EXPLICITE dans l'URI gagne aussi", async () => {
    // Le piège qu'un défaut mal posé fait tomber : un objet d'options prime
    // silencieusement sur la chaîne de connexion. Une URI qui porte son délai
    // dit ce qu'elle veut ; l'écraser serait décider à la place de l'opérateur.
    const base = URI as string;
    const avecDelai = base.includes("?")
      ? `${base}&serverSelectionTimeoutMS=9000`
      : `${base}?serverSelectionTimeoutMS=9000`;
    const orm = await monter("delais_uri", avecDelai);
    try {
      assert.equal(lire(orm).selection, 9_000);
    } finally {
      await orm.disconnect().catch(() => undefined);
    }
  });
});
