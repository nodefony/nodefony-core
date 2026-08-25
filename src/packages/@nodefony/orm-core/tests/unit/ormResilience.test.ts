import assert from "node:assert/strict";
import { Orm } from "../../nodefony/src/Orm";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { connectionMonitor } from "../../nodefony/src/ConnectionMonitor";
import { buildOrmLeanHealth } from "../../nodefony/src/buildOrmLeanHealth";
import type {
  IRepository,
  ITransaction,
} from "../../nodefony/interfaces/index";

/**
 * **Contrat de RÉSILIENCE que tout adapter ORM doit honorer** — exercé sur la
 * classe de base, donc sans driver, sans serveur et sans Docker.
 *
 * Pourquoi ici et pas dans `@nodefony/drizzle` : l'adapter par défaut peut être
 * remplacé un jour. Ce qui ne doit PAS changer, c'est ce que le framework et
 * ses sondes attendent d'une connexion — savoir qu'elle est tombée, savoir
 * qu'elle est revenue, et le dire une seule fois. Un adapter futur passe ce
 * fichier ou n'est pas un adapter.
 *
 * Ce que chaque adapter apporte en propre, c'est la TRADUCTION : quel événement
 * de SON driver vaut `connectionLost` (`pool.on("error")` pour `pg`,
 * `disconnected` pour Mongoose). Cette traduction-là se prouve contre le vrai
 * driver — `tests/integration/outage.test.ts` de chaque adapter.
 */
class FakeOrm extends Orm {
  /** Rend visibles à l'extérieur les signaux qu'un adapter émet depuis son driver. */
  signalLost(reason: string): void {
    this.connectionLost(reason);
  }
  signalRestored(): void {
    this.connectionRestored();
  }
  protected async onConnect(): Promise<void> {
    /* aucun driver : le contrat ne porte que sur l'état de vie */
  }
  async disconnect(): Promise<void> {
    this.alive = false;
  }
  getRepository<T = unknown>(): IRepository<T> {
    return {} as IRepository<T>;
  }
  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    return work({} as ITransaction);
  }
  getNativeConnection<C = unknown>(): C {
    return null as C;
  }
}

describe("Orm — contrat de résilience (perte / reprise de connexion)", () => {
  const names: string[] = [];
  const mk = (name: string): FakeOrm => {
    names.push(name);
    return new FakeOrm(name);
  };
  afterEach(() => {
    for (const n of names.splice(0)) {
      ormRegistry.unregister(n);
    }
  });

  it("un ORM neuf n'est PAS connecté tant que connect() n'a pas abouti", () => {
    const orm = mk("res-neuf");
    assert.equal(orm.isConnected(), false);
  });

  it("connect() rend connecté, disconnect() rend déconnecté", async () => {
    const orm = mk("res-cycle");
    await orm.connect();
    assert.equal(orm.isConnected(), true);
    await orm.disconnect();
    assert.equal(orm.isConnected(), false);
  });

  it("un connect() qui ÉCHOUE ne laisse pas l'ORM « connecté »", async () => {
    const orm = mk("res-echec");
    // Un adapter dont `onConnect` lève laissait autrefois son booléen à sa
    // valeur précédente : après une reconnexion ratée, la sonde continuait
    // d'annoncer une connexion saine.
    (orm as unknown as { onConnect: () => Promise<void> }).onConnect = () =>
      Promise.reject(new Error("serveur injoignable"));
    await assert.rejects(orm.connect());
    assert.equal(orm.isConnected(), false);
  });

  it("la PERTE bascule l'état, compte l'incident et émet `onOrmLost` UNE fois", async () => {
    const orm = mk("res-perte");
    await orm.connect();
    const vus: string[] = [];
    orm.on("onOrmLost", (_o: unknown, reason: string) => vus.push(reason));

    // Un pool de N connexions émet N erreurs pour UNE coupure : le framework
    // ne doit en voir qu'un seul incident.
    orm.signalLost("driver: connection terminated");
    orm.signalLost("driver: connection terminated");
    orm.signalLost("driver: connection terminated");

    assert.equal(orm.isConnected(), false);
    assert.equal(vus.length, 1, "un seul événement pour une seule coupure");
    const snap = connectionMonitor.snapshot("res-perte");
    assert.equal(snap.lostCount, 1, "un seul incident compté");
    assert.equal(snap.errorCount, 3, "mais les trois erreurs restent tracées");
    assert.equal(snap.connectedSince, null, "l'uptime ne court plus");
  });

  it("la REPRISE rebascule l'état, compte la reconnexion et émet `onOrmRestored` UNE fois", async () => {
    const orm = mk("res-reprise");
    await orm.connect();
    const vus: unknown[] = [];
    orm.on("onOrmRestored", (o: unknown) => vus.push(o));

    orm.signalLost("driver: down");
    orm.signalRestored();
    orm.signalRestored(); // `pg` émet `connect` à chaque client créé

    assert.equal(orm.isConnected(), true);
    assert.equal(vus.length, 1, "une seule reprise pour une seule coupure");
    const snap = connectionMonitor.snapshot("res-reprise");
    assert.equal(snap.reconnectCount, 1);
    assert.equal(snap.lostCount, 1);
    assert.notEqual(snap.connectedSince, null, "l'uptime repart");
  });

  it("un signal de reprise reçu PENDANT connect() ne compte rien", async () => {
    // LE cas que la garde précédente laissait passer, et il n'avait rien
    // d'hypothétique : un adapter câble ses écoutes AVANT son premier échange
    // (il le doit — ce premier échange peut échouer), et `pg` émet `connect`
    // puis `acquire` sur ce tout premier client. Comme `alive` n'est posé qu'au
    // RETOUR de `onConnect()`, la garde « déjà vivant ? » ne mordait pas :
    // chaque démarrage comptait une reconnexion et annonçait `onOrmRestored`
    // AVANT `onOrmReady`. Mesuré sur pg et mysql avant correction.
    const orm = mk("res-pendant-connect");
    const ordre: string[] = [];
    orm.on("onOrmRestored", () => ordre.push("restored"));
    orm.on("onOrmReady", () => ordre.push("ready"));
    (orm as unknown as { onConnect: () => Promise<void> }).onConnect =
      async () => {
        // Le driver signale un « retour » alors que rien n'a jamais été perdu.
        orm.signalRestored();
        orm.signalRestored();
      };

    await orm.connect();

    const snap = connectionMonitor.snapshot("res-pendant-connect");
    assert.equal(snap.reconnectCount, 0, "un démarrage n'est pas une reprise");
    assert.equal(snap.lostCount, 0);
    assert.deepEqual(
      ordre,
      ["ready"],
      "rien ne doit précéder la mise en service",
    );
    assert.equal(orm.isConnected(), true);
  });

  it("connect() rejoué est PERMIS, et l'adapter reprend ses ressources", async () => {
    // Le dépôt s'en sert (rejouer un DDL de développement sur une base
    // existante). L'interdire aurait cassé un usage documenté — et un contrat
    // portable n'a pas à légiférer sur ce que chaque adapter sait faire.
    // Ce qui est EXIGÉ, c'est qu'un second établissement reprenne le premier :
    // sans cela, un pool reste ouvert et ses écoutes continuent de parler au
    // nom d'un ORM dont la connexion courante est ailleurs.
    const orm = mk("res-rejoue");
    let etablissements = 0;
    (orm as unknown as { onConnect: () => Promise<void> }).onConnect =
      async () => {
        etablissements += 1;
      };
    await orm.connect();
    await orm.connect();
    assert.equal(
      etablissements,
      2,
      "le second connect() rejoue l'établissement",
    );
    assert.equal(orm.isConnected(), true);
    const snap = connectionMonitor.snapshot("res-rejoue");
    assert.equal(snap.connectCount, 2);
    assert.equal(snap.reconnectCount, 0, "rejouer n'est pas se rétablir");
    assert.equal(snap.lostCount, 0);
  });

  it("après une reprise, une NOUVELLE perte est de nouveau comptée", async () => {
    // Vérifie que la perte en souffrance est bien REMISE à zéro : sinon le
    // remède au démarrage fantôme rendrait le second incident invisible.
    const orm = mk("res-second-incident");
    await orm.connect();
    orm.signalLost("coupure 1");
    orm.signalRestored();
    orm.signalLost("coupure 2");
    orm.signalRestored();
    const snap = connectionMonitor.snapshot("res-second-incident");
    assert.equal(snap.lostCount, 2);
    assert.equal(snap.reconnectCount, 2);
  });

  it("une reprise SANS perte préalable ne compte rien", async () => {
    const orm = mk("res-sans-perte");
    await orm.connect();
    const vus: unknown[] = [];
    orm.on("onOrmRestored", (o: unknown) => vus.push(o));
    // Cas réel : un pool qui grandit sous la charge ouvre des connexions
    // supplémentaires alors que rien n'est tombé.
    orm.signalRestored();
    orm.signalRestored();
    assert.equal(vus.length, 0);
    assert.equal(
      connectionMonitor.snapshot("res-sans-perte").reconnectCount,
      0,
    );
  });

  it("la santé ORM lean cesse de compter un connecteur TOMBÉ", async () => {
    const orm = mk("res-lean");
    await orm.connect();
    const connecte = buildOrmLeanHealth().connected;

    orm.signalLost("driver: down");
    assert.equal(
      buildOrmLeanHealth().connected,
      connecte - 1,
      "une readiness adossée à cette valeur doit voir la coupure",
    );

    orm.signalRestored();
    assert.equal(buildOrmLeanHealth().connected, connecte);
  });

  it("plusieurs cycles perte/reprise s'additionnent sans dériver", async () => {
    const orm = mk("res-cycles");
    await orm.connect();
    for (let i = 0; i < 5; i++) {
      orm.signalLost(`coupure ${i}`);
      orm.signalRestored();
    }
    const snap = connectionMonitor.snapshot("res-cycles");
    assert.equal(snap.lostCount, 5);
    assert.equal(snap.reconnectCount, 5);
    assert.equal(snap.connectCount, 1, "une seule connexion, cinq reprises");
    assert.equal(orm.isConnected(), true);
  });
});
