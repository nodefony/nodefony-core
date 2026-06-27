/// <reference types="node" />
/**
 * RED-TEAM — modèle de session NIST/OWASP (idle + absolute + touch throttlé).
 *
 * Passe 1 (threat-first) : attaques CONÇUES depuis le modèle de menace (OWASP
 * Session Mgmt §Expiration, RFC 6265bis) — chacune PEUT virer au rouge sur une
 * implémentation vulnérable. L'invariant central : le touch prolonge l'idle mais
 * JAMAIS l'absolute, et ne ressuscite JAMAIS une session révoquée.
 */
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Session, { OptionsSessionType } from "../../src/session/session.js";
import FileSessionStorage from "../../src/session/storage/FileSessionStorage.js";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage.js";
import { httpConfigSchema } from "../../config/schema.js";
import type {
  ISessionStorage,
  ISerializedSession,
} from "../../interfaces/ISession.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Câblage minimal (PAS la logique testée) ──────────────────────────────────
function makeStorage(over: Partial<ISessionStorage> = {}): ISessionStorage {
  return {
    read: () => Promise.resolve({} as ISerializedSession),
    write: (_id, d) => Promise.resolve(d),
    start: () => Promise.resolve({} as ISerializedSession),
    open: () => Promise.resolve(0),
    close: () => true,
    destroy: () => Promise.resolve(true),
    gc: () => Promise.resolve(),
    ...over,
  };
}
function makeSession(
  opts: Partial<OptionsSessionType>,
  storage?: ISessionStorage,
): Session {
  const st = storage ?? makeStorage();
  const manager = {
    log: () => undefined,
    storage: st,
    sessionStrategy: "migrate",
    initializeStorage: () => st,
  };
  return new Session("attack", { strictMode: true, ...opts }, manager as never);
}

describe("RED-TEAM session timeout — Passe 1 (threat-first)", () => {
  // ── V1 : le touch (updatedAt frais) ne doit JAMAIS sauver une session qui a
  // dépassé l'absolute. C'est l'attaque OWASP §Idle : « garder la session active
  // pour prolonger un id volé » — l'absolute la coupe quoi qu'il arrive. ────────
  it("V1 — absolute NON contournable par un updatedAt frais (touch répété)", () => {
    const s = makeSession({ idleTimeoutS: 3600, absoluteTimeoutS: 10 });
    s.created = new Date(Date.now() - 60_000); // créée il y a 60 s > absolute 10 s
    s.updated = new Date(); // « touchée » à l'instant (idle frais)
    // Idle dirait « valide » ; l'absolute DOIT primer → false.
    expect(
      s.isValidSession({} as never, {} as never),
      "une session au-delà de l'absolute reste invalide même fraîchement touchée",
    ).to.equal(false);
  });

  // ── V3 : idle réellement appliqué — sans activité (updatedAt ancien), expire.
  it("V3 — idle appliqué : updatedAt ancien → invalide (pas d'auto-touch)", () => {
    const s = makeSession({ idleTimeoutS: 5 });
    s.updated = new Date(Date.now() - 60_000); // dernière activité il y a 60 s
    expect(s.isValidSession({} as never, {} as never)).to.equal(false);
  });

  // ── V4 : la borne absolute est vérifiée À LA LECTURE, store-agnostique → vaut
  // pour Redis (TTL glissant peut garder l'entrée, mais la reprise la refuse). ──
  it("V4 — absolute vérifié à la lecture (vaut pour Redis TTL glissant)", () => {
    // Simule une entrée que Redis aurait gardée vivante (TTL repoussé par touch)
    // mais dont la création dépasse l'absolute → refus à la reprise.
    const s = makeSession({ idleTimeoutS: 86400, absoluteTimeoutS: 1 });
    s.created = new Date(Date.now() - 10_000);
    s.updated = new Date(); // TTL Redis aurait été repoussé
    expect(s.isValidSession({} as never, {} as never)).to.equal(false);
  });

  // ── V2 : une requête EN VOL qui touche une session déjà révoquée ne doit PAS
  // la prolonger (la pierre tombale couvre touch comme write). ─────────────────
  it("V2 — touch d'une session RÉVOQUÉE est refusé (anti-résurrection)", async () => {
    let innerTouched = 0;
    const inner = makeStorage({
      touch: () => {
        innerTouched++;
        return Promise.resolve();
      },
    });
    const guard = new RevocationGuardStorage(inner);
    // requête en vol : la session existe, touch passe.
    await guard.touch!("sid");
    expect(innerTouched, "touch normal délégué").to.equal(1);
    // révocation (destroy pose la pierre tombale) PUIS touch tardif.
    await guard.destroy("sid");
    await guard.touch!("sid");
    expect(
      innerTouched,
      "touch APRÈS révocation NE doit PAS atteindre le store",
    ).to.equal(1);
  });

  // ── V6 : touch concurrent = idempotent (last-write-wins sur un timestamp). ───
  it("V6 — touch concurrent idempotent (0 corruption)", async () => {
    let writes = 0;
    const st = makeStorage({
      touch: () => {
        writes++;
        return Promise.resolve();
      },
    });
    const s = makeSession({ idleTimeoutS: 10 }, st);
    s.id = "sid";
    s.status = "active";
    s.updated = new Date(Date.now() - 60_000); // au-delà du throttle
    await Promise.all([
      s.touchIfNeeded(),
      s.touchIfNeeded(),
      s.touchIfNeeded(),
    ]);
    // Pas de throw ; au moins un touch a eu lieu, sans corruption d'état.
    expect(writes).to.be.greaterThan(0);
    expect(s.status).to.equal("active");
  });

  // ── V7 : config malveillante — timeouts négatifs rejetés au boot (Zod). ──────
  it("V7 — schéma rejette un idleTimeoutS négatif", () => {
    expect(() =>
      httpConfigSchema.parse({ session: { idleTimeoutS: -1 } }),
    ).to.throw();
  });
  it("V7 — schéma rejette un absoluteTimeoutS négatif", () => {
    expect(() =>
      httpConfigSchema.parse({ session: { absoluteTimeoutS: -1 } }),
    ).to.throw();
  });
  it("V7 — défauts NIST actifs (idle 1800, absolute 43200)", () => {
    const c = httpConfigSchema.parse({});
    expect(c.session.idleTimeoutS).to.equal(1800);
    expect(c.session.absoluteTimeoutS).to.equal(43200);
  });
});

// ── V5 : FileStorage — le touch (utimes) prolonge l'idle (mtime) mais PAS
// l'absolute (birthtime). Attaque : marteler le touch pour survivre à l'absolute. ─
describe("RED-TEAM session timeout — FileStorage (fs réel, tmpdir)", () => {
  let dir: string;
  let storage: FileSessionStorage;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sess-attack-"));
    const manager = {
      options: { savePath: dir, idleTimeoutS: 3600, absoluteTimeoutS: 0 },
      log: () => undefined,
    };
    storage = new FileSessionStorage(
      manager as unknown as ConstructorParameters<typeof FileSessionStorage>[0],
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("V5 — touch (utimes) NE prolonge PAS l'absolute (birthtime intact)", async () => {
    const id = "victim";
    fs.writeFileSync(`${dir}/${id}`, JSON.stringify({ user: "" }));
    await sleep(1100); // vieillit la session > 1 s
    await storage.touch(id); // rafraîchit mtime (idle) — birthtime inchangé
    // GC : idle large (3600 s) — le touch l'aurait sauvée de l'idle. absolute 1 s
    // → la création (> 1 s) la condamne MALGRÉ le touch.
    await storage.gc(3600, 1);
    expect(
      fs.existsSync(`${dir}/${id}`),
      "session au-delà de l'absolute purgée malgré le touch",
    ).to.equal(false);
  });

  it("V5 — gc idle purge une session inactive (mtime ancien), garde une active", async () => {
    fs.writeFileSync(`${dir}/old`, "{}");
    fs.writeFileSync(`${dir}/fresh`, "{}");
    // vieillit `old` : mtime il y a 10 s ; `fresh` reste à maintenant.
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(`${dir}/old`, past, past);
    await storage.gc(5, 0); // idle 5 s, absolute off
    expect(fs.existsSync(`${dir}/old`), "inactive purgée").to.equal(false);
    expect(fs.existsSync(`${dir}/fresh`), "active conservée").to.equal(true);
  });

  it("V5 — anti-DoS : une session fraîche n'est JAMAIS purgée (idle+absolute larges)", async () => {
    fs.writeFileSync(`${dir}/active`, "{}");
    await storage.gc(3600, 43200);
    expect(fs.existsSync(`${dir}/active`)).to.equal(true);
  });
});
