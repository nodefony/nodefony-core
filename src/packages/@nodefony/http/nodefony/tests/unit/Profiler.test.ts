/// <reference types="node" />
import { expect } from "vitest";
import { Profiler } from "../../src/profiler/Profiler.js";

/** Construit un Context-like minimal pour `collect`. */
function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req-1",
    type: "http",
    scheme: "http",
    method: "GET",
    url: "/api/users",
    remoteAddress: "127.0.0.1",
    response: { statusCode: 200 },
    phases: [
      { name: "resolve", startMs: 0, durationMs: 1 },
      { name: "action", startMs: 1, durationMs: 4 },
      { name: "send", startMs: 5, durationMs: 0.5 },
    ],
    resolver: {
      route: { name: "users.list" },
      controller: { name: "UsersController" },
      actionName: "list",
    },
    ...over,
  };
}

describe("Profiler — unit", () => {
  it("collects a full profile keyed by requestId", () => {
    const p = new Profiler();
    p.collect(ctx());
    const e = p.get("req-1");
    expect(e).to.exist;
    expect(e!.method).to.equal("GET");
    expect(e!.url).to.equal("/api/users");
    expect(e!.status).to.equal(200);
    expect(e!.route).to.equal("users.list");
    expect(e!.controller).to.equal("UsersController");
    expect(e!.action).to.equal("list");
    expect(e!.kind).to.equal("http");
    expect(e!.phases).to.have.length(3);
  });

  it("derives total duration from phases (end - start)", () => {
    const p = new Profiler();
    p.collect(ctx());
    // last phase ends at 5 + 0.5 = 5.5, first starts at 0
    expect(p.get("req-1")!.durationMs).to.equal(5.5);
  });

  it("flags ws kind for websocket contexts", () => {
    const p = new Profiler();
    p.collect(ctx({ requestId: "ws-1", type: "websocket" }));
    expect(p.get("ws-1")!.kind).to.equal("ws");
  });

  it("falls back to 500 status when an error is present and no statusCode", () => {
    const p = new Profiler();
    p.collect(
      ctx({
        requestId: "err-1",
        response: null,
        error: { message: "boom" },
      }),
    );
    const e = p.get("err-1")!;
    expect(e.status).to.equal(500);
    expect(e.error).to.equal("boom");
  });

  it("ignores a context without requestId (no-op)", () => {
    const p = new Profiler();
    p.collect(ctx({ requestId: undefined }));
    expect(p.size).to.equal(0);
  });

  it("recent() returns summaries newest-first, capped", () => {
    const p = new Profiler();
    for (let i = 0; i < 5; i++) p.collect(ctx({ requestId: `r${i}` }));
    const r = p.recent(3);
    expect(r).to.have.length(3);
    expect(r[0]!.requestId).to.equal("r4");
    expect(r[2]!.requestId).to.equal("r2");
    // résumé sans les phases
    expect((r[0] as unknown as Record<string, unknown>).phases).to.be.undefined;
  });

  it("🔴 recent(limit, connection) : les SEULES frames de cette socket, pas une voisine qui lui ressemble", () => {
    const p = new Profiler();
    p.collect(ctx({ requestId: "sock" }));
    p.collect(ctx({ requestId: "sock.1" }));
    p.collect(ctx({ requestId: "autre.1" }));
    p.collect(ctx({ requestId: "sock0.1" }));
    p.collect(ctx({ requestId: "sock.2" }));
    expect(p.recent(60, "sock").map((e) => e.requestId)).to.deep.equal([
      "sock.2",
      "sock.1",
    ]);
    expect(p.recent(60)).to.have.length(5);
  });

  it("evicts the oldest entry past capacity (ring buffer)", () => {
    const p = new Profiler(3);
    for (let i = 0; i < 5; i++) p.collect(ctx({ requestId: `k${i}` }));
    expect(p.size).to.equal(3);
    expect(p.get("k0")).to.be.undefined;
    expect(p.get("k1")).to.be.undefined;
    expect(p.get("k4")).to.exist;
  });

  it("re-collecting same requestId refreshes recency without growing", () => {
    const p = new Profiler(3);
    p.collect(ctx({ requestId: "a" }));
    p.collect(ctx({ requestId: "b" }));
    p.collect(ctx({ requestId: "c" }));
    p.collect(ctx({ requestId: "a" })); // refresh a → b oldest now
    p.collect(ctx({ requestId: "d" })); // evict b
    expect(p.size).to.equal(3);
    expect(p.get("b")).to.be.undefined;
    expect(p.get("a")).to.exist;
  });

  it("clear() empties the buffer", () => {
    const p = new Profiler();
    p.collect(ctx());
    p.clear();
    expect(p.size).to.equal(0);
  });

  describe("ORM queries seam", () => {
    it("maps profilerQueries onto the entry", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          profilerQueries: [
            { sql: "SELECT 1", durationMs: 0.4, connector: "drizzle" },
            {
              sql: "SELECT 2",
              durationMs: 1.2,
              rows: 3,
              connector: "drizzle",
            },
          ],
        }),
      );
      const q = p.get("req-1")!.queries;
      expect(q).to.have.length(2);
      expect(q![1]).to.deep.include({ sql: "SELECT 2", rows: 3 });
      expect(q![0]!.connector).to.equal("drizzle");
    });

    it("leaves queries undefined when no adapter pushed (empty/null)", () => {
      const p = new Profiler();
      p.collect(ctx({ requestId: "empty", profilerQueries: [] }));
      p.collect(ctx({ requestId: "nul", profilerQueries: null }));
      expect(p.get("empty")!.queries).to.be.undefined;
      expect(p.get("nul")!.queries).to.be.undefined;
    });

    it("keeps startMs so a query can be placed inside the phase waterfall", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          profilerQueries: [{ sql: "SELECT 1", startMs: 2.5, durationMs: 0.4 }],
        }),
      );
      // La phase `action` court de 1 à 5 → la requête (2.5) tombe DEDANS.
      expect(p.get("req-1")!.queries![0]!.startMs).to.equal(2.5);
    });
  });

  describe("security — la traversée du firewall", () => {
    /** Zone protégée telle que `Firewall.isSecure` la pose sur le context. */
    const area = {
      name: "admin",
      security: true,
      mode: "first",
      authenticators: ["session", "jwt"],
    };

    it("reports nothing when the request crossed no firewall zone", () => {
      const p = new Profiler();
      p.collect(ctx());
      expect(p.get("req-1")!.security).to.be.undefined;
    });

    it("crosses what the zone ALLOWED with what actually HAPPENED", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          security: area,
          securityTrace: {
            authenticator: "session",
            outcome: "granted",
            reason: null,
            roles: ["ROLE_NODEFONY_ADMIN"],
          },
        }),
      );
      const s = p.get("req-1")!.security!;
      expect(s.zone).to.equal("admin");
      expect(s.protected).to.equal(true);
      expect(s.mode).to.equal("first");
      // Ce qui était POSSIBLE…
      expect(s.candidates).to.deep.equal(["session", "jwt"]);
      // …et ce qui a RÉELLEMENT résolu l'identité.
      expect(s.authenticator).to.equal("session");
      expect(s.outcome).to.equal("granted");
      expect(s.roles).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
    });

    it("carries the REASON of a refusal (a 401 says why)", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          response: { statusCode: 401 },
          security: area,
          securityTrace: {
            authenticator: null,
            outcome: "denied",
            reason: "no_credentials",
            roles: null,
          },
        }),
      );
      const s = p.get("req-1")!.security!;
      expect(s.outcome).to.equal("denied");
      expect(s.reason).to.equal("no_credentials");
      expect(s.authenticator).to.be.null;
    });

    it("marks a public zone crossed without a trace as `public`", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          security: { name: "front", security: false, authenticators: [] },
        }),
      );
      const s = p.get("req-1")!.security!;
      expect(s.protected).to.equal(false);
      // Le firewall n'ouvre aucune trace hors zone protégée → l'issue se déduit.
      expect(s.outcome).to.equal("public");
    });
  });

  describe("user — l'identité de la requête", () => {
    it("🔴 lit l'identifiant que le pare-feu a posé sur le contexte", () => {
      const p = new Profiler();
      p.collect(ctx({ userIdentifier: "alice@acme.io" }));
      expect(p.get("req-1")!.user).to.equal("alice@acme.io");
    });

    it("se replie sur la trace du firewall quand le contexte n'en porte pas", () => {
      const p = new Profiler();
      p.collect(
        ctx({
          userIdentifier: null,
          securityTrace: {
            authenticator: "jwt",
            outcome: "granted",
            reason: null,
            roles: ["ROLE_USER"],
            user: "bob",
          },
        }),
      );
      expect(p.get("req-1")!.user).to.equal("bob");
    });
  });
});

describe("Profiler — lecture suivie (curseur)", () => {
  /** Collecte `n` requêtes d'identifiants `<prefix>-1…n`. */
  function feed(p: Profiler, n: number, prefix = "r"): void {
    for (let i = 1; i <= n; i++)
      p.collect(ctx({ requestId: `${prefix}-${i}` }));
  }

  it("numérote les profils dans l'ordre de collecte", () => {
    const p = new Profiler();
    expect(p.cursor).to.equal(0);
    feed(p, 3);
    expect(p.cursor).to.equal(3);
    expect(p.get("r-1")!.seq).to.equal(1);
    expect(p.get("r-3")!.seq).to.equal(3);
  });

  it("ne rend que les profils collectés après le curseur", () => {
    const p = new Profiler();
    feed(p, 3);
    const start = p.cursor;
    feed(p, 2, "s");
    const batch = p.since(start);
    expect(batch.entries.map((e) => e.requestId)).to.deep.equal(["s-1", "s-2"]);
    expect(batch.cursor).to.equal(5);
    expect(batch.lost).to.equal(0);
    expect(p.since(batch.cursor).entries).to.have.length(0);
  });

  it("compte exactement les profils évincés avant d'être lus", () => {
    const p = new Profiler(4);
    const start = p.cursor;
    feed(p, 10);
    const batch = p.since(start);
    expect(batch.entries.map((e) => e.requestId)).to.deep.equal([
      "r-7",
      "r-8",
      "r-9",
      "r-10",
    ]);
    expect(batch.lost).to.equal(6);
  });

  it("compte comme perdu un profil écrasé par un identifiant réutilisé", () => {
    const p = new Profiler();
    const start = p.cursor;
    p.collect(ctx({ requestId: "dup", url: "/a" }));
    p.collect(ctx({ requestId: "dup", url: "/b" }));
    const batch = p.since(start);
    expect(batch.entries.map((e) => e.url)).to.deep.equal(["/b"]);
    expect(batch.lost).to.equal(1);
  });

  it("ne compte pas comme perdu ce qui avait déjà été lu", () => {
    const p = new Profiler(4);
    feed(p, 4);
    const read = p.since(0);
    expect(read.lost).to.equal(0);
    feed(p, 3, "s");
    const next = p.since(read.cursor);
    expect(next.entries.map((e) => e.requestId)).to.deep.equal([
      "s-1",
      "s-2",
      "s-3",
    ]);
    expect(next.lost).to.equal(0);
  });

  it("repart de zéro sur un curseur inconnu", () => {
    const p = new Profiler();
    feed(p, 2);
    const batch = p.since(99);
    expect(batch.entries).to.have.length(2);
    expect(batch.lost).to.equal(0);
  });
});

describe("Profiler — un anneau par provenance (#649)", () => {
  const app = (id: string) => ctx({ requestId: id, url: "/api/users" });
  const asset = (id: string) =>
    ctx({
      requestId: id,
      url: "https://127.0.0.1:5152/_vite/studio/src/x.tsx",
    });
  const console_ = (id: string) =>
    ctx({ requestId: id, type: "websocket", url: "/nodefony/kernel/api/info" });

  it("un flot d'assets relayés et d'appels de la console ne chasse pas un profil de l'application", () => {
    const p = new Profiler(3, 2);
    p.collect(app("app-1"));
    for (let i = 0; i < 50; i += 1) {
      p.collect(asset(`vite-${i}`));
      p.collect(console_(`conn.${i}`));
    }
    expect(p.get("app-1"), "profil de l'application gardé").to.exist;
    // Outillage et assets tournent chacun dans LEURS 2 places.
    expect(p.get("conn.49")).to.exist;
    expect(p.get("vite-49")).to.exist;
    expect(p.get("vite-47")).to.equal(undefined);
    expect(p.size).to.equal(5);
  });

  it("les assets relayés ne chassent pas les appels de la console", () => {
    const p = new Profiler(3, 2);
    p.collect(console_("conn.1"));
    for (let i = 0; i < 400; i += 1) p.collect(asset(`vite-${i}`));
    expect(p.get("conn.1"), "profil de la trame gardé").to.exist;
  });

  it("l'anneau de l'application évince toujours SES plus anciens", () => {
    const p = new Profiler(2, 2);
    p.collect(app("a"));
    p.collect(app("b"));
    p.collect(app("c"));
    expect(p.get("a")).to.equal(undefined);
    expect(p.get("c")).to.exist;
  });

  it("recent() et since() remettent les deux anneaux dans l'ordre de collecte", () => {
    const p = new Profiler();
    p.collect(app("a"));
    p.collect(asset("v"));
    p.collect(app("b"));
    p.collect(console_("w"));
    expect(p.recent().map((e) => e.requestId)).to.deep.equal([
      "w",
      "b",
      "v",
      "a",
    ]);
    const batch = p.since(1);
    expect(batch.entries.map((e) => e.requestId)).to.deep.equal([
      "v",
      "b",
      "w",
    ]);
    expect(batch.lost).to.equal(0);
  });

  it("compte exactement les pertes de l'anneau de l'outillage", () => {
    const p = new Profiler(10, 1);
    const from = p.cursor;
    p.collect(asset("v1"));
    p.collect(asset("v2"));
    p.collect(app("a"));
    const batch = p.since(from);
    expect(batch.entries.map((e) => e.requestId)).to.deep.equal(["v2", "a"]);
    expect(batch.lost).to.equal(1);
  });

  it("un identifiant réutilisé sur une autre URL change d'anneau sans doublon", () => {
    const p = new Profiler();
    p.collect(app("same"));
    p.collect(asset("same"));
    expect(p.size).to.equal(1);
    expect(p.get("same")!.url).to.contain("/_vite/");
  });

  it("clear() vide les deux anneaux", () => {
    const p = new Profiler();
    p.collect(app("a"));
    p.collect(asset("v"));
    p.clear();
    expect(p.size).to.equal(0);
  });
});
