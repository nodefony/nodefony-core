/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import {
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
  type IMcpCaller,
  type IMcpToolResult,
} from "nodefony";
import { Profiler, type ProfileQuery } from "@nodefony/http";
import {
  checkProfilePath,
  PROFILE_ROUTE_MAX_COUNT,
  profileRouteTool,
  type IProfileRouteDeps,
} from "../nodefony/mcp/profileRoute";
import {
  readShotTarget,
  type IShotClient,
  type IShotRequest,
  type IShotTarget,
} from "../nodefony/mcp/shotClient";
import {
  PROFILE_TICKET_HEADER,
  ProfileTicketStore,
} from "../nodefony/src/profileTicket";
import {
  openProfileSession,
  PROFILE_SESSION_PATH,
} from "../nodefony/src/profileSession";

const TARGET: IShotTarget = {
  host: "127.0.0.1",
  port: 5151,
  hostHeader: "127.0.0.1:5151",
};

const ANONYMOUS: IMcpCaller = { authenticated: false, scopes: [], roles: [] };
const READER: IMcpCaller = {
  authenticated: true,
  subject: "alice",
  scopes: [ADMIN_SCOPE_READ],
  roles: [],
};
const WRITER: IMcpCaller = {
  authenticated: true,
  subject: "alice",
  scopes: [ADMIN_SCOPE_READ, ADMIN_SCOPE_WRITE],
  roles: [],
};

function text(result: IMcpToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

/**
 * L'application, jouée par le client du tir : chaque GET est profilé sous
 * l'identifiant reçu (comme le pipeline le fait du x-request-id), le POST de
 * connexion passe par la VRAIE décision de la route et le VRAI magasin.
 */
function fakeApp(
  opts: {
    status?: (req: IShotRequest) => number;
    /** Délai de collecte du profil ; `null` = jamais collecté. */
    collectDelayMs?: number | null;
    slowMs?: number;
    queries?: ProfileQuery[];
  } = {},
) {
  const profiler = new Profiler();
  const tickets = new ProfileTicketStore();
  const sent: IShotRequest[] = [];
  const closedSessions: string[] = [];
  const state = { inFlight: 0, maxInFlight: 0, closed: false };
  const collect = (id: string, status: number, req: IShotRequest): void => {
    profiler.collect({
      requestId: id,
      type: "http",
      scheme: "http",
      method: req.method,
      url: `http://127.0.0.1:5151${req.path}`,
      response: { statusCode: status },
      phases: [{ name: "action", startMs: 0, durationMs: 12 }],
      resolver: {
        route: { name: "orders.list" },
        controller: { name: "OrdersController" },
        actionName: "list",
      },
      profilerQueries: opts.queries,
    });
  };
  const client: IShotClient = {
    async send(req, signal) {
      sent.push(req);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (opts.slowMs !== undefined)
          await delay(opts.slowMs, undefined, { signal });
        else await delay(0);
        if (req.method === "POST") {
          const verdict = await openProfileSession(
            {
              ticket: req.headers[PROFILE_TICKET_HEADER],
              remoteAddress: "127.0.0.1",
            },
            {
              tickets,
              establish: async (identifier) => ({
                identifier,
                roles: ["ROLE_USER"],
              }),
              sessionRef: () => "sess_test",
            },
          );
          return {
            status: verdict.status,
            location: null,
            setCookie:
              verdict.status === 200
                ? ["nodefony=s3cr3t; Path=/; HttpOnly"]
                : [],
            body: JSON.stringify(verdict),
          };
        }
        const status = opts.status?.(req) ?? 200;
        const id = req.headers["x-request-id"] ?? "";
        if (opts.collectDelayMs === undefined) collect(id, status, req);
        else if (opts.collectDelayMs !== null) {
          setTimeout(() => collect(id, status, req), opts.collectDelayMs);
        }
        return {
          status,
          location: status >= 300 && status < 400 ? "/login" : null,
          setCookie: [],
          body: null,
        };
      } finally {
        state.inFlight -= 1;
      }
    },
    close() {
      state.closed = true;
    },
  };
  const deps = (over: Partial<IProfileRouteDeps> = {}): IProfileRouteDeps => ({
    getProfiler: () => profiler,
    getTarget: () => TARGET,
    createClient: () => client,
    createProbe: () => ({
      read: () => ({ eventLoopMs: 0.4, eventLoopMaxMs: 2, heapUsed: 0 }),
      dispose: () => undefined,
    }),
    issueTicket: (identifier) => tickets.issue(identifier),
    closeSession: async (ref) => {
      closedSessions.push(ref);
    },
    rolesWithin: async () => ({ ok: true }),
    collectWaitMs: 200,
    ...over,
  });
  const shots = () => sent.filter((r) => r.method !== "POST");
  return { profiler, tickets, sent, shots, closedSessions, state, deps };
}

async function call(
  deps: IProfileRouteDeps,
  args: Record<string, unknown>,
  caller: IMcpCaller = ANONYMOUS,
  run?: {
    signal: AbortSignal;
    progress: (v: number, t?: number, m?: string) => void;
  },
): Promise<IMcpToolResult> {
  return profileRouteTool(deps).handler(args, caller, run);
}

describe("checkProfilePath — l'outil ne vise que l'application", () => {
  it.each([
    ["URL absolue", "http://ailleurs/x"],
    ["schéma relatif", "//ailleurs/x"],
    ["antislash", "/\\ailleurs/x"],
    ["espace", "/a b"],
    ["retour à la ligne", "/a\r\nHost: x"],
    ["sans barre initiale", "orders"],
    ["vide", ""],
    ["pas une chaîne", 42],
  ])("refuse : %s", (_label, path) => {
    expect(checkProfilePath(path).ok).toBe(false);
  });

  it("accepte un chemin avec sa requête, et retire le fragment", () => {
    expect(checkProfilePath("/orders?page=2#top")).toEqual({
      ok: true,
      path: "/orders?page=2",
    });
  });
});

describe("nodefony_profile_route — le tir", () => {
  it("🔴 un chemin `http://ailleurs/…` est refusé en isError, sans une requête envoyée", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), { path: "http://ailleurs/x" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/CHEMIN/u);
    expect(app.sent).toHaveLength(0);
  });

  it("🔴 count 10 rend 10 profils retrouvés par l'identifiant posé", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), {
      path: "/orders",
      count: 10,
      warmup: 0,
    });
    expect(result.isError).toBeFalsy();
    const ids = app.shots().map((r) => r.headers["x-request-id"]);
    expect(new Set(ids).size).toBe(10);
    expect(text(result)).toMatch(/Tir : 10\/10 requête\(s\) GET \/orders/u);
    expect(text(result)).toMatch(
      /`orders\.list` \(OrdersController\.list\) \| http \| 10 \|/u,
    );
  });

  it("le lot de chauffe est tiré AVANT et reste hors des mesures", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), {
      path: "/orders",
      count: 5,
      warmup: 3,
    });
    expect(app.shots()).toHaveLength(8);
    expect(app.shots()[0]?.headers["x-request-id"]).toMatch(/-w1$/u);
    expect(text(result)).toMatch(/chauffe de 3 requête\(s\) hors mesures/u);
    expect(text(result)).toMatch(/\| http \| 5 \|/u);
  });

  it("un profil collecté APRÈS la réponse est attendu et retrouvé", async () => {
    const app = fakeApp({ collectDelayMs: 30 });
    const result = await call(app.deps(), {
      path: "/orders",
      count: 4,
      warmup: 0,
    });
    expect(text(result)).not.toMatch(/non retrouvé/u);
    expect(text(result)).toMatch(/\| http \| 4 \|/u);
  });

  it("un profil jamais collecté est COMPTÉ et dit, pas ignoré", async () => {
    const app = fakeApp({ collectDelayMs: null });
    const result = await call(app.deps({ collectWaitMs: 20 }), {
      path: "/orders",
      count: 3,
      warmup: 0,
    });
    expect(text(result)).toMatch(
      /3 réponse\(s\) reçue\(s\) dont le profil n'a pas été retrouvé/u,
    );
  });

  it("concurrency est respectée : jamais plus de requêtes en vol", async () => {
    const app = fakeApp({ slowMs: 5 });
    await call(app.deps(), {
      path: "/orders",
      count: 20,
      concurrency: 3,
      warmup: 0,
    });
    expect(app.state.maxInFlight).toBe(3);
  });

  it("les bornes corrigent et le DISENT", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), {
      path: "/orders",
      count: 999,
      warmup: 0,
    });
    expect(app.shots()).toHaveLength(PROFILE_ROUTE_MAX_COUNT);
    expect(text(result)).toMatch(/count ramené à 200/u);
  });

  it("POST est refusé : GET et HEAD seulement", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), { path: "/orders", method: "POST" });
    expect(result.isError).toBe(true);
    expect(app.sent).toHaveLength(0);
  });

  it("le client du tir est fermé, quoi qu'il arrive", async () => {
    const app = fakeApp();
    await call(app.deps(), { path: "/orders", count: 2, warmup: 0 });
    expect(app.state.closed).toBe(true);
  });

  it("une progression par lot, croissante, jusqu'au total", async () => {
    const app = fakeApp();
    const progress: number[] = [];
    await call(
      app.deps(),
      { path: "/orders", count: 20, warmup: 0 },
      ANONYMOUS,
      {
        signal: new AbortController().signal,
        progress: (v) => progress.push(v),
      },
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(20);
    expect(progress.length).toBeLessThanOrEqual(12);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("budget épuisé : le tir s'arrête et le rapport le dit", async () => {
    const app = fakeApp({ slowMs: 20 });
    const result = await call(app.deps({ budgetMs: 50 }), {
      path: "/orders",
      count: 50,
      concurrency: 1,
      warmup: 0,
    });
    expect(text(result)).toMatch(/tir arrêté au bout de/u);
  });

  it("🔴 tir trop court pour la sonde : boucle « non mesurée », jamais un 0 trompeur", async () => {
    const app = fakeApp();
    const out = text(
      await call(app.deps(), { path: "/orders", count: 2, warmup: 0 }),
    );
    expect(out).toMatch(/boucle d'événements : non mesurée/u);
    expect(out).not.toMatch(/pire blocage/u);
  });

  it("tir assez long : la sonde est lue, et la durée sous la seconde s'écrit en ms", async () => {
    const app = fakeApp({ slowMs: 15 });
    const out = text(
      await call(app.deps(), {
        path: "/orders",
        count: 10,
        concurrency: 1,
        warmup: 0,
      }),
    );
    expect(out).toMatch(/retard moyen 0\.4 ms, pire blocage 2\.0 ms/u);
    expect(out).toMatch(/concurrence 1 · \d+ ms ·/u);
  });

  it("aucun profileur, ou aucun serveur : isError, rien d'envoyé", async () => {
    const app = fakeApp();
    expect(
      (await call(app.deps({ getProfiler: () => undefined }), { path: "/" }))
        .isError,
    ).toBe(true);
    expect(
      (await call(app.deps({ getTarget: () => null }), { path: "/" })).isError,
    ).toBe(true);
    expect(app.sent).toHaveLength(0);
  });
});

describe("nodefony_profile_route — au nom de qui", () => {
  it("sans jeton : anonyme, la raison dite, aucune session ouverte", async () => {
    const app = fakeApp();
    const result = await call(app.deps(), {
      path: "/orders",
      count: 2,
      warmup: 0,
    });
    expect(text(result)).toMatch(
      /Joué en tant que : anonyme \(appel sans jeton MCP\)/u,
    );
    expect(app.sent.some((r) => r.method === "POST")).toBe(false);
  });

  it("🔴 jeton admin:read seulement : anonyme — un jeton de lecture n'ouvre pas de session", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", count: 2, warmup: 0 },
      READER,
    );
    expect(text(result)).toMatch(
      /anonyme \(le jeton MCP n'a pas le scope admin:write\)/u,
    );
    expect(app.sent.some((r) => r.method === "POST")).toBe(false);
  });

  it("🔴 jeton admin:write : session du PROPRIÉTAIRE, cookie sur chaque requête, détruite à la fin", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", count: 3, warmup: 1 },
      WRITER,
    );
    const login = app.sent[0];
    expect(login?.path).toBe(PROFILE_SESSION_PATH);
    for (const shot of app.shots())
      expect(shot.headers.cookie).toBe("nodefony=s3cr3t");
    expect(text(result)).toMatch(/Joué en tant que : `alice` \(ROLE_USER\)/u);
    expect(app.closedSessions).toEqual(["sess_test"]);
    expect(app.tickets.pending).toBe(0);
  });

  it("le cookie de session n'apparaît JAMAIS dans le rapport rendu à l'agent", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", count: 2, warmup: 0 },
      WRITER,
    );
    expect(text(result)).not.toMatch(/s3cr3t/u);
  });

  it("anonymous: true force l'anonyme malgré un jeton qui permettrait un compte", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", count: 1, warmup: 0, anonymous: true },
      WRITER,
    );
    expect(text(result)).toMatch(/Joué en tant que : anonyme\n/u);
    expect(app.sent.some((r) => r.method === "POST")).toBe(false);
  });

  it("🔴 `as` sans admin:write : refusé, rien d'envoyé", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", as: "bob" },
      READER,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/admin:write/u);
    expect(app.sent).toHaveLength(0);
  });

  it("🔴 `as` vers un compte plus privilégié : refusé, aucune session ouverte", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps({
        rolesWithin: async () => ({
          ok: false,
          reason: "`root` a des rôles que `alice` n'a pas : ROLE_ADMIN",
        }),
      }),
      { path: "/orders", as: "root" },
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/ROLE_ADMIN/u);
    expect(app.sent).toHaveLength(0);
    expect(app.tickets.pending).toBe(0);
  });

  it("🔴 `as` sans règle de comparaison (pas de @nodefony/security) : refusé", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps({ rolesWithin: undefined }),
      { path: "/orders", as: "root" },
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/comparaison des rôles indisponible/u);
    expect(app.sent).toHaveLength(0);
    expect(app.tickets.pending).toBe(0);
  });

  it("`as` autorisé : le compte joué est dit, « à la place du propriétaire »", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps(),
      { path: "/orders", count: 1, warmup: 0, as: "bob" },
      WRITER,
    );
    expect(text(result)).toMatch(
      /`bob` \(ROLE_USER\), à la place du propriétaire du jeton/u,
    );
  });

  it("session refusée par la route : isError qui le dit, aucun tir", async () => {
    const app = fakeApp();
    const result = await call(
      app.deps({ issueTicket: () => "A".repeat(43) }),
      { path: "/orders" },
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /session de profilage non ouverte pour `alice` \(403/u,
    );
    expect(app.shots()).toHaveLength(0);
  });
});

describe("nodefony_profile_route — ce qui invalide la mesure est dit EN TÊTE", () => {
  it("🔴 tout refusé en 401 : le refus vient avant les chiffres, avec le geste pour un jeton", async () => {
    const app = fakeApp({ status: () => 401 });
    const out = text(
      await call(app.deps(), { path: "/admin", count: 4, warmup: 0 }),
    );
    const refused = out.indexOf("REFUSÉE(S)");
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(out.indexOf("Tir :"));
    expect(out).toMatch(/4\/4 requête\(s\) REFUSÉE\(S\) \(401×4, 403×0\)/u);
    expect(out).toMatch(/security:mcp:token --scope "admin:read admin:write"/u);
  });

  it("🔴 tout refusé : verdict « rien à juger », jamais « ok », et aucun refus listé en Erreurs", async () => {
    const app = fakeApp({ status: () => 401 });
    const out = text(
      await call(app.deps(), { path: "/admin", count: 3, warmup: 0 }),
    );
    expect(out).toMatch(/^Verdict : rien à juger/u);
    expect(out).not.toMatch(/Erreurs —/u);
  });

  it("refusé en tant que compte : la piste est le rôle ou la zone, pas le jeton", async () => {
    const app = fakeApp({ status: () => 403 });
    const out = text(
      await call(app.deps(), { path: "/admin", count: 2, warmup: 0 }, WRITER),
    );
    expect(out).toMatch(/n'a pas les rôles exigés/u);
  });

  it("🔴 redirigé vers la connexion : dit, et la destination nommée", async () => {
    const app = fakeApp({ status: () => 302 });
    const out = text(
      await call(app.deps(), { path: "/app", count: 3, warmup: 0 }),
    );
    expect(out).toMatch(/3\/3 requête\(s\) REDIRIGÉE\(S\) vers \/login/u);
  });

  it("un N+1 sur la route tirée est nommé", async () => {
    const queries: ProfileQuery[] = Array.from({ length: 6 }, (_, i) => ({
      sql: `select * from items where order_id = ${i}`,
      durationMs: 1,
    }));
    const app = fakeApp({ queries });
    const out = text(
      await call(app.deps(), { path: "/orders", count: 3, warmup: 0 }),
    );
    expect(out).toMatch(/N\+1/u);
  });
});

describe("nodefony_profile_route — arrêt", () => {
  it("🔴 l'agent abandonne : rapport partiel, session détruite, client fermé", async () => {
    const app = fakeApp({ slowMs: 10 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 35);
    const result = await call(
      app.deps(),
      { path: "/orders", count: 100, concurrency: 1, warmup: 0 },
      WRITER,
      { signal: controller.signal, progress: () => undefined },
    );
    expect(text(result)).toMatch(/tir abandonné après/u);
    expect(app.closedSessions).toEqual(["sess_test"]);
    expect(app.state.closed).toBe(true);
  });

  it("le serveur s'arrête : rapport partiel qui le dit, l'écouteur retiré", async () => {
    const app = fakeApp({ slowMs: 10 });
    let listener: (() => Promise<void>) | null = null;
    let unsubscribed = false;
    const pending = call(
      app.deps({
        onShutdown: (l) => {
          listener = l;
          return () => {
            unsubscribed = true;
          };
        },
      }),
      { path: "/orders", count: 100, concurrency: 1, warmup: 0 },
    );
    await delay(30);
    const shutdown = (listener as (() => Promise<void>) | null)?.();
    const out = text(await pending);
    await shutdown;
    expect(out).toMatch(/le serveur s'arrête/u);
    expect(out).toMatch(/rappeler nodefony_profile_route/u);
    expect(out).toMatch(/tir interrompu après/u);
    expect(unsubscribed).toBe(true);
  });
});

describe("readShotTarget — où viser", () => {
  it.each([
    [
      { ready: true, port: 5151, address: "0.0.0.0", domain: "127.0.0.1" },
      { host: "127.0.0.1", port: 5151, hostHeader: "127.0.0.1:5151" },
    ],
    [
      { ready: true, port: 5151, address: "::" },
      { host: "::1", port: 5151, hostHeader: "[::1]:5151" },
    ],
    [
      { ready: true, port: 5161, address: "127.0.0.1", domain: "localhost" },
      { host: "127.0.0.1", port: 5161, hostHeader: "localhost:5161" },
    ],
  ])("%o → %o", (server, target) => {
    expect(readShotTarget(server)).toEqual(target);
  });

  it.each([
    [null],
    [{ ready: false, port: 5151 }],
    [{ ready: true, port: 0 }],
    [{ ready: true }],
  ])("pas de cible : %o", (server) => {
    expect(readShotTarget(server)).toBeNull();
  });
});
