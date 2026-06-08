/// <reference types="node" />
import { expect } from "chai";
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
    p.collect(ctx() as never);
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
    p.collect(ctx() as never);
    // last phase ends at 5 + 0.5 = 5.5, first starts at 0
    expect(p.get("req-1")!.durationMs).to.equal(5.5);
  });

  it("flags ws kind for websocket contexts", () => {
    const p = new Profiler();
    p.collect(ctx({ requestId: "ws-1", type: "websocket" }) as never);
    expect(p.get("ws-1")!.kind).to.equal("ws");
  });

  it("falls back to 500 status when an error is present and no statusCode", () => {
    const p = new Profiler();
    p.collect(
      ctx({
        requestId: "err-1",
        response: null,
        error: { message: "boom" },
      }) as never,
    );
    const e = p.get("err-1")!;
    expect(e.status).to.equal(500);
    expect(e.error).to.equal("boom");
  });

  it("ignores a context without requestId (no-op)", () => {
    const p = new Profiler();
    p.collect(ctx({ requestId: undefined }) as never);
    expect(p.size).to.equal(0);
  });

  it("recent() returns summaries newest-first, capped", () => {
    const p = new Profiler();
    for (let i = 0; i < 5; i++) p.collect(ctx({ requestId: `r${i}` }) as never);
    const r = p.recent(3);
    expect(r).to.have.length(3);
    expect(r[0]!.requestId).to.equal("r4");
    expect(r[2]!.requestId).to.equal("r2");
    // résumé sans les phases
    expect((r[0] as unknown as Record<string, unknown>).phases).to.be.undefined;
  });

  it("evicts the oldest entry past capacity (ring buffer)", () => {
    const p = new Profiler(3);
    for (let i = 0; i < 5; i++) p.collect(ctx({ requestId: `k${i}` }) as never);
    expect(p.size).to.equal(3);
    expect(p.get("k0")).to.be.undefined;
    expect(p.get("k1")).to.be.undefined;
    expect(p.get("k4")).to.exist;
  });

  it("re-collecting same requestId refreshes recency without growing", () => {
    const p = new Profiler(3);
    p.collect(ctx({ requestId: "a" }) as never);
    p.collect(ctx({ requestId: "b" }) as never);
    p.collect(ctx({ requestId: "c" }) as never);
    p.collect(ctx({ requestId: "a" }) as never); // refresh a → b oldest now
    p.collect(ctx({ requestId: "d" }) as never); // evict b
    expect(p.size).to.equal(3);
    expect(p.get("b")).to.be.undefined;
    expect(p.get("a")).to.exist;
  });

  it("clear() empties the buffer", () => {
    const p = new Profiler();
    p.collect(ctx() as never);
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
        }) as never,
      );
      const q = p.get("req-1")!.queries;
      expect(q).to.have.length(2);
      expect(q![1]).to.deep.include({ sql: "SELECT 2", rows: 3 });
      expect(q![0].connector).to.equal("drizzle");
    });

    it("leaves queries undefined when no adapter pushed (empty/null)", () => {
      const p = new Profiler();
      p.collect(ctx({ requestId: "empty", profilerQueries: [] }) as never);
      p.collect(ctx({ requestId: "nul", profilerQueries: null }) as never);
      expect(p.get("empty")!.queries).to.be.undefined;
      expect(p.get("nul")!.queries).to.be.undefined;
    });
  });
});
