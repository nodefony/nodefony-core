/// <reference types="node" />
/**
 * `GET /nodefony/profiler/api/recent?connection=<requestId>` : les seules
 * frames du pont d'une socket — ce que la barre de débogage et le Suivi de
 * requête du Studio listent comme « appels de la socket ».
 */
import { describe, expect, it } from "vitest";
import { Profiler } from "../../src/profiler/Profiler.js";
import { createProfilerAdminApi } from "../../service/ProfilerAdminApi.js";

const collected = (p: Profiler, requestId: string): void =>
  p.collect({
    requestId,
    type: "websocket",
    scheme: "wss",
    method: "GET",
    url: "/api/x",
    remoteAddress: "127.0.0.1",
    response: { statusCode: 200 },
    phases: [],
    stopClock: () => null,
  } as never);

function recent(p: Profiler, query: Record<string, string>) {
  const ep = createProfilerAdminApi(p)
    .adminEndpoints()
    .find((e) => e.path === "recent" && e.method === undefined);
  if (!ep) throw new Error("endpoint recent absent");
  return ep.handler({ params: {}, query, body: null, user: null, roles: [] });
}

describe("ProfilerAdminApi — recent", () => {
  it("🔴 ?connection= ne rend que les frames de cette socket", async () => {
    const p = new Profiler();
    for (const id of ["sock", "sock.1", "voisine.1", "sock.2"])
      collected(p, id);
    const res = (await recent(p, { connection: "sock" })) as {
      entries: Array<{ requestId: string }>;
    };
    expect(res.entries.map((e) => e.requestId)).toEqual(["sock.2", "sock.1"]);
  });

  it("sans connection (ou une valeur hors borne) : tous les profils", async () => {
    const p = new Profiler();
    for (const id of ["sock", "sock.1"]) collected(p, id);
    const all = (await recent(p, {})) as { entries: unknown[] };
    expect(all.entries).toHaveLength(2);
    const long = (await recent(p, { connection: "x".repeat(201) })) as {
      entries: unknown[];
    };
    expect(long.entries).toHaveLength(2);
  });
});

describe("ProfilerAdminApi — summary", () => {
  function summary(p: Profiler) {
    const ep = createProfilerAdminApi(p)
      .adminEndpoints()
      .find((e) => e.path === "summary");
    if (!ep) throw new Error("endpoint summary absent");
    return ep.handler({
      params: {},
      query: {},
      body: null,
      user: null,
      roles: [],
    });
  }

  it("🔴 l'anneau ENTIER passe à aggregateProfiles — la règle de l'outil MCP, pas une copie", async () => {
    const p = new Profiler();
    for (const id of ["a", "b", "c"]) collected(p, id);
    const res = (await summary(p)) as {
      requests: number;
      ws: number;
      routes: unknown[];
    };
    expect(res.requests).toBe(3);
    expect(res.ws).toBe(3);
    expect(res.routes).toHaveLength(1);
  });

  it("anneau vide : un rapport vide, pas une erreur", async () => {
    const res = (await summary(new Profiler())) as { requests: number };
    expect(res.requests).toBe(0);
  });

  it("déclaré AVANT {id} : `summary` n'est pas lu comme un requestId", () => {
    const paths = createProfilerAdminApi(new Profiler())
      .adminEndpoints()
      .map((e) => e.path);
    expect(paths.indexOf("summary")).toBeLessThan(paths.indexOf("{id}"));
  });
});

describe("ProfilerAdminApi — profil absent", () => {
  function byId(p: Profiler, id: string) {
    const ep = createProfilerAdminApi(p)
      .adminEndpoints()
      .find((e) => e.path === "{id}");
    if (!ep) throw new Error("endpoint {id} absent");
    return ep.handler({
      params: { id },
      query: {},
      body: null,
      user: null,
      roles: [],
    });
  }

  it("🔴 le 404 dit depuis quand l'anneau sait quelque chose (démarrage, vidage)", async () => {
    const before = Date.now();
    const p = new Profiler();
    const fresh = (await byId(p, "inconnu")) as {
      status: number;
      body: { startedAt: number; clearedAt: number | null };
    };
    expect(fresh.status).toBe(404);
    expect(fresh.body.startedAt).toBeGreaterThanOrEqual(before);
    expect(fresh.body.clearedAt).toBeNull();
    p.clear();
    const cleared = (await byId(p, "inconnu")) as {
      body: { startedAt: number; clearedAt: number | null };
    };
    expect(cleared.body.clearedAt).toBeGreaterThanOrEqual(fresh.body.startedAt);
    expect(cleared.body.startedAt).toBe(fresh.body.startedAt);
  });
});
