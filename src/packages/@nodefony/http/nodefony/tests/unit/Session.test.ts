import { expect } from "chai";
import { createHash } from "node:crypto";
import Session, { OptionsSessionType } from "../../src/session/session.js";
import type {
  sessionStorageInterface,
  SerializeSessionType,
} from "../../service/sessions/sessions-service.js";

// ── minimal mocks ────────────────────────────────────────────────

const secret = Buffer.from(
  createHash("sha512").update("test-secret").digest().buffer.slice(0, 32),
);
const iv = Buffer.from(
  createHash("sha512").update("test-iv").digest().buffer.slice(0, 16),
);

function makeStorage(
  initial: Record<string, SerializeSessionType> = {},
): sessionStorageInterface {
  const store: Record<string, SerializeSessionType> = { ...initial };
  return {
    read: (id) => Promise.resolve(store[id] ?? ({} as SerializeSessionType)),
    write: (id, data) => {
      store[id] = { ...data };
      return Promise.resolve(store[id]);
    },
    start: (id) => Promise.resolve(store[id] ?? ({} as SerializeSessionType)),
    open: () => Promise.resolve(1),
    close: () => true,
    destroy: (id) => {
      delete store[id];
      return Promise.resolve(true);
    },
    gc: () => Promise.resolve(),
  };
}

function makeManager(strategy = "migrate", storage?: sessionStorageInterface) {
  const st = storage ?? makeStorage();
  return {
    log: () => undefined as unknown as ReturnType<typeof makeManager>,
    storage: st,
    sessionStrategy: strategy as "migrate" | "invalidate" | "none",
    secret,
    iv,
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
    makeManager(strategy) as any,
  );
}

// ── tests ────────────────────────────────────────────────────────

describe("Session — unit tests", () => {
  describe("constructor", () => {
    it("sets name from argument", () => {
      const s = makeSession();
      expect(s.name).to.equal("testsession");
    });

    it("uses options.name as fallback", () => {
      const s = new Session(
        "",
        { ...defaultOpts, name: "fallback" },
        makeManager() as any,
      );
      expect(s.name).to.equal("fallback");
    });

    it("status is 'none' when storage available", () => {
      expect(makeSession().status).to.equal("none");
    });

    it("status is 'disabled' when no storage", () => {
      const mgr = makeManager("migrate");
      (mgr as any).storage = null;
      const s = new Session("s", defaultOpts, mgr as any);
      expect(s.status).to.equal("disabled");
    });

    it("strategy comes from manager", () => {
      const s = makeSession({}, "invalidate");
      expect(s.strategy).to.equal("invalidate");
    });
  });

  describe("setName / getName", () => {
    it("updates the name", () => {
      const s = makeSession();
      s.setName("renamed");
      expect(s.getName()).to.equal("renamed");
    });
  });

  describe("encrypt / decrypt", () => {
    it("round-trips a string", () => {
      const s = makeSession();
      const plain = "hello:default";
      expect(s.decrypt(s.encrypt(plain))).to.equal(plain);
    });

    it("different inputs produce different ciphertext", () => {
      const s = makeSession();
      expect(s.encrypt("abc")).to.not.equal(s.encrypt("def"));
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

    it("metaBag() returns the meta container", () => {
      const s = makeSession();
      s.setMetaBag("env", "test");
      expect(s.metaBag()).to.be.an("object");
    });
  });

  describe("serialize / deSerialize", () => {
    it("serialize returns expected shape", () => {
      const s = makeSession();
      const data = s.serialize("alice");
      expect(data).to.have.keys(["Attributes", "metaBag", "flashBag", "user"]);
      expect(data.user).to.equal("alice");
    });

    it("deSerialize restores flashBag", () => {
      const s = makeSession();
      const data = {
        Attributes: {},
        metaBag: {},
        flashBag: { notice: "hello" },
        user: "",
      } as unknown as SerializeSessionType;
      s.deSerialize(data);
      expect(s.getFlashBag("notice")).to.equal("hello");
    });

    it("deSerialize restores metaBag", () => {
      const s = makeSession();
      const data = {
        Attributes: {},
        metaBag: { host: "example.com" },
        flashBag: {},
        user: "bob",
      } as unknown as SerializeSessionType;
      s.deSerialize(data);
      expect(s.getMetaBag("host")).to.equal("example.com");
      expect(s.user).to.equal("bob");
    });

    it("round-trips serialize → deSerialize", () => {
      const s = makeSession();
      s.setFlashBag("k", "v");
      s.setMetaBag("env", "unit");
      const data = s.serialize("carol") as unknown as SerializeSessionType;
      const s2 = makeSession();
      s2.deSerialize(data);
      expect(s2.getFlashBag("k")).to.equal("v");
      expect(s2.getMetaBag("env")).to.equal("unit");
      expect(s2.user).to.equal("carol");
    });
  });

  describe("clear", () => {
    it("clears attributes and flashBags", () => {
      const s = makeSession();
      s.setFlashBag("f", "v");
      s.setMetaBag("m", 1);
      s.clear();
      expect(Object.keys(s.flashBags())).to.have.length(0);
    });
  });

  describe("checkStatus", () => {
    it("returns false when status is 'active'", () => {
      const s = makeSession();
      (s as any).status = "active";
      expect(s.checkStatus()).to.equal(false);
    });

    it("returns true when status is 'none'", () => {
      expect(makeSession().checkStatus()).to.equal(true);
    });
  });

  describe("randomValueHex", () => {
    it("retourne une chaîne hex de la longueur demandée", () => {
      const h = makeSession().randomValueHex(16);
      expect(h).to.have.length(16);
      expect(h).to.match(/^[0-9a-f]+$/);
    });

    it("deux appels produisent des valeurs distinctes", () => {
      const s = makeSession();
      expect(s.randomValueHex(32)).to.not.equal(s.randomValueHex(32));
    });
  });

  describe("setId / getId — round-trip chiffré + contextSession", () => {
    it("setId encode le contextSession ; getId le restaure", () => {
      const s = makeSession();
      s.contextSession = "tenantA";
      const id = s.setId();
      expect(id).to.be.a("string");
      expect(id.length).to.be.greaterThan(0);
      // brouille puis restaure via getId
      s.contextSession = "xxx";
      const returned = s.getId(id);
      expect(returned).to.equal(id);
      expect(s.contextSession).to.equal("tenantA");
    });

    it("deux setId successifs produisent des id différents", () => {
      const s = makeSession();
      expect(s.setId()).to.not.equal(s.setId());
    });
  });

  describe("isValidSession", () => {
    it("true par défaut (referer_check off, pas d'expiration)", () => {
      const s = makeSession();
      expect(
        s.isValidSession({} as unknown as SerializeSessionType, {} as never),
      ).to.equal(true);
    });

    it("true si lifetime = 0 (jamais expiré par durée)", () => {
      const s = makeSession();
      s.lifetime = 0;
      s.updated = new Date(0);
      expect(
        s.isValidSession({} as unknown as SerializeSessionType, {} as never),
      ).to.equal(true);
    });

    it("false si lifetime dépassé", () => {
      const s = makeSession();
      s.lifetime = 1; // 1 s
      s.updated = new Date(Date.now() - 10_000); // il y a 10 s
      expect(
        s.isValidSession({} as unknown as SerializeSessionType, {} as never),
      ).to.equal(false);
    });

    it("referer_check on : host == meta → true", () => {
      const s = makeSession({ referer_check: true });
      s.setMetaBag("host", "good.example");
      const ctx = { getHost: () => "good.example" } as never;
      expect(
        s.isValidSession({} as unknown as SerializeSessionType, ctx),
      ).to.equal(true);
    });

    it("referer_check on : host != meta → false (exception attrapée)", () => {
      const s = makeSession({ referer_check: true });
      s.setMetaBag("host", "good.example");
      const ctx = { getHost: () => "evil.example" } as never;
      expect(
        s.isValidSession({} as unknown as SerializeSessionType, ctx),
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
      let threw = false;
      try {
        s.checkSecureReferer({ getHost: () => "other" } as never);
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });

  describe("attributes", () => {
    it("getAttributes() délègue à attributes()", () => {
      const s = makeSession();
      expect(s.getAttributes()).to.equal(s.attributes());
    });
  });
});
