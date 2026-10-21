/// <reference types="node" />
import { describe, it, expect } from "vitest";
import {
  ADMIN_DEFAULT_ROLE,
  type IAdminApi,
  type IMcpCaller,
  type IMcpToolResult,
} from "nodefony";
import {
  N_PLUS_ONE_MIN_REPEATS,
  Profiler,
  type ProfileQuery,
} from "@nodefony/http";
import {
  observeTool,
  asProfilerReader,
  OBSERVE_MAX_SEC,
  type IObserveProbe,
} from "../nodefony/mcp/observe";
import {
  EVENT_LOOP_BLOCK_MS,
  renderProfileReport,
  SLOW_ROUTE_P95_MS,
  type RequestLogs,
} from "../nodefony/mcp/profileReport";
import { builtinMcpTools } from "../nodefony/mcp/tools";

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
  over: {
    route?: string;
    status?: number;
    url?: string;
    queries?: ProfileQuery[];
  } = {},
): void {
  seq += 1;
  profiler.collect({
    requestId: `obs-${seq}`,
    type: "http",
    scheme: "http",
    method: "GET",
    url: over.url ?? "/orders",
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
  const progress: {
    value: number;
    total?: number | undefined;
    message?: string | undefined;
  }[] = [];
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
        interrupted: false,
        errorLogs: null,
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

describe("nodefony_observe — journaux des erreurs et arrêt du serveur", () => {
  /** Lecteur factice : note QUAND et pour QUI il a été appelé. */
  function fakeReader(
    answer: (id: string) => RequestLogs = () => ({
      kind: "lines",
      lines: ["ERROR [http] boom"],
    }),
  ) {
    const calls: { id: string; at: number }[] = [];
    const t0 = performance.now();
    return {
      calls,
      read: async (id: string) => {
        calls.push({ id, at: performance.now() - t0 });
        return answer(id);
      },
    };
  }

  it("lit le journal d'une 5xx AU RELEVÉ qui la voit, et le joint au rapport", async () => {
    const profiler = new Profiler();
    const reader = fakeReader();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
      readRequestLogs: reader.read,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => collect(profiler, { status: 500 }), 50);
    const out = text(await pending);
    expect(reader.calls).toHaveLength(1);
    // Lu au premier relevé après l'erreur, pas en fin de fenêtre.
    expect(reader.calls[0]!.at).toBeLessThan(500);
    expect(out).toContain("journal ci-dessous");
    expect(out).toContain("Journal des requêtes en erreur");
    expect(out).toContain(`requestId ${reader.calls[0]!.id}`);
    expect(out).toContain("    ERROR [http] boom");
    expect(out).not.toContain("nodefony_admin_call");
  });

  it("dit qu'une ligne a été évincée, au lieu d'une liste vide muette", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
      readRequestLogs: fakeReader(() => ({ kind: "lines", lines: [] })).read,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => collect(profiler, { status: 500 }), 50);
    expect(text(await pending)).toContain(
      "aucune ligne retrouvée : déjà évincée",
    );
  });

  it("borne la lecture à dix erreurs, et ignore l'outillage écarté", async () => {
    const profiler = new Profiler();
    const reader = fakeReader();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
      readRequestLogs: reader.read,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => {
      collect(profiler, { status: 500, url: "/nodefony/profiler/api/recent" });
      for (let i = 0; i < 15; i++) collect(profiler, { status: 500 });
    }, 50);
    await pending;
    expect(reader.calls).toHaveLength(10);
  });

  it("ne lit pas le journal d'une erreur de l'outillage écartée", async () => {
    const profiler = new Profiler();
    const reader = fakeReader();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
      readRequestLogs: reader.read,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(
      () =>
        collect(profiler, {
          status: 500,
          url: "/nodefony/profiler/api/recent",
        }),
      50,
    );
    await pending;
    expect(reader.calls).toHaveLength(0);
  });

  it("sans lecteur, renvoie à nodefony_admin_call", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => collect(profiler, { status: 500 }), 50);
    expect(text(await pending)).toContain("nodefony_admin_call");
  });

  it("le serveur s'arrête : rapport partiel, et l'arrêt attend qu'il soit rendu", async () => {
    const profiler = new Profiler();
    let listener: (() => Promise<void>) | null = null;
    let unsubscribed = 0;
    // Un journal lent : le rapport ne peut partir qu'après lui — l'arrêt doit
    // donc ATTENDRE le rapport, et non un délai fixe.
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 50,
      createProbe: fakeProbe,
      readRequestLogs: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { kind: "lines", lines: ["ERROR [http] boom"] };
      },
      onShutdown: (l) => {
        listener = l;
        return () => {
          unsubscribed += 1;
        };
      },
    });
    const order: string[] = [];
    const started = performance.now();
    const pending = Promise.resolve(
      tool.handler({ durationSec: 30 }, CALLER, gate().run),
    ).then((r) => {
      order.push("rapport");
      return r;
    });
    setTimeout(() => collect(profiler, { status: 500 }), 20);
    let stopping: Promise<void> | undefined;
    setTimeout(() => {
      stopping = listener!().then(() => {
        order.push("arrêt repris");
      });
    }, 100);
    const out = text(await pending);
    await stopping;
    expect(performance.now() - started).toBeLessThan(1500);
    expect(out).toContain("observation interrompue");
    expect(out).toContain("le serveur s'arrête");
    expect(out).not.toContain("observation abandonnée");
    expect(order).toEqual(["rapport", "arrêt repris"]);
    expect(unsubscribed).toBe(1);
  });

  it("se désabonne de l'arrêt en fin d'appel normal", async () => {
    let unsubscribed = 0;
    const tool = observeTool({
      getProfiler: () => new Profiler(),
      tickMs: 100,
      createProbe: fakeProbe,
      onShutdown: () => () => {
        unsubscribed += 1;
      },
    });
    await tool.handler({ durationSec: 1 }, CALLER);
    expect(unsubscribed).toBe(1);
  });
});

describe("nodefony_observe — le journal lu par le plan d'administration", () => {
  const ADMIN: IMcpCaller = {
    authenticated: false,
    scopes: [],
    roles: [ADMIN_DEFAULT_ROLE],
  };

  /** Un syslog d'administration minimal, filtré par requestId comme le vrai. */
  function syslogBroker(rows: Record<string, unknown>[]) {
    return {
      list: (): readonly IAdminApi[] => [
        {
          adminNamespace: "syslog",
          adminDescriptor: () => ({ label: "Syslog" }),
          adminEndpoints: () => [
            {
              path: "logs",
              handler: (req) =>
                rows.filter((r) => r.requestId === req.query?.requestId),
            },
          ],
        },
      ],
    };
  }

  it("rend les lignes de la requête, dans l'ordre, par la même voie que admin_call", async () => {
    const profiler = new Profiler();
    // Forme RELEVÉE sur l'application : le texte vit dans `payload`, `msg` est
    // vide, `msgid` dit le contexte. Le driver rend les plus récentes d'abord.
    const broker = syslogBroker([
      {
        requestId: "obs-err",
        severity: 3,
        severityName: "ERROR",
        moduleName: "NODEFONY",
        msgid: "req",
        msg: "",
        payload: "GET 500 /orders 1.4ms [obs-err] Cannot read 'total'",
      },
      {
        requestId: "obs-err",
        severity: 7,
        severityName: "DEBUG",
        moduleName: "NODEFONY",
        msgid: "http RESPONSE ",
        msg: "",
        payload: "ADD COOKIE ==> nodefony=SECRET-DE-SESSION; Path=/",
      },
      {
        requestId: "obs-err",
        severity: 4,
        severityName: "WARNING",
        moduleName: "NODEFONY",
        msgid: "orm",
        msg: "",
        payload: { message: "requête lente sur orders" },
      },
      {
        requestId: "autre",
        severity: 3,
        severityName: "ERROR",
        moduleName: "NODEFONY",
        msgid: "req",
        msg: "",
        payload: "bruit",
      },
    ]);
    const tool = builtinMcpTools({
      broker,
      getCard: () => ({}),
      projectRoot: process.cwd(),
      getProfiler: () => profiler,
    }).observe;
    const pending = tool.handler({ durationSec: 1 }, ADMIN);
    setTimeout(() => {
      profiler.collect({
        requestId: "obs-err",
        type: "http",
        url: "/orders",
        response: { statusCode: 500 },
        phases: [],
        resolver: { route: { name: "orders.list" } },
      });
    }, 50);
    const out = text(await pending);
    expect(out).toContain(
      "    WARNING [orm] requête lente sur orders\n" +
        "    ERROR [req] GET 500 /orders 1.4ms [obs-err] Cannot read 'total'",
    );
    expect(out).not.toContain("bruit");
    // Le détail DEBUG — et la valeur de cookie qu'il porte — n'entre jamais
    // dans le contexte de l'agent.
    expect(out).not.toContain("SECRET-DE-SESSION");
    expect(out).not.toContain("DEBUG");
  });

  it("dit qu'une requête n'a que du détail, au lieu de « évincée »", async () => {
    const profiler = new Profiler();
    const tool = builtinMcpTools({
      broker: syslogBroker([
        {
          requestId: "obs-detail",
          severity: 7,
          severityName: "DEBUG",
          moduleName: "NODEFONY",
          msgid: "http",
          msg: "",
          payload: "EVENT CONTEXT onSaveSession",
        },
      ]),
      getCard: () => ({}),
      projectRoot: process.cwd(),
      getProfiler: () => profiler,
    }).observe;
    const pending = tool.handler({ durationSec: 1 }, ADMIN);
    setTimeout(() => {
      profiler.collect({
        requestId: "obs-detail",
        type: "http",
        url: "/orders",
        response: { statusCode: 500 },
        phases: [],
        resolver: { route: { name: "orders.list" } },
      });
    }, 50);
    const out = text(await pending);
    expect(out).toContain(
      "1 ligne(s) de détail écartée(s), aucune de niveau WARNING ou plus grave",
    );
    expect(out).not.toContain("évincée");
  });

  it("un appelant à qui le journal est fermé : la raison, pas une liste vide", async () => {
    const profiler = new Profiler();
    const tool = builtinMcpTools({
      broker: syslogBroker([]),
      getCard: () => ({}),
      projectRoot: process.cwd(),
      getProfiler: () => profiler,
    }).observe;
    const pending = tool.handler({ durationSec: 1 }, CALLER);
    setTimeout(() => {
      for (const requestId of ["obs-closed-1", "obs-closed-2"]) {
        profiler.collect({
          requestId,
          type: "http",
          url: "/orders",
          response: { statusCode: 500 },
          phases: [],
          resolver: { route: { name: "orders.list" } },
        });
      }
    }, 50);
    const out = text(await pending);
    expect(out).toContain(
      "Journal des requêtes en erreur : non lu — journal réservé aux appelants authentifiés",
    );
    expect(out).toContain("security:mcp:token --write");
    // Dite UNE fois, pas une par requête.
    expect(out.match(/réservé aux appelants/g)).toHaveLength(1);
  });
});

describe("nodefony_observe — producteur syslog absent", () => {
  it("dit que le producteur manque, pas qu'il est fermé", async () => {
    const profiler = new Profiler();
    const tool = builtinMcpTools({
      broker: { list: () => [] },
      getCard: () => ({}),
      projectRoot: process.cwd(),
      getProfiler: () => profiler,
    }).observe;
    const pending = tool.handler({ durationSec: 1 }, CALLER);
    setTimeout(() => {
      profiler.collect({
        requestId: "obs-nosyslog",
        type: "http",
        url: "/orders",
        response: { statusCode: 500 },
        phases: [],
        resolver: { route: { name: "orders.list" } },
      });
    }, 50);
    const out = text(await pending);
    expect(out).toContain(
      "le producteur `syslog` du plan d'administration n'est pas chargé",
    );
    expect(out).not.toContain("réservé aux appelants");
  });
});

describe("nodefony_observe — lisibilité du journal", () => {
  it("montre le journal de trois requêtes par route, pas plus", async () => {
    const profiler = new Profiler();
    const tool = observeTool({
      getProfiler: () => profiler,
      tickMs: 100,
      createProbe: fakeProbe,
      readRequestLogs: async () => ({
        kind: "lines",
        lines: ["ERROR [req] boom"],
      }),
    });
    const pending = tool.handler({ durationSec: 1 }, CALLER, gate().run);
    setTimeout(() => {
      for (let i = 0; i < 6; i++) collect(profiler, { status: 500 });
    }, 50);
    const out = text(await pending);
    expect(out.match(/ERROR \[req\] boom/g)).toHaveLength(3);
  });
});

describe("nodefony_observe — la description publiée", () => {
  it("cite les seuils RÉELS du code, et le protocole complet", () => {
    const d = observeTool({ getProfiler: () => undefined }).description;
    expect(d).toContain(`au moins ${N_PLUS_ONE_MIN_REPEATS} fois`);
    expect(d).toContain(`p95 ≥ ${SLOW_ROUTE_P95_MS} ms`);
    expect(d).toContain(`synchrone de ${EVENT_LOOP_BLOCK_MS} ms`);
    expect(d).toContain(`max ${OBSERVE_MAX_SEC}`);
    // Les trois gestes que l'agent ne devinerait pas.
    expect(d).toContain("n'en génère AUCUNE");
    expect(d).toContain("Ne modifier AUCUN fichier pendant la fenêtre");
    expect(d).toContain("comparer le bloc « Données (JSON) »");
  });
});
