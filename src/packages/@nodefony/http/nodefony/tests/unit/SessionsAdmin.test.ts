/// <reference types="node" />
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import SessionsService, {
  computeSessionRef,
  toSessionSummary,
} from "../../service/sessions/sessions-service.js";
import FileSessionStorage from "../../src/session/storage/FileSessionStorage.js";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage.js";
import type {
  ISerializedSession,
  ISessionRecord,
  ISessionStorage,
} from "../../interfaces/ISession.js";

// Secret HMAC déterministe (32 octets) — en prod il est dérivé de la clé du
// certificat ; ici une constante suffit à prouver les invariants.
const secret = Buffer.from("0123456789abcdef0123456789abcdef");

describe("Sessions admin — ref HMAC (unit)", () => {
  it("déterministe + format sess_<24 hex>", () => {
    const id = "raw-session-id-xyz";
    const ref = computeSessionRef(secret, id);
    expect(ref).to.match(/^sess_[0-9a-f]{24}$/);
    expect(computeSessionRef(secret, id)).to.equal(ref); // stable entre 2 appels
  });

  it("non réversible — ne contient jamais l'id de session brut", () => {
    const id = "super-secret-cookie-value";
    const ref = computeSessionRef(secret, id);
    expect(ref).to.not.contain(id);
    expect(ref).to.not.equal(id);
  });

  it("lié au serveur — change si le secret change", () => {
    const id = "same-id";
    const other = Buffer.from("ffffffffffffffffffffffffffffffff");
    expect(computeSessionRef(secret, id)).to.not.equal(
      computeSessionRef(other, id),
    );
  });
});

describe("Sessions admin — redaction du DTO (unit)", () => {
  const rec: ISessionRecord = {
    id: "raw-id-123",
    data: {
      Attributes: { secretKey: "TOP_SECRET", csrf: "xyz" },
      flashBag: { msg: "sensitive-flash" },
      metaBag: { ip: "203.0.113.5", ua: "Mozilla/5.0", url: "x" },
      user: "alice@example.com",
      createdAt: new Date("2026-06-01T10:00:00Z"),
      updatedAt: new Date("2026-06-02T12:00:00Z"),
    },
  };
  const ref = computeSessionRef(secret, rec.id);
  const summary = toSessionSummary(rec, ref);

  it("n'expose JAMAIS Attributes / flashBag / metaBag / id brut", () => {
    expect(summary).to.not.have.property("Attributes");
    expect(summary).to.not.have.property("flashBag");
    expect(summary).to.not.have.property("metaBag");
    expect(summary).to.not.have.property("id");
  });

  it("le JSON sérialisé ne fuit aucun secret ni l'id brut", () => {
    const json = JSON.stringify(summary);
    expect(json).to.not.contain("TOP_SECRET");
    expect(json).to.not.contain("sensitive-flash");
    expect(json).to.not.contain("raw-id-123");
  });

  it("expose les champs sûrs (ref/user/authenticated/ip/ua/dates)", () => {
    expect(summary.ref).to.equal(ref);
    expect(summary.user).to.equal("alice@example.com");
    expect(summary.authenticated).to.equal(true);
    expect(summary.ip).to.equal("203.0.113.5");
    expect(summary.ua).to.equal("Mozilla/5.0");
    expect(summary.createdAt).to.equal(Date.parse("2026-06-01T10:00:00Z"));
    expect(summary.updatedAt).to.equal(Date.parse("2026-06-02T12:00:00Z"));
  });

  it("slot multi-tenant = null en mono-tenant", () => {
    expect(summary.tenantId).to.equal(null);
  });

  it("session anonyme → authenticated false, ip/ua/dates null si absents", () => {
    const anon = toSessionSummary(
      {
        id: "anon-1",
        data: { Attributes: {}, flashBag: {}, metaBag: {}, user: "" },
      },
      computeSessionRef(secret, "anon-1"),
    );
    expect(anon.authenticated).to.equal(false);
    expect(anon.ip).to.equal(null);
    expect(anon.ua).to.equal(null);
    expect(anon.createdAt).to.equal(null);
  });
});

describe("FileSessionStorage.listAll (unit, tmpdir)", () => {
  let dir: string;
  let storage: FileSessionStorage;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sess-"));
    const manager = {
      options: { save_path: dir, gc_maxlifetime: 3600 },
      log: () => {},
    };
    storage = new FileSessionStorage(
      manager as unknown as ConstructorParameters<typeof FileSessionStorage>[0],
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSession(id: string, data: Partial<ISerializedSession>): void {
    fs.writeFileSync(
      path.join(dir, id),
      JSON.stringify({
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "",
        ...data,
      }),
    );
  }

  it("énumère toutes les sessions persistées ({ id, data })", async () => {
    writeSession("id-a", { user: "alice" });
    writeSession("id-b", { user: "bob" });
    const all = await storage.listAll();
    expect(all).to.have.length(2);
    expect(all.map((r) => r.id).sort()).to.deep.equal(["id-a", "id-b"]);
    expect(all.find((r) => r.id === "id-a")?.data.user).to.equal("alice");
  });

  it("filtre par user", async () => {
    writeSession("id-a", { user: "alice" });
    writeSession("id-b", { user: "bob" });
    writeSession("id-c", { user: "alice" });
    const aliceOnly = await storage.listAll({ user: "alice" });
    expect(aliceOnly.map((r) => r.id).sort()).to.deep.equal(["id-a", "id-c"]);
  });

  it("ignore les fichiers corrompus / non-JSON (best-effort)", async () => {
    writeSession("good", { user: "alice" });
    fs.writeFileSync(path.join(dir, "corrupt"), "{not valid json");
    const all = await storage.listAll();
    expect(all.map((r) => r.id)).to.deep.equal(["good"]);
  });

  it("dossier vide → liste vide", async () => {
    expect(await storage.listAll()).to.deep.equal([]);
  });
});

describe("Sessions admin — orchestration (unit, storage mock)", () => {
  // Instance « nue » : on contourne le constructeur lourd (kernel/container/
  // certificats) par Object.create pour tester l'orchestration admin isolément.
  function makeAdminService(
    storage: ISessionStorage,
    auditSink?: { record: (e: unknown) => void },
  ): SessionsService {
    const svc = Object.create(SessionsService.prototype) as Record<
      string,
      unknown
    >;
    svc.secret = secret;
    svc.storage = storage;
    svc.log = () => {};
    svc.get = (name: string) =>
      name === "auditService" ? (auditSink ?? null) : null;
    return svc as unknown as SessionsService;
  }

  function sess(user: string): ISerializedSession {
    return { Attributes: {}, metaBag: {}, flashBag: {}, user };
  }

  function makeStorage(
    seed: Record<string, ISerializedSession>,
  ): ISessionStorage & { dump: () => string[] } {
    const map = new Map<string, ISerializedSession>(Object.entries(seed));
    return {
      read: async (id) => map.get(id) ?? ({} as ISerializedSession),
      write: async (id, d) => {
        map.set(id, d);
        return d;
      },
      start: async (id) => map.get(id) ?? ({} as ISerializedSession),
      open: async () => map.size,
      close: () => true,
      destroy: async (id) => map.delete(id),
      gc: async () => {},
      listAll: async (filter) => {
        const out: ISessionRecord[] = [];
        for (const [id, data] of map) {
          if (filter?.user !== undefined && data.user !== filter.user) continue;
          out.push({ id, data });
        }
        return out;
      },
      dump: () => [...map.keys()],
    };
  }

  it("supportsEnumeration reflète la présence de listAll", () => {
    expect(makeAdminService(makeStorage({})).supportsEnumeration()).to.equal(
      true,
    );
    const noList = makeStorage({});
    delete (noList as { listAll?: unknown }).listAll;
    expect(makeAdminService(noList).supportsEnumeration()).to.equal(false);
  });

  it("listAllSessions redacte (pas d'id) + filtre par user", async () => {
    const svc = makeAdminService(
      makeStorage({ a: sess("alice"), b: sess("bob"), c: sess("alice") }),
    );
    const all = await svc.listAllSessions();
    expect(all).to.have.length(3);
    all.forEach((s) => expect(s).to.not.have.property("id"));
    const aliceOnly = await svc.listAllSessions({ user: "alice" });
    expect(aliceOnly.map((s) => s.user)).to.deep.equal(["alice", "alice"]);
  });

  it("destroyByRef révoque la bonne session, et seulement elle", async () => {
    const storage = makeStorage({ a: sess("alice"), b: sess("bob") });
    const svc = makeAdminService(storage);
    expect(await svc.destroyByRef(svc.sessionRef("a"), "admin")).to.equal(true);
    expect(storage.dump()).to.deep.equal(["b"]);
  });

  it("destroyByRef → false pour une ref inconnue (idempotent, rien détruit)", async () => {
    const storage = makeStorage({ a: sess("alice") });
    const svc = makeAdminService(storage);
    expect(
      await svc.destroyByRef("sess_deadbeefdeadbeefdeadbeef", "admin"),
    ).to.equal(false);
    expect(storage.dump()).to.deep.equal(["a"]);
  });

  it("destroyByUser détruit TOUTES les sessions d'un user (logout everywhere)", async () => {
    const storage = makeStorage({
      a: sess("alice"),
      b: sess("bob"),
      c: sess("alice"),
    });
    const svc = makeAdminService(storage);
    expect(await svc.destroyByUser("alice", "admin")).to.equal(2);
    expect(storage.dump()).to.deep.equal(["b"]);
  });

  it("révocation auditée (acteur + ref) si auditService présent", async () => {
    const events: {
      action: string;
      actor: string | null;
      resource?: string | null;
    }[] = [];
    const storage = makeStorage({ a: sess("alice") });
    const svc = makeAdminService(storage, {
      record: (e) => events.push(e as (typeof events)[number]),
    });
    const refA = svc.sessionRef("a");
    await svc.destroyByRef(refA, "bob-admin");
    expect(events).to.have.length(1);
    expect(events[0].action).to.equal("session.revoked");
    expect(events[0].actor).to.equal("bob-admin");
    expect(events[0].resource).to.equal(refA);
  });

  // ── Self-service : « MES sessions » (anti-IDOR). L'identifiant vient TOUJOURS
  // de l'identité serveur (jamais du client) → un user ne voit/révoque que les
  // siennes. Ces tests prouvent l'invariant sans serveur (orchestration pure).

  it("listOwnSessions ne renvoie QUE les sessions de l'appelant", async () => {
    const svc = makeAdminService(
      makeStorage({ a: sess("alice"), b: sess("bob"), c: sess("alice") }),
    );
    const mine = await svc.listOwnSessions("alice");
    expect(mine.map((s) => s.user)).to.deep.equal(["alice", "alice"]);
  });

  it("listOwnSessions('') → [] (jamais les sessions anonymes user==='')", async () => {
    const svc = makeAdminService(
      makeStorage({ a: sess(""), b: sess("bob"), c: sess("") }),
    );
    expect(await svc.listOwnSessions("")).to.deep.equal([]);
  });

  it("destroyOwnByRef révoque MA session (et seulement elle)", async () => {
    const storage = makeStorage({
      a: sess("alice"),
      b: sess("bob"),
      c: sess("alice"),
    });
    const svc = makeAdminService(storage);
    expect(
      await svc.destroyOwnByRef("alice", svc.sessionRef("a"), "alice"),
    ).to.equal(true);
    expect(storage.dump().sort()).to.deep.equal(["b", "c"]);
  });

  it("ANTI-IDOR : impossible de révoquer la session d'AUTRUI via son ref", async () => {
    const storage = makeStorage({ a: sess("alice"), b: sess("bob") });
    const svc = makeAdminService(storage);
    const refBob = svc.sessionRef("b"); // ref RÉEL de la session de bob
    // alice présente le ref de bob → introuvable dans SON périmètre → false.
    expect(await svc.destroyOwnByRef("alice", refBob, "alice")).to.equal(false);
    expect(storage.dump().sort()).to.deep.equal(["a", "b"]); // rien détruit
  });

  it("destroyOwnByRef('') → false (pas de scope vide, rien détruit)", async () => {
    const storage = makeStorage({ a: sess("alice") });
    const svc = makeAdminService(storage);
    expect(await svc.destroyOwnByRef("", svc.sessionRef("a"), "")).to.equal(
      false,
    );
    expect(storage.dump()).to.deep.equal(["a"]);
  });

  it("destroyOwnByRef → false pour une ref inconnue (idempotent)", async () => {
    const storage = makeStorage({ a: sess("alice") });
    const svc = makeAdminService(storage);
    expect(
      await svc.destroyOwnByRef(
        "alice",
        "sess_deadbeefdeadbeefdeadbeef",
        "alice",
      ),
    ).to.equal(false);
    expect(storage.dump()).to.deep.equal(["a"]);
  });

  it("révocation self auditée (actor = propriétaire, metadata.self)", async () => {
    const events: {
      action: string;
      actor: string | null;
      metadata?: Record<string, unknown>;
    }[] = [];
    const storage = makeStorage({ a: sess("alice") });
    const svc = makeAdminService(storage, {
      record: (e) => events.push(e as (typeof events)[number]),
    });
    await svc.destroyOwnByRef("alice", svc.sessionRef("a"), "alice");
    expect(events).to.have.length(1);
    expect(events[0].action).to.equal("session.revoked");
    expect(events[0].actor).to.equal("alice");
    expect(events[0].metadata?.self).to.equal(true);
  });
});

// ── Garde-fou de révocation GÉNÉRIQUE — anti-résurrection (cycle de vie) ──────
// Bug live 2026-06-21 : révoquer une session ne déconnecte pas. La révocation
// (admin OU self) détruit l'entrée storage, mais l'AUTOSAVE de fin de requête
// (`HttpContext.send/end` → `session.save()` → `storage.write(id)`) la RÉ-ÉCRIT —
// la requête portait encore la session `dirty` en mémoire. Le store réel en dev
// était `drizzle` (PAS `files`), donc le fix vit AU-DESSUS du store :
// `RevocationGuardStorage` décore N'IMPORTE quel backend, pose une pierre tombale
// sur `destroy(id)` et refuse tout `write(id)` ultérieur. On le prouve sur un vrai
// FileSessionStorage ET sur un store mock (→ drizzle/redis/mongo couverts par
// construction, sans modifier aucun store).
describe("RevocationGuardStorage — révocation effective (anti-résurrection)", () => {
  const blob = (user: string): ISerializedSession => ({
    Attributes: {},
    metaBag: {},
    flashBag: {},
    user,
  });

  describe("décorant un vrai FileSessionStorage (tmpdir)", () => {
    let dir: string;
    let storage: RevocationGuardStorage;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sess-revoke-"));
      const manager = {
        options: { save_path: dir, gc_maxlifetime: 3600 },
        log: () => {},
      };
      storage = new RevocationGuardStorage(
        new FileSessionStorage(
          manager as unknown as ConstructorParameters<
            typeof FileSessionStorage
          >[0],
        ),
      );
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("un write APRÈS destroy ne ressuscite PAS la session (autosave de fin de requête)", async () => {
      await storage.write("sid-X", blob("alice"));
      expect((await storage.start("sid-X")).user, "session persistée").to.equal(
        "alice",
      );
      await storage.destroy("sid-X"); // révocation
      await storage.write("sid-X", blob("alice")); // autosave tardif (refusé)
      expect(
        Object.keys(await storage.start("sid-X")),
        "session NE doit PAS renaître",
      ).to.have.length(0);
    });

    it("la révocation n'affecte QUE la session ciblée (les autres s'autosauvent)", async () => {
      await storage.write("sid-A", blob("alice"));
      await storage.write("sid-B", blob("bob"));
      await storage.destroy("sid-A");
      await storage.write("sid-A", blob("alice")); // résurrection refusée
      await storage.write("sid-B", blob("bob")); // autosave légitime d'un autre client
      expect(Object.keys(await storage.start("sid-A"))).to.have.length(0);
      expect((await storage.start("sid-B")).user).to.equal("bob");
    });

    it("un NOUVEL id (login régénère l'ID) s'écrit après destroy de l'ancien", async () => {
      await storage.write("old-id", blob("alice"));
      await storage.destroy("old-id");
      await storage.write("new-id", blob("alice"));
      expect((await storage.start("new-id")).user).to.equal("alice");
    });

    it("réexpose listAll quand le backend le supporte (énumération admin)", async () => {
      expect(typeof storage.listAll).to.equal("function");
      await storage.write("s1", blob("alice"));
      const all = await storage.listAll!();
      expect(all.map((r) => r.id)).to.deep.equal(["s1"]);
    });
  });

  describe("agnostique du backend (store mock → drizzle/redis/mongo par construction)", () => {
    // Store minimal en mémoire : prouve que la garantie ne dépend PAS de File.
    function makeStore(): {
      store: ISessionStorage;
      has: (id: string) => boolean;
    } {
      const map = new Map<string, ISerializedSession>();
      return {
        store: {
          read: async (id) => map.get(id) ?? ({} as ISerializedSession),
          write: async (id, d) => {
            map.set(id, d);
            return d;
          },
          start: async (id) => map.get(id) ?? ({} as ISerializedSession),
          open: async () => map.size,
          close: () => true,
          destroy: async (id) => map.delete(id),
          gc: async () => {},
        },
        has: (id) => map.has(id),
      };
    }

    it("destroy puis write : le backend ne contient JAMAIS l'entrée ressuscitée", async () => {
      const { store, has } = makeStore();
      const guard = new RevocationGuardStorage(store);
      await guard.write("x", blob("alice"));
      expect(has("x")).to.equal(true);
      await guard.destroy("x");
      await guard.write("x", blob("alice")); // refusé par le garde-fou
      expect(has("x"), "backend ne ressuscite pas").to.equal(false);
    });

    it("n'expose PAS listAll si le backend ne le supporte pas (501 honnête en aval)", () => {
      const { store } = makeStore(); // pas de listAll
      expect(new RevocationGuardStorage(store).listAll).to.equal(undefined);
    });

    it("inner expose le store réel décoré (introspection du driver)", () => {
      const { store } = makeStore();
      expect(new RevocationGuardStorage(store).inner).to.equal(store);
    });
  });
});

describe("Sessions — GC déterministe (runGc / scheduleGc / shutdownGc)", () => {
  // Harness léger : on greffe les méthodes du prototype sur un objet nu (pas de
  // serveur ni de DI). Le storage est un double qui observe les appels à gc().
  type GcTestable = {
    storage: unknown;
    options: { gc_maxlifetime: number };
    log: (...a: unknown[]) => void;
    gcRunning: boolean;
    gcStart: NodeJS.Timeout | null;
    gcTimer: NodeJS.Timeout | null;
    runGc(): Promise<void>;
    scheduleGc(i: number, j: boolean): void;
    shutdownGc(): void;
  };
  function makeService(storage: unknown): GcTestable {
    const svc = Object.create(SessionsService.prototype) as GcTestable;
    svc.storage = storage;
    svc.options = { gc_maxlifetime: 1440 };
    svc.log = () => {};
    svc.gcRunning = false;
    svc.gcStart = null;
    svc.gcTimer = null;
    return svc;
  }

  it("runGc délègue au store avec gc_maxlifetime", async () => {
    const calls: (number | undefined)[] = [];
    const svc = makeService({
      gc: async (m?: number) => {
        calls.push(m);
      },
    });
    await svc.runGc();
    expect(calls).to.deep.equal([1440]);
  });

  it("runGc anti-empilement — une seule passe concurrente", async () => {
    let active = 0;
    let maxConcurrent = 0;
    const svc = makeService({
      gc: async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
    });
    await Promise.all([svc.runGc(), svc.runGc()]); // la 2e doit être ignorée
    expect(maxConcurrent).to.equal(1);
  });

  it("runGc ne lève jamais si le store échoue (WARNING loggé, finally rend la main)", async () => {
    const svc = makeService({
      gc: async () => {
        throw new Error("store down");
      },
    });
    await svc.runGc(); // ne doit pas rejeter — un GC raté ne tue pas le déclencheur
    expect(svc.gcRunning).to.equal(false);
  });

  it("scheduleGc(0) ne pose aucun timer (désarmé = délégation cron / TTL natif)", () => {
    const svc = makeService({ gc: async () => {} });
    svc.scheduleGc(0, true);
    expect(svc.gcStart).to.equal(null);
    expect(svc.gcTimer).to.equal(null);
  });

  it("scheduleGc arme puis shutdownGc désarme (idempotent)", () => {
    const svc = makeService({ gc: async () => {} });
    svc.scheduleGc(600, false);
    expect(svc.gcStart).to.not.equal(null); // setTimeout initial (≥ 30 s) armé
    svc.shutdownGc();
    expect(svc.gcStart).to.equal(null);
    expect(svc.gcTimer).to.equal(null);
    svc.shutdownGc(); // 2e appel = no-op
    expect(svc.gcStart).to.equal(null);
  });
});
