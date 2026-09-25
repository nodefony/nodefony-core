import { expect } from "chai";
import { RequestContext, Container } from "../index";

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
        return {
          id: RequestContext.getRequestId(),
          user: RequestContext.getUser(),
        };
      }),
      RequestContext.run({ requestId: "B" }, async () => {
        await tick();
        RequestContext.set("user", { id: "userB" });
        await tick();
        return {
          id: RequestContext.getRequestId(),
          user: RequestContext.getUser(),
        };
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

  describe("scope de la requête — getScope() / requireScope() (#484)", () => {
    const openRoot = (): Container => {
      const root = new Container();
      root.addScope("request");
      return root;
    };
    const messageOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (e) {
        return (e as Error).message;
      }
      return undefined;
    };

    it("deux requêtes entrelacées relisent chacune leur scope, la racine reste intacte", async () => {
      const root = openRoot();
      const a = root.enterScope("request");
      const b = root.enterScope("request");
      // Portes explicites : A écrit, laisse B écrire à son tour, puis relit —
      // l'entrelacement est garanti, pas laissé au hasard d'une minuterie.
      let releaseA!: () => void;
      const gateA = new Promise<void>((r) => {
        releaseA = r;
      });
      let releaseB!: () => void;
      const gateB = new Promise<void>((r) => {
        releaseB = r;
      });
      const runA = RequestContext.run(
        { requestId: "A", scope: a },
        async () => {
          expect(RequestContext.getScope()).to.equal(a);
          RequestContext.requireScope().set("db", "db-A");
          releaseB();
          await gateA;
          return RequestContext.requireScope().get("db");
        },
      );
      const runB = RequestContext.run(
        { requestId: "B", scope: b },
        async () => {
          await gateB;
          expect(RequestContext.getScope()).to.equal(b);
          RequestContext.requireScope().set("db", "db-B");
          releaseA();
          return RequestContext.requireScope().get("db");
        },
      );
      const [readA, readB] = await Promise.all([runA, runB]);
      expect(readA).to.equal("db-A");
      expect(readB).to.equal("db-B");
      expect(root.get("db")).to.equal(null);
      expect(RequestContext.getScope()).to.equal(undefined);
    });

    it("un service posé sur la racine APRÈS l'ouverture est visible par le scope", () => {
      const root = openRoot();
      const scope = root.enterScope("request");
      RequestContext.run({ requestId: "racine-tardive", scope }, () => {
        root.set("mailer", { kind: "smtp" });
        expect(RequestContext.requireScope().get("mailer")).to.deep.equal({
          kind: "smtp",
        });
      });
    });

    it("hors requête : getScope() rend undefined, requireScope() dit qu'aucune requête n'est en cours", () => {
      expect(RequestContext.getScope()).to.equal(undefined);
      expect(messageOf(() => RequestContext.requireScope())).to.match(
        /aucune requête en cours/,
      );
    });

    it("bulle ouverte sans scope : getScope() rend undefined, requireScope() nomme la requête", () => {
      RequestContext.run({ requestId: "sans-scope" }, () => {
        expect(RequestContext.getScope()).to.equal(undefined);
        expect(messageOf(() => RequestContext.requireScope())).to.match(
          /« sans-scope » ne porte pas de scope/,
        );
      });
    });

    it("scope refermé : une continuation qui reprend après leaveScope ne le reçoit plus", async () => {
      const root = openRoot();
      const scope = root.enterScope("request");
      let resume!: () => void;
      const requestEnded = new Promise<void>((r) => {
        resume = r;
      });
      const pending = RequestContext.run(
        { requestId: "terminée", scope },
        async () => {
          const before = RequestContext.getScope();
          await requestEnded;
          return {
            before,
            after: RequestContext.getScope(),
            error: messageOf(() => RequestContext.requireScope()),
          };
        },
      );
      root.leaveScope(scope);
      resume();
      const { before, after, error } = await pending;
      expect(before).to.equal(scope);
      expect(scope.closed).to.equal(true);
      expect(after).to.equal(undefined);
      expect(error).to.match(/« terminée » est déjà fermé/);
    });
  });
});
