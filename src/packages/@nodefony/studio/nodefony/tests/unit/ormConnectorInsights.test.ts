/**
 * Lecture d'un connecteur ORM (`frontend/src/utils/ormConnectorInsights.ts`) :
 * rattachement des briques au BON connecteur, et verdicts fondés sur une mesure.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  analyzeConnector,
  attributeBricks,
  worstLevel,
} from "../../../frontend/src/utils/ormConnectorInsights";
import type {
  ConnHealth,
  OrmSummary,
  StoreBrick,
} from "../../../frontend/src/types/orm";

const FILE = "var/databases/nodefony-drizzle.db";
const fileDb: OrmSummary = {
  name: "default",
  vendor: "drizzle",
  default: true,
  connected: true,
  entityCount: 10,
  connection: { driver: "sqlite", target: FILE },
};
const memoryDb: OrmSummary = {
  name: "mediasoup",
  vendor: "drizzle",
  default: false,
  connected: true,
  entityCount: 8,
  connection: { driver: "sqlite", target: ":memory:" },
};
const mongo: OrmSummary = {
  name: "nodefony",
  vendor: "mongoose",
  default: true,
  connected: true,
  entityCount: 9,
  connection: { driver: "mongodb", target: "mongodb://db/app" },
};

function brick(
  name: string,
  resolved: string,
  location?: string,
  nature = "durable",
): StoreBrick {
  return { brick: name, resolved, location, nature };
}

function health(over: Partial<ConnHealth> = {}): ConnHealth {
  return {
    instanceId: "42",
    name: "default",
    vendor: "drizzle",
    driver: "sqlite",
    target: FILE,
    connected: true,
    connectedSince: 0,
    uptimeMs: 1000,
    connectCount: 1,
    reconnectCount: 0,
    errorCount: 0,
    lastError: null,
    recentErrors: [],
    lastConnectMs: 1,
    pingMs: 0.1,
    pingOk: true,
    pingError: null,
    latency: { last: 0.1, min: 0.1, avg: 0.1, max: 0.1, samples: 3 },
    ...over,
  };
}

const ids = (fs: { id: string }[]) => fs.map((f) => f.id);

describe("attributeBricks — au connecteur, jamais au moteur", () => {
  it("deux connecteurs du même moteur : la brique va à celui dont la cible est sa location", () => {
    const by = attributeBricks(
      [brick("tokens", "drizzle", FILE), brick("sessions", "drizzle", FILE)],
      [memoryDb, fileDb],
    );
    expect(by.get("default")?.map((b) => b.brick)).to.deep.equal([
      "tokens",
      "sessions",
    ]);
    expect(by.has("mediasoup")).to.equal(false);
  });

  it("entre plusieurs candidats, une brique sans location n'est attribuée à personne", () => {
    const by = attributeBricks(
      [brick("tokens", "drizzle")],
      [memoryDb, fileDb],
    );
    expect(by.size).to.equal(0);
  });

  it("un moteur à connecteur unique reçoit ses briques sans autre preuve", () => {
    const by = attributeBricks(
      [brick("tokens", "mongoose", "ailleurs"), brick("idem", "drizzle", FILE)],
      [mongo, fileDb],
    );
    expect(by.get("nodefony")?.map((b) => b.brick)).to.deep.equal(["tokens"]);
    expect(by.get("default")?.map((b) => b.brick)).to.deep.equal(["idem"]);
  });

  it("une brique résolue hors ORM (memory, redis) ne va à aucun connecteur", () => {
    const by = attributeBricks([brick("cache", "redis")], [fileDb]);
    expect(by.size).to.equal(0);
  });
});

describe("analyzeConnector — un verdict = une mesure", () => {
  it("un connecteur sain et sans mesure ne rend aucun verdict inventé", () => {
    expect(analyzeConnector({ orm: fileDb })).to.deep.equal([]);
  });

  it("déconnecté → critique, avec la dernière erreur", () => {
    const f = analyzeConnector({
      orm: { ...fileDb, connected: false },
      health: health({ lastError: { message: "ECONNREFUSED", ts: 1 } }),
    });
    expect(f[0].id).to.equal("disconnected");
    expect(f[0].level).to.equal("critical");
    expect(f[0].detail).to.contain("ECONNREFUSED");
  });

  it("des briques durables sur :memory: → critique ; sans brique → simple information", () => {
    const bad = analyzeConnector({
      orm: memoryDb,
      bricks: [brick("tokens", "drizzle", ":memory:")],
    });
    expect(ids(bad)).to.include("volatile-durable");
    expect(worstLevel(bad)).to.equal("critical");
    const fine = analyzeConnector({ orm: memoryDb, bricks: [] });
    expect(ids(fine)).to.deep.equal(["volatile"]);
    expect(worstLevel(fine)).to.equal("info");
  });

  it("une brique ÉPHÉMÈRE ne fait pas porter les stores", () => {
    const f = analyzeConnector({
      orm: fileDb,
      bricks: [brick("idempotency", "drizzle", FILE, "ephemeral")],
    });
    expect(ids(f)).to.deep.equal(["default-empty"]);
  });

  it("VACUUM : proposé au-dessus des deux seuils, jamais en dessous", () => {
    const storage = (freePages: number) =>
      health({
        storage: {
          pages: 52553,
          pageSize: 4096,
          freePages,
          journalMode: "wal",
        },
      });
    const big = analyzeConnector({ orm: fileDb, health: storage(37464) });
    expect(ids(big)).to.include("vacuum");
    expect(big.find((x) => x.id === "vacuum")?.title).to.contain("146");
    // 24 % libres : sous le ratio
    expect(
      ids(analyzeConnector({ orm: fileDb, health: storage(12600) })),
    ).to.not.include("vacuum");
  });

  it("journal non WAL sur fichier sqlite → information ; en mémoire → rien", () => {
    const h = health({ storage: { journalMode: "delete" } });
    expect(ids(analyzeConnector({ orm: fileDb, health: h }))).to.include(
      "journal-mode",
    );
    expect(ids(analyzeConnector({ orm: memoryDb, health: h }))).to.not.include(
      "journal-mode",
    );
  });

  it("table dominante : au-delà de 80 % ET de 10 000 lignes seulement", () => {
    const rows = (a: number, b: number) =>
      new Map([
        ["audit_event", a],
        ["User", b],
        ["totp_secret", 0],
        ["ghost", -1],
      ]);
    const f = analyzeConnector({ orm: fileDb, rows: rows(273830, 11) });
    expect(ids(f)).to.include.members([
      "dominant-table",
      "empty-tables",
      "uncountable",
    ]);
    expect(f.find((x) => x.id === "dominant-table")?.title).to.contain(
      "audit_event",
    );
    // Trop petite pour être un sujet
    expect(
      ids(analyzeConnector({ orm: fileDb, rows: rows(900, 10) })),
    ).to.not.include("dominant-table");
    // Grosse mais pas dominante
    expect(
      ids(analyzeConnector({ orm: fileDb, rows: rows(60000, 40000) })),
    ).to.not.include("dominant-table");
  });

  it("requêtes lentes : comptées, et les COUNT(*) nommés", () => {
    const f = analyzeConnector({
      orm: fileDb,
      slowMs: 50,
      flow: {
        connector: "default",
        total: 869,
        avgMs: 0.5,
        ewmaMs: 0.1,
        lastMs: 0.1,
        maxMs: 206,
        slowTotal: 2,
        slow: [
          { ts: 1, durationMs: 206, sql: 'select count(*) from "audit_event"' },
          { ts: 2, durationMs: 61, sql: "select id from access_token" },
        ],
      },
    });
    const slow = f.find((x) => x.id === "slow-queries");
    expect(slow?.level).to.equal("warning");
    expect(slow?.detail).to.contain("Dont 1 `COUNT(*)`");
  });

  it("flux coupé (production) → dit qu'il ne mesure pas, sans verdict de lenteur", () => {
    expect(
      ids(analyzeConnector({ orm: fileDb, flowEnabled: false })),
    ).to.deep.equal(["flow-disabled"]);
  });

  it("migrations : à jour → ok ; non configurées → info ; en retard → avertissement", () => {
    const status = (verdict: string) => ({
      formatVersion: 1,
      connector: "default",
      verdict,
      summary: verdict,
      nextActions: [{ command: "nodefony orm:migrate", args: [] }],
      sources: [],
      driver: { kind: "sql" },
    });
    expect(
      analyzeConnector({ orm: fileDb, migrations: status("up-to-date") })[0]
        .level,
    ).to.equal("ok");
    const late = analyzeConnector({
      orm: fileDb,
      migrations: status("pending"),
    })[0];
    expect(late.level).to.equal("warning");
    expect(late.command).to.equal("nodefony orm:migrate");
    const off = analyzeConnector({
      orm: memoryDb,
      migrations: {
        formatVersion: 1,
        connector: "mediasoup",
        error: {
          code: "NF_MIGRATE_NOT_CONFIGURED",
          summary: "pas déclaré",
          meaning: "",
          nextActions: [],
        },
      },
    });
    expect(off.find((x) => x.id === "migrations-unavailable")?.level).to.equal(
      "info",
    );
  });

  it("les verdicts sortent du plus grave au moins grave", () => {
    const f = analyzeConnector({
      orm: { ...fileDb, connected: false },
      health: health({ reconnectCount: 2 }),
      bricks: [brick("tokens", "drizzle", FILE)],
    });
    expect(f.map((x) => x.level)).to.deep.equal(["critical", "warning", "ok"]);
  });
});
