import assert from "node:assert/strict";
import { Orm } from "../../nodefony/src/Orm";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { connectionMonitor } from "../../nodefony/src/ConnectionMonitor";
import type {
  IRepository,
  ITransaction,
} from "../../nodefony/interfaces/index";

/** Adapter concret minimal pour exercer la base abstraite Orm. */
class TestOrm extends Orm {
  connected = false;
  onConnectCalls = 0;
  failConnect = false;

  protected async onConnect(): Promise<void> {
    this.onConnectCalls += 1;
    if (this.failConnect) {
      throw new Error("connect boom");
    }
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
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

describe("Orm — classe de base abstraite (template connect + monitor)", () => {
  const names: string[] = [];
  const mk = (name: string): TestOrm => {
    names.push(name);
    return new TestOrm(name);
  };
  afterEach(() => {
    for (const n of names) {
      ormRegistry.unregister(n);
    }
    names.length = 0;
  });

  it("le constructeur auto-enregistre l'instance dans ormRegistry", () => {
    const orm = mk("orm-base-register");
    assert.equal(ormRegistry.has("orm-base-register"), true);
    assert.equal(ormRegistry.get("orm-base-register"), orm);
  });

  it("deux ORM du même nom → le 2ᵉ constructeur lève", () => {
    mk("orm-base-dup");
    assert.throws(() => new TestOrm("orm-base-dup"), /already registered/);
  });

  it("connect() : appelle onConnect, émet onOrmReady, compte la connexion", () => {
    const n = "orm-base-connect";
    const orm = mk(n);
    const before = connectionMonitor.snapshot(n).connectCount;
    let firedWith: unknown = undefined;
    orm.on("onOrmReady", (arg: unknown) => {
      firedWith = arg;
    });

    return orm.connect().then(() => {
      assert.equal(orm.onConnectCalls, 1);
      assert.equal(orm.isConnected(), true);
      assert.equal(firedWith, orm, "onOrmReady émis avec l'instance ORM");
      assert.equal(connectionMonitor.snapshot(n).connectCount, before + 1);
    });
  });

  it("connect() en échec : recordError, rethrow, pas d'onOrmReady", async () => {
    const n = "orm-base-fail";
    const orm = mk(n);
    orm.failConnect = true;
    const before = connectionMonitor.snapshot(n).errorCount;
    let fired = false;
    orm.on("onOrmReady", () => {
      fired = true;
    });

    await assert.rejects(() => orm.connect(), /connect boom/);
    assert.equal(orm.isConnected(), false);
    assert.equal(fired, false);
    assert.equal(connectionMonitor.snapshot(n).errorCount, before + 1);
  });

  it("describeEntity/describeConnection : défauts neutres (surchargés par les drivers)", () => {
    const orm = mk("orm-base-defaults");
    assert.deepEqual(orm.describeEntity("Anything"), []);
    assert.deepEqual(orm.describeConnection(), { driver: "" });
  });
});
