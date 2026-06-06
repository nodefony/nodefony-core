import { expect } from "chai";
import Session, { OptionsSessionType } from "../../src/session/session.js";
import type {
  ISessionStorage,
  ISerializedSession,
} from "../../interfaces/ISession.js";

// ── minimal mocks ────────────────────────────────────────────────

function makeStorage(
  initial: Record<string, ISerializedSession> = {},
): ISessionStorage {
  const store: Record<string, ISerializedSession> = { ...initial };
  return {
    read: (id) => Promise.resolve(store[id] ?? ({} as ISerializedSession)),
    write: (id, data) => {
      store[id] = { ...data };
      return Promise.resolve(store[id]);
    },
    start: (id) => Promise.resolve(store[id] ?? ({} as ISerializedSession)),
    open: () => Promise.resolve(1),
    close: () => true,
    destroy: (id) => {
      delete store[id];
      return Promise.resolve(true);
    },
    gc: () => Promise.resolve(),
  };
}

function makeManager(strategy = "migrate", storage?: ISessionStorage) {
  const st = storage ?? makeStorage();
  return {
    log: () => undefined,
    storage: st,
    sessionStrategy: strategy as "migrate" | "invalidate" | "none",
    initializeStorage: () => st,
  };
}

const defaultOpts: OptionsSessionType = {
  use_strict_mode: true,
  referer_check: false,
};

function makeSession(
  opts: Partial<OptionsSessionType> = {},
  strategy = "migrate",
): Session {
  return new Session(
    "testsession",
    { ...defaultOpts, ...opts },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeManager(strategy) as any,
  );
}

// ── tests ────────────────────────────────────────────────────────

describe("Session — unit tests", () => {
  describe("constructor", () => {
    it("sets name from argument", () => {
      expect(makeSession().name).to.equal("testsession");
    });

    it("uses options.name as fallback", () => {
      const s = new Session(
        "",
        { ...defaultOpts, name: "fallback" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeManager() as any,
      );
      expect(s.name).to.equal("fallback");
    });

    it("status is 'none' when storage available", () => {
      expect(makeSession().status).to.equal("none");
    });

    it("status is 'disabled' when no storage", () => {
      const mgr = makeManager("migrate");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mgr as any).storage = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = new Session("s", defaultOpts, mgr as any);
      expect(s.status).to.equal("disabled");
    });

    it("strategy comes from manager", () => {
      expect(makeSession({}, "invalidate").strategy).to.equal("invalidate");
    });

    it("starts NOT dirty (no mutation yet)", () => {
      expect(makeSession().dirty).to.equal(false);
    });
  });

  describe("setName / getName", () => {
    it("updates the name", () => {
      const s = makeSession();
      s.setName("renamed");
      expect(s.getName()).to.equal("renamed");
    });
  });

  describe("opaque id (CSPRNG)", () => {
    it("create() generates an opaque base64url id", () => {
      const s = makeSession();
      s.create(0);
      expect(s.id).to.match(/^[A-Za-z0-9_-]+$/);
      expect(s.id.length).to.be.greaterThan(20);
    });

    it("two created sessions have distinct ids", () => {
      const a = makeSession();
      const b = makeSession();
      a.create(0);
      b.create(0);
      expect(a.id).to.not.equal(b.id);
    });

    it("regenerateId() produces a new id and marks dirty", () => {
      const s = makeSession();
      s.create(0);
      const first = s.id;
      s.regenerateId();
      expect(s.id).to.not.equal(first);
      expect(s.dirty).to.equal(true);
    });
  });

  describe("dirty-tracking", () => {
    it("set() marks the session dirty", () => {
      const s = makeSession();
      s.set("k", "v");
      expect(s.dirty).to.equal(true);
    });

    it("setMetaBag() / setFlashBag() mark dirty", () => {
      const s1 = makeSession();
      s1.setMetaBag("a", 1);
      expect(s1.dirty).to.equal(true);
      const s2 = makeSession();
      s2.setFlashBag("a", 1);
      expect(s2.dirty).to.equal(true);
    });

    it("deSerialize() does NOT mark dirty (restauration)", () => {
      const s = makeSession();
      s.deSerialize({
        Attributes: { x: 1 },
        metaBag: {},
        flashBag: {},
        user: "",
      });
      expect(s.dirty).to.equal(false);
    });

    it("getFlashBag() consuming an entry marks dirty", () => {
      const s = makeSession();
      s.deSerialize({
        Attributes: {},
        metaBag: {},
        flashBag: { notice: "hi" },
        user: "",
      });
      expect(s.dirty).to.equal(false);
      expect(s.getFlashBag("notice")).to.equal("hi");
      expect(s.dirty).to.equal(true);
    });

    it("save() is a no-op when not dirty (no storage write)", async () => {
      const storage = makeStorage();
      let writes = 0;
      const origWrite = storage.write.bind(storage);
      storage.write = (id, data, ctx) => {
        writes += 1;
        return origWrite(id, data, ctx);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = new Session(
        "s",
        defaultOpts,
        makeManager("migrate", storage) as any,
      );
      await s.save();
      expect(writes).to.equal(0);
      expect(s.saved).to.equal(false);
    });

    it("save() writes when dirty, then clears dirty + sets saved", async () => {
      const storage = makeStorage();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = new Session(
        "s",
        defaultOpts,
        makeManager("migrate", storage) as any,
      );
      s.set("k", "v");
      expect(s.dirty).to.equal(true);
      await s.save();
      expect(s.dirty).to.equal(false);
      expect(s.saved).to.equal(true);
    });
  });

  describe("FlashBag", () => {
    it("setFlashBag / getFlashBag returns value then deletes it", () => {
      const s = makeSession();
      s.setFlashBag("msg", "hello");
      expect(s.getFlashBag("msg")).to.equal("hello");
      expect(s.getFlashBag("msg")).to.be.null;
    });

    it("getFlashBag returns null for unknown key", () => {
      expect(makeSession().getFlashBag("nope")).to.be.null;
    });

    it("clearFlashBag removes a specific key", () => {
      const s = makeSession();
      s.setFlashBag("a", 1);
      s.setFlashBag("b", 2);
      s.clearFlashBag("a");
      expect(s.getFlashBag("a")).to.be.null;
      expect(s.getFlashBag("b")).to.equal(2);
    });

    it("clearFlashBags removes all keys", () => {
      const s = makeSession();
      s.setFlashBag("x", 1);
      s.setFlashBag("y", 2);
      s.clearFlashBags();
      expect(Object.keys(s.flashBags())).to.have.length(0);
    });

    it("setFlashBag throws on empty key", () => {
      expect(() => makeSession().setFlashBag("", "v")).to.throw();
    });

    it("clearFlashBag throws on empty key", () => {
      expect(() => makeSession().clearFlashBag("")).to.throw();
    });
  });

  describe("MetaBag", () => {
    it("setMetaBag / getMetaBag round-trips", () => {
      const s = makeSession();
      s.setMetaBag("host", "localhost");
      expect(s.getMetaBag("host")).to.equal("localhost");
    });

    it("getMetaBag returns null for unknown key", () => {
      expect(makeSession().getMetaBag("nope")).to.be.null;
    });

    it("getMetas() returns the meta object", () => {
      const s = makeSession();
      s.setMetaBag("env", "test");
      expect(s.getMetas()).to.be.an("object");
      expect((s.getMetas() as Record<string, unknown>).env).to.equal("test");
    });
  });

  describe("serialize / deSerialize", () => {
    it("serialize returns expected shape", () => {
      const data = makeSession().serialize("alice");
      expect(data).to.have.keys(["Attributes", "metaBag", "flashBag", "user"]);
      expect(data.user).to.equal("alice");
    });

    it("deSerialize restores flashBag", () => {
      const s = makeSession();
      s.deSerialize({
        Attributes: {},
        metaBag: {},
        flashBag: { notice: "hello" },
        user: "",
      });
      expect(s.getFlashBag("notice")).to.equal("hello");
    });

    it("deSerialize restores metaBag + user", () => {
      const s = makeSession();
      s.deSerialize({
        Attributes: {},
        metaBag: { host: "example.com" },
        flashBag: {},
        user: "bob",
      });
      expect(s.getMetaBag("host")).to.equal("example.com");
      expect(s.user).to.equal("bob");
    });

    it("round-trips serialize → deSerialize", () => {
      const s = makeSession();
      s.setFlashBag("k", "v");
      s.setMetaBag("env", "unit");
      const data = s.serialize("carol");
      const s2 = makeSession();
      s2.deSerialize(data);
      expect(s2.getFlashBag("k")).to.equal("v");
      expect(s2.getMetaBag("env")).to.equal("unit");
      expect(s2.user).to.equal("carol");
    });
  });

  describe("destroy", () => {
    it("destroy() removes the stored session and returns true", async () => {
      const storage = makeStorage();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = new Session(
        "s",
        defaultOpts,
        makeManager("migrate", storage) as any,
      );
      s.create(0);
      s.set("k", "v");
      await s.save();
      const ok = await s.destroy();
      expect(ok).to.equal(true);
      // l'entrée a disparu du storage → start renvoie un blob vide
      const after = await storage.start(s.id, "default");
      expect(Object.keys(after)).to.have.length(0);
    });
  });

  describe("clear", () => {
    it("clears attributes and flashBags", () => {
      const s = makeSession();
      s.set("a", 1);
      s.setFlashBag("f", "v");
      s.setMetaBag("m", 1);
      s.clear();
      expect(Object.keys(s.flashBags())).to.have.length(0);
      expect(Object.keys(s.getAttributes())).to.have.length(0);
    });
  });

  describe("checkStatus", () => {
    it("returns false when status is 'active'", () => {
      const s = makeSession();
      s.status = "active";
      expect(s.checkStatus()).to.equal(false);
    });

    it("returns true when status is 'none'", () => {
      expect(makeSession().checkStatus()).to.equal(true);
    });
  });

  describe("isValidSession", () => {
    it("true par défaut (referer_check off, pas d'expiration)", () => {
      expect(
        makeSession().isValidSession(
          {} as unknown as ISerializedSession,
          {} as never,
        ),
      ).to.equal(true);
    });

    it("true si lifetime = 0 (jamais expiré par durée)", () => {
      const s = makeSession();
      s.lifetime = 0;
      s.updated = new Date(0);
      expect(
        s.isValidSession({} as unknown as ISerializedSession, {} as never),
      ).to.equal(true);
    });

    it("false si lifetime dépassé", () => {
      const s = makeSession();
      s.lifetime = 1; // 1 s
      s.updated = new Date(Date.now() - 10_000); // il y a 10 s
      expect(
        s.isValidSession({} as unknown as ISerializedSession, {} as never),
      ).to.equal(false);
    });

    it("referer_check on : host == meta → true", () => {
      const s = makeSession({ referer_check: true });
      s.setMetaBag("host", "good.example");
      const ctx = { getHost: () => "good.example" } as never;
      expect(
        s.isValidSession({} as unknown as ISerializedSession, ctx),
      ).to.equal(true);
    });

    it("referer_check on : host != meta → false (exception attrapée)", () => {
      const s = makeSession({ referer_check: true });
      s.setMetaBag("host", "good.example");
      const ctx = { getHost: () => "evil.example" } as never;
      expect(
        s.isValidSession({} as unknown as ISerializedSession, ctx),
      ).to.equal(false);
    });
  });

  describe("checkSecureReferer", () => {
    it("true si host == meta 'host'", () => {
      const s = makeSession();
      s.setMetaBag("host", "h.example");
      expect(
        s.checkSecureReferer({ getHost: () => "h.example" } as never),
      ).to.equal(true);
    });

    it("throw si host != meta", () => {
      const s = makeSession();
      s.setMetaBag("host", "h.example");
      expect(() =>
        s.checkSecureReferer({ getHost: () => "other" } as never),
      ).to.throw();
    });
  });

  describe("attributes", () => {
    it("getAttributes() reflects set()", () => {
      const s = makeSession();
      s.set("x", 42);
      expect((s.getAttributes() as Record<string, unknown>).x).to.equal(42);
    });

    it("get() returns null for an unknown key", () => {
      expect(makeSession().get("nope")).to.be.null;
    });
  });
});
