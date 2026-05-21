import { expect } from "chai";
import "mocha";
import { RequestContext } from "../index";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("RequestContext (AsyncLocalStorage façade)", () => {
  it("get() retourne undefined hors de tout scope", () => {
    expect(RequestContext.get()).to.equal(undefined);
    expect(RequestContext.getRequestId()).to.equal(undefined);
    expect(RequestContext.getUser()).to.equal(undefined);
  });

  it("run() expose le payload à l'intérieur du scope", () => {
    RequestContext.run({ requestId: "req-1", scheme: "https" }, () => {
      expect(RequestContext.getRequestId()).to.equal("req-1");
      expect(RequestContext.get()?.scheme).to.equal("https");
    });
  });

  it("run() retourne la valeur de fn", () => {
    const v = RequestContext.run({ requestId: "r" }, () => 42);
    expect(v).to.equal(42);
  });

  it("le contexte survit à un await", async () => {
    await RequestContext.run({ requestId: "across-await" }, async () => {
      const before = RequestContext.getRequestId();
      await tick();
      const after = RequestContext.getRequestId();
      expect(before).to.equal("across-await");
      expect(after).to.equal("across-await");
    });
  });

  it("set() mute le store courant — visible via get()", () => {
    RequestContext.run({ requestId: "r" }, () => {
      RequestContext.set("user", { id: "u-7" });
      RequestContext.set("userId", "u-7");
      expect((RequestContext.getUser() as { id: string }).id).to.equal("u-7");
      expect(RequestContext.getUserId()).to.equal("u-7");
    });
  });

  it("set() hors scope est un no-op (pas d'exception)", () => {
    expect(() => RequestContext.set("user", { id: "x" })).to.not.throw();
    expect(RequestContext.get()).to.equal(undefined);
  });

  it("isolation : 2 scopes concurrents ne se mélangent pas", async () => {
    const results = await Promise.all([
      RequestContext.run({ requestId: "A" }, async () => {
        await tick();
        RequestContext.set("user", { id: "userA" });
        await tick();
        return { id: RequestContext.getRequestId(), user: RequestContext.getUser() };
      }),
      RequestContext.run({ requestId: "B" }, async () => {
        await tick();
        RequestContext.set("user", { id: "userB" });
        await tick();
        return { id: RequestContext.getRequestId(), user: RequestContext.getUser() };
      }),
    ]);
    expect(results[0]).to.deep.equal({ id: "A", user: { id: "userA" } });
    expect(results[1]).to.deep.equal({ id: "B", user: { id: "userB" } });
  });

  it("le scope se ferme après run() (pas de fuite)", () => {
    RequestContext.run({ requestId: "transient" }, () => {
      expect(RequestContext.getRequestId()).to.equal("transient");
    });
    expect(RequestContext.get()).to.equal(undefined);
  });

  describe("profiler queries seam", () => {
    it("isProfiling() = false sans buffer (prod) → pushQuery no-op", () => {
      RequestContext.run({ requestId: "no-buf" }, () => {
        expect(RequestContext.isProfiling()).to.equal(false);
        RequestContext.pushQuery({ sql: "SELECT 1", durationMs: 1 });
        expect(RequestContext.get()?.queries).to.equal(undefined);
      });
    });

    it("isProfiling() = false hors scope → pushQuery no-op", () => {
      expect(RequestContext.isProfiling()).to.equal(false);
      RequestContext.pushQuery({ sql: "SELECT 1", durationMs: 1 }); // ne throw pas
    });

    it("pushQuery() remplit le buffer fourni (dev)", () => {
      const queries: { sql: string; durationMs: number }[] = [];
      RequestContext.run({ requestId: "dev", queries }, () => {
        expect(RequestContext.isProfiling()).to.equal(true);
        RequestContext.pushQuery({ sql: "SELECT 2", durationMs: 0.5, rows: 1 });
        RequestContext.pushQuery({ sql: "SELECT 3", durationMs: 0.2 });
      });
      expect(queries).to.have.length(2);
      expect(queries[0]).to.deep.include({ sql: "SELECT 2", rows: 1 });
    });
  });
});
