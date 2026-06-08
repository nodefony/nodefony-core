import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { ormRegistry } from "@nodefony/orm-core";
import type { Module } from "nodefony";
import MongooseService from "../../nodefony/service/MongooseService";
import type { IMongooseConnectorConfig } from "../../nodefony/interfaces/IMongooseConfig";

const makeModule = (mongooseConfig: unknown): Module =>
  ({
    get: (key: string) =>
      key === "mongooseConfig" ? mongooseConfig : undefined,
  }) as unknown as Module;

describe("MongooseService — buildUri (assemblage pur)", () => {
  it("uri explicite → renvoyée telle quelle", () => {
    assert.equal(
      MongooseService.buildUri({
        uri: "mongodb://h:1/d",
      } as IMongooseConnectorConfig),
      "mongodb://h:1/d",
    );
  });

  it("composants host/port/dbname → assemblés", () => {
    assert.equal(
      MongooseService.buildUri({
        host: "db.local",
        port: 1234,
        dbname: "app",
      } as IMongooseConnectorConfig),
      "mongodb://db.local:1234/app",
    );
  });

  it("vide → défauts localhost:27017/nodefony", () => {
    assert.equal(
      MongooseService.buildUri({} as IMongooseConnectorConfig),
      "mongodb://localhost:27017/nodefony",
    );
  });
});

describe("MongooseService — orchestration boot (hors kernel)", () => {
  let replset: MongoMemoryReplSet;
  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  }, 60_000);
  afterAll(async () => {
    await replset.stop();
  });
  afterEach(() => {
    ormRegistry.unregister("svc_mongo");
  });

  it("connectAll : connecte un ORM par connecteur (enregistré dans ormRegistry)", async () => {
    const service = new MongooseService(
      makeModule({ connectors: { svc_mongo: { uri: replset.getUri() } } }),
    );
    await service.connectAll();

    const orm = service.getOrm("svc_mongo");
    assert.ok(orm, "ORM du connecteur absent");
    assert.equal(orm.isConnected(), true);
    assert.equal(ormRegistry.has("svc_mongo"), true);

    await service.disconnectAll();
  });

  it("disconnectAll : ferme tout et vide le registre interne", async () => {
    const service = new MongooseService(
      makeModule({ connectors: { svc_mongo: { uri: replset.getUri() } } }),
    );
    await service.connectAll();
    await service.disconnectAll();
    assert.equal(service.getOrm("svc_mongo"), undefined);
  });

  it("config absente / sans connecteurs → connectAll ne fait rien (pas de crash)", async () => {
    const service = new MongooseService(makeModule(undefined));
    await service.connectAll();
    assert.equal(service.getOrm("svc_mongo"), undefined);
  });
});
