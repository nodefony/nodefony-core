/// <reference types="node" />
import { expect } from "vitest";
import {
  aggregateProfiles,
  createProfileAggregator,
  sqlShape,
  ACTION_SELF_PHASE,
  NO_ROUTE,
  ROUTE_SAMPLE_CAP,
} from "../../src/profiler/aggregate.js";
import type {
  ProfileEntry,
  ProfileQuery,
} from "../../src/profiler/Profiler.js";

let seq = 0;

/** Profil minimal : une requête GET servie par `orders.list` en 10 ms. */
function entry(over: Partial<ProfileEntry> = {}): ProfileEntry {
  seq += 1;
  return {
    requestId: `req-${seq}`,
    seq,
    ts: 0,
    kind: "http",
    method: "GET",
    url: "/orders",
    scheme: "http",
    status: 200,
    durationMs: 10,
    route: "orders.list",
    controller: "OrdersController",
    action: "list",
    remoteAddress: "127.0.0.1",
    user: null,
    traceparent: null,
    error: null,
    phases: [],
    ...over,
  };
}

function query(sql: string, startMs: number, durationMs: number): ProfileQuery {
  return { sql, startMs, durationMs, connector: "drizzle" };
}

describe("sqlShape — forme d'une requête", () => {
  it("remplace les valeurs SQL par ?", () => {
    expect(
      sqlShape("select * from orders where user_id = 42 and name = 'O''Brien'"),
    ).to.equal("select * from orders where user_id = ? and name = ?");
  });

  it("garde les identifiants qui contiennent des chiffres", () => {
    expect(sqlShape('select "t1"."col2" from t1 where x = 3')).to.equal(
      'select "t1"."col2" from t1 where x = ?',
    );
  });

  it("replie les paramètres numérotés et les listes IN de toute longueur", () => {
    const a = sqlShape("select * from u where id in ($1, $2, $3)");
    const b = sqlShape("select * from u where id in (?)");
    expect(a).to.equal("select * from u where id in (?…)");
    expect(b).to.equal(a);
  });

  it("replie les VALUES d'une insertion multiple", () => {
    expect(
      sqlShape("insert into t (a, b) values (?, ?), (?, ?), (?, ?)"),
    ).to.equal("insert into t (a, b) values (…)");
  });

  it("masque les valeurs d'un descripteur mongoose", () => {
    expect(
      sqlShape('User.find {"email":"a@b.c","age":31,"tags":{"$in":["x","y"]}}'),
    ).to.equal('User.find {"email":?,"age":?,"tags":{"$in":[?…]}}');
  });

  it("compacte les blancs", () => {
    expect(sqlShape("select  *\n  from t\twhere a = ?")).to.equal(
      "select * from t where a = ?",
    );
  });
});

describe("createProfileAggregator — rapport", () => {
  it("détecte un N+1 : même forme répétée 10 fois dans une requête", () => {
    const queries = Array.from({ length: 10 }, (_, i) =>
      query(`select * from items where order_id = ${i + 1}`, 2 + i, 0.5),
    );
    const report = aggregateProfiles([
      entry({ queries }),
      entry({ queries: [query("select * from orders", 1, 1)] }),
    ]);
    expect(report.nPlusOne).to.have.length(1);
    const n1 = report.nPlusOne[0]!;
    expect(n1.shape).to.equal("select * from items where order_id = ?");
    expect(n1.maxRepeats).to.equal(10);
    expect(n1.requests).to.equal(1);
    expect(n1.route).to.equal("orders.list");
    expect(n1.controller).to.equal("OrdersController");
    expect(n1.action).to.equal("list");
    expect(n1.sampleRequestId).to.match(/^req-/);
  });

  it("ne signale pas une forme répétée sous le seuil", () => {
    const queries = Array.from({ length: 4 }, (_, i) =>
      query(`select * from items where id = ${i}`, i, 0.1),
    );
    expect(aggregateProfiles([entry({ queries })]).nPlusOne).to.have.length(0);
  });

  it("le seuil N+1 se règle", () => {
    const queries = Array.from({ length: 3 }, (_, i) =>
      query(`select * from items where id = ${i}`, i, 0.1),
    );
    const report = aggregateProfiles([entry({ queries })], {
      nPlusOneMinRepeats: 3,
    });
    expect(report.nPlusOne).to.have.length(1);
  });

  it("calcule p50/p95/max par route et trie par p95 décroissant", () => {
    const entries = [
      ...Array.from({ length: 100 }, (_, i) => entry({ durationMs: i + 1 })),
      entry({ route: "home", durationMs: 1000 }),
    ];
    const report = aggregateProfiles(entries);
    expect(report.routes.map((r) => r.route)).to.deep.equal([
      "home",
      "orders.list",
    ]);
    const orders = report.routes[1]!;
    expect(orders.count).to.equal(100);
    expect(orders.p50Ms).to.equal(50);
    expect(orders.p95Ms).to.equal(95);
    expect(orders.maxMs).to.equal(100);
  });

  it("répartit les statuts et met 401/403 à part", () => {
    const report = aggregateProfiles([
      entry({ status: 200 }),
      entry({ status: 302 }),
      entry({ status: 401 }),
      entry({ status: 403 }),
      entry({ status: 404 }),
      entry({ status: 500, error: "boom" }),
    ]);
    const s = report.routes[0]!.status;
    expect(s).to.deep.equal({
      s2xx: 1,
      s3xx: 1,
      s4xx: 3,
      s5xx: 1,
      unauthorized: 1,
      forbidden: 1,
    });
    expect(report.routes[0]!.errors).to.equal(1);
    expect(report.errors).to.have.length(1);
    expect(report.errors[0]!.error).to.equal("boom");
  });

  it("compte les requêtes SQL par requête (total, max, temps)", () => {
    const report = aggregateProfiles([
      entry({ queries: [query("select 1", 0, 1), query("select 2", 1, 2)] }),
      entry({ queries: [query("select 3", 0, 4)] }),
      entry(),
    ]);
    expect(report.routes[0]!.queries).to.deep.equal({
      total: 3,
      perRequestMax: 2,
      totalMs: 7,
    });
  });

  it("isole le temps propre de l'action (hors phases imbriquées et SQL)", () => {
    // action 100→150 (50 ms) ; initialize 100→105 ; render 140→148 ;
    // SQL 110→120 et 145→147 (cette dernière pendant le rendu : comptée une fois).
    const e = entry({
      phases: [
        { name: "resolve", startMs: 90, durationMs: 5 },
        { name: "action", startMs: 100, durationMs: 50 },
        { name: "initialize", startMs: 100, durationMs: 5 },
        { name: "render", startMs: 140, durationMs: 8 },
      ],
      queries: [query("select a", 110, 10), query("select b", 145, 2)],
    });
    const phases = aggregateProfiles([e]).routes[0]!.phases;
    expect(phases[ACTION_SELF_PHASE]).to.deep.equal({ totalMs: 27, count: 1 });
    expect(phases.action).to.deep.equal({ totalMs: 50, count: 1 });
    expect(phases.resolve).to.deep.equal({ totalMs: 5, count: 1 });
  });

  it("écarte l'outillage par défaut, et le compte", () => {
    const entries = [
      entry(),
      entry({ url: "/nodefony/mcp", route: "devkit-mcp" }),
      entry({ url: "/nodefony/profiler/api/recent" }),
    ];
    const report = aggregateProfiles(entries);
    expect(report.requests).to.equal(1);
    expect(report.filteredTooling).to.equal(2);
    const all = aggregateProfiles(entries, { includeTooling: true });
    expect(all.requests).to.equal(3);
  });

  it("regroupe les requêtes sans route, et sépare HTTP et WebSocket", () => {
    const report = aggregateProfiles([
      entry({ route: null, status: 404 }),
      entry({ route: null, status: 404, url: "/autre" }),
      entry({ kind: "ws" }),
    ]);
    expect(report.http).to.equal(2);
    expect(report.ws).to.equal(1);
    const keys = report.routes.map((r) => `${r.kind}:${r.route}`).sort();
    expect(keys).to.deep.equal([`http:${NO_ROUTE}`, "ws:orders.list"]);
  });

  it("calcule les percentiles sur les seules requêtes servies", () => {
    const report = aggregateProfiles([
      entry({ durationMs: 40 }),
      entry({ durationMs: 40 }),
      entry({ status: 401, durationMs: 2 }),
      entry({ status: 404, durationMs: 1 }),
      entry({ status: 500, error: "boom", durationMs: 5 }),
    ]);
    const r = report.routes[0]!;
    expect(r.count).to.equal(5);
    expect(r.p50Ms).to.equal(40);
    expect(r.maxMs).to.equal(40);
  });

  it("dit les requêtes sans durée au lieu d'en faire des 0 ms", () => {
    const report = aggregateProfiles([entry({ durationMs: null })]);
    expect(report.untimed).to.equal(1);
    expect(report.routes[0]!.p95Ms).to.equal(null);
  });

  it("borne l'échantillon de durées d'une route", () => {
    const agg = createProfileAggregator({ random: () => 0.999 });
    for (let i = 0; i < ROUTE_SAMPLE_CAP * 4; i++) {
      agg.add(entry({ durationMs: i < ROUTE_SAMPLE_CAP ? 1 : 1000 }));
    }
    const r = agg.result().routes[0]!;
    expect(r.count).to.equal(ROUTE_SAMPLE_CAP * 4);
    // Aléa ≈ 1 : aucune durée tardive ne remplace l'échantillon.
    expect(r.p95Ms).to.equal(1);
    expect(r.maxMs).to.equal(1000);
  });

  it("result() est un instantané : l'accumulateur continue", () => {
    const agg = createProfileAggregator();
    agg.add(entry());
    const first = agg.result();
    agg.add(entry());
    expect(first.requests).to.equal(1);
    expect(agg.result().requests).to.equal(2);
  });
});
