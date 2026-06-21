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
});
