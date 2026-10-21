/// <reference types="node" />
import { describe, it, expect } from "vitest";
import type { IMcpCaller, IMcpToolResult } from "nodefony";
import { Profiler, type ProfileQuery } from "@nodefony/http";
import {
  observeTool,
  asProfilerReader,
  type IObserveProbe,
} from "../nodefony/mcp/observe";
import { renderProfileReport } from "../nodefony/mcp/profileReport";

const CALLER: IMcpCaller = { authenticated: false, scopes: [], roles: [] };

/** Sonde du process factice : compte ses libérations. */
function fakeProbe(): IObserveProbe & { disposed: number } {
  return {
    disposed: 0,
    read: () => ({ eventLoopMs: 1, eventLoopMaxMs: 2, heapUsed: 1_000_000 }),
    dispose() {
      this.disposed += 1;
    },
  };
}

let seq = 0;

/** Ce que le pipeline remet au profileur en fin de requête. */
function collect(
  profiler: Profiler,
  over: { route?: string; status?: number; queries?: ProfileQuery[] } = {},
): void {
  seq += 1;
  profiler.collect({
    requestId: `obs-${seq}`,
    type: "http",
    scheme: "http",
    method: "GET",
    url: "/orders",
    response: { statusCode: over.status ?? 200 },
    phases: [{ name: "action", startMs: 0, durationMs: 12 }],
    resolver: {
      route: { name: over.route ?? "orders.list" },
      controller: { name: "OrdersController" },
      actionName: "list",
    },
    profilerQueries: over.queries,
  });
}

function text(result: IMcpToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

/** Un appel « par la porte » : progression enregistrée, annulation pilotable. */
function gate() {
  const controller = new AbortController();
  const progress: { value: number; total?: number; message?: string }[] = [];
  return {
    controller,
    progress,
    run: {
      signal: controller.signal,
      progress(value: number, total?: number, message?: string) {
        progress.push({ value, total, message });
      },
    },
  };
}

describe("nodefony_observe — observer l'application qui tourne", () => {
  it("signale un N+1 : la même requête SQL répétée 10 fois dans une requête", async () => {
    const profiler = new Profiler();
    collect(profiler); // AVANT l'observation : ne doit pas compter
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 50,
      createProbe: fakeProbe,
    });
    const g = gate();
    const pending = tool.handler({ durationSec: 1 }, CALLER, g.run);
    setTimeout(() => {
      collect(profiler, {
        queries: Array.from({ length: 10 }, (_, i) => ({
          sql: `select * from "items" where "order_id" = ${i}`,
          startMs: 1 + i,
          durationMs: 0.3,
          connector: "drizzle",
        })),
      });
      collect(profiler);
    }, 100);
    const out = text(await pending);
    expect(out).toMatch(/^Verdict : anomalies \(1\)/);
    expect(out).toContain("N+1 — route `orders.list` (OrdersController.list)");
    expect(out).toContain('`select * from "items" where "order_id" = ?`');
    expect(out).toContain("×10");
    expect(out).toContain("2 requête(s) (2 HTTP");
  });

  it("envoie au moins une progression par relevé, en valeurs croissantes", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 200,
      createProbe: fakeProbe,
    });
    const g = gate();
    await tool.handler({ durationSec: 1 }, CALLER, g.run);
    // Un départ + un par relevé (5 relevés de 200 ms dans 1 s).
    expect(g.progress.length).toBeGreaterThanOrEqual(5);
    expect(g.progress[0]!.message).toContain("observation démarrée");
    for (let i = 1; i < g.progress.length; i++) {
      expect(g.progress[i]!.value).toBeGreaterThan(g.progress[i - 1]!.value);
      expect(g.progress[i]!.total).toBe(1);
    }
    expect(g.progress.at(-1)!.message).toMatch(/^t=\d+\/1 s — 0 requête/);
  });

  it("s'arrête quand l'agent abandonne l'appel, et libère sa sonde", async () => {
    const profiler = new Profiler();
    const probe = fakeProbe();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 200,
      createProbe: () => probe,
    });
    const g = gate();
    const started = performance.now();
    setTimeout(() => g.controller.abort(), 100);
    const out = text(await tool.handler({ durationSec: 30 }, CALLER, g.run));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toContain("observation abandonnée");
    expect(out).toContain("observation INCOMPLÈTE");
    expect(probe.disposed).toBe(1);
  });

  it("annonce les profils perdus au lieu de les taire", async () => {
    const profiler = new Profiler(4);
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 300,
      createProbe: fakeProbe,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => {
      for (let i = 0; i < 10; i++) collect(profiler);
    }, 50);
    const out = text(await pending);
    expect(out).toContain("6 profil(s) perdu(s) avant lecture");
    expect(out).toContain("observation INCOMPLÈTE");
  });

  it("se restreint à une route nommée", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
    });
    const pending = tool.handler(
      { durationSec: 1, route: "home" },
      CALLER,
      gate().run,
    );
    setTimeout(() => {
      collect(profiler, { route: "home" });
      collect(profiler);
      collect(profiler);
    }, 50);
    const out = text(await pending);
    expect(out).toContain("1 requête(s) (1 HTTP");
    expect(out).toContain(
      "restreinte à la route `home` (2 autre(s) écartée(s))",
    );
  });

  it("met les refus 401 à part, hors percentiles", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => {
      collect(profiler, { status: 401 });
      collect(profiler, { status: 401 });
    }, 50);
    const out = text(await pending);
    expect(out).toContain("Refus (hors percentiles) : `orders.list` 401×2");
  });

  it("dit que rien n'a été observé quand l'application n'a reçu aucun trafic", async () => {
    const tool = observeTool({
      getProfiler: () => new Profiler(),
      tickMs: 100,
      createProbe: fakeProbe,
    });
    const out = text(await tool.handler({ durationSec: 1 }, CALLER));
    expect(out).toMatch(/^Verdict : rien à juger — observation INCOMPLÈTE/);
    expect(out).toContain("cet outil n'en génère pas");
  });

  it("borne la fenêtre demandée, et le dit", async () => {
    const tool = observeTool({
      getProfiler: () => new Profiler(),
      tickMs: 50,
      createProbe: fakeProbe,
    });
    const g = gate();
    setTimeout(() => g.controller.abort(), 100);
    const out = text(await tool.handler({ durationSec: 600 }, CALLER, g.run));
    expect(out).toContain("durationSec ramenée à 50 s");
  });

  it("signale un blocage de la boucle que la moyenne noierait", async () => {
    const tool = observeTool({
      getProfiler: () => new Profiler(),
      tickMs: 100,
      createProbe: () => ({
        read: () => ({ eventLoopMs: 2, eventLoopMaxMs: 150, heapUsed: 1 }),
        dispose() {},
      }),
    });
    const out = text(await tool.handler({ durationSec: 1 }, CALLER));
    expect(out).toContain("pire blocage 150 ms");
    expect(out).toContain(
      "Boucle d'événements bloquée — jusqu'à 150 ms d'un tenant",
    );
  });

  it("ne signale pas une boucle dont le pire blocage reste sous le seuil", async () => {
    const tool = observeTool({
      getProfiler: () => new Profiler(),
      tickMs: 100,
      createProbe: fakeProbe,
    });
    const out = text(await tool.handler({ durationSec: 1 }, CALLER));
    expect(out).toContain("retard moyen 1.0 ms, pire blocage 2.0 ms");
    expect(out).not.toContain("bloquée");
  });

  it("répond en isError quand l'application n'a pas de profileur", async () => {
    const tool = observeTool({ getProfiler: () => undefined });
    const result = await tool.handler({}, CALLER);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Aucun profileur");
  });

  it("reconnaît un profileur par sa forme, et rien d'autre", () => {
    const profiler = new Profiler();
    expect(asProfilerReader(profiler)).toBe(profiler);
    expect(asProfilerReader({ cursor: 0 })).toBeUndefined();
    expect(asProfilerReader(null)).toBeUndefined();
  });
});

describe("renderProfileReport — ce qui se dit « par requête »", () => {
  it("divise par les requêtes SERVIES, jamais par les refus", () => {
    const text = renderProfileReport(
      {
        requests: 10,
        http: 10,
        ws: 0,
        filteredTooling: 0,
        untimed: 0,
        routes: [
          {
            route: "orders.list",
            kind: "http",
            controller: "OrdersController",
            action: "list",
            count: 10,
            untimed: 0,
            served: 1,
            p50Ms: 100,
            p95Ms: 100,
            maxMs: 100,
            status: {
              s2xx: 1,
              s3xx: 0,
              s4xx: 9,
              s5xx: 0,
              unauthorized: 9,
              forbidden: 0,
            },
            errors: 0,
            queries: { total: 2, perRequestMax: 2, totalMs: 10 },
            phases: {
              action: { totalMs: 100, count: 1 },
              "action.self": { totalMs: 90, count: 1 },
            },
          },
        ],
        nPlusOne: [],
        slowQueries: [],
        sqlShapesDropped: 0,
        errors: [],
      },
      {
        windowMs: 1000,
        elapsedMs: 1000,
        ticks: 1,
        lost: 0,
        cancelled: false,
        route: null,
        filteredRoute: 0,
        pid: 1,
        uptimeSec: 1,
        eventLoop: null,
        heapDeltaBytes: null,
      },
    );
    expect(text).toContain("action.self 90 ms · SQL (cumul) 10 ms");
    expect(text).toContain("| 2.0/2 |");
    expect(text).toContain('"sqlPerReq":2');
    expect(text).toContain('"actionSelfMs":90');
  });
});
