import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenStore } from "../../nodefony/src/token/FileTokenStore";
import type { IAccessTokenRecord } from "../../nodefony/contracts/ITokenStore";

/**
 * Store fichier (J4a) — vérifie la PERSISTANCE par-dessus la logique mémoire
 * (déjà couverte par `tokenStore.test.ts`) : un état écrit puis flushé est relu
 * à l'identique par une nouvelle instance ; robustesse boot (absent/corrompu).
 */

const makeRecord = (
  o: Partial<IAccessTokenRecord> = {},
): IAccessTokenRecord => ({
  id: "id1",
  kind: "pat",
  name: "token",
  prefix: null,
  subjectId: "u1",
  subjectType: "user",
  tenantId: null,
  scopes: [],
  audience: [],
  resources: null,
  secretHash: "hash1",
  hashAlg: "sha256",
  clientId: null,
  cnf: null,
  family: null,
  replacedBy: null,
  createdAt: 1000,
  expiresAt: null,
  lastUsedAt: null,
  lastUsedIp: null,
  lastUsedUserAgent: null,
  revokedAt: null,
  revokedReason: null,
  metadata: {},
  ...o,
});

const tmpFile = (): { dir: string; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), "nf-tok-"));
  return { dir, path: join(dir, "tokens.json") };
};

describe("FileTokenStore — persistance", () => {
  it("écrit puis relit records, denylist et seuil dans une nouvelle instance", async () => {
    const { dir, path } = tmpFile();
    try {
      const s1 = new FileTokenStore(path);
      await s1.put(
        makeRecord({ id: "a", secretHash: "h-a", subjectId: "u", family: "F" }),
      );
      await s1.denyJti("j", 9_999_999_999_999);
      await s1.revokeAllForSubject("u", 5000);
      await s1.flushNow();

      const s2 = new FileTokenStore(path);
      assert.equal((await s2.findById("a"))?.id, "a");
      assert.equal((await s2.findByHash("h-a"))?.id, "a");
      assert.equal((await s2.findBySubject("u")).length, 1);
      assert.equal(await s2.isJtiDenied("j"), true);
      assert.equal(await s2.getInvalidBefore("u"), 5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("revokeFamily survit au rechargement (index famille reconstruit)", async () => {
    const { dir, path } = tmpFile();
    try {
      const s1 = new FileTokenStore(path);
      await s1.put(makeRecord({ id: "r1", secretHash: "h1", family: "F" }));
      await s1.put(makeRecord({ id: "r2", secretHash: "h2", family: "F" }));
      await s1.flushNow();

      const s2 = new FileTokenStore(path);
      await s2.revokeFamily("F", "reuse_detected");
      assert.equal((await s2.findById("r1"))?.revokedReason, "reuse_detected");
      assert.equal((await s2.findById("r2"))?.revokedReason, "reuse_detected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fichier absent → état vide, pas de throw", async () => {
    const { dir, path } = tmpFile();
    try {
      const s = new FileTokenStore(join(dir, "does-not-exist.json"));
      assert.equal(await s.findById("x"), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    void path;
  });

  it("fichier corrompu → repart vide sans throw", async () => {
    const { dir, path } = tmpFile();
    try {
      writeFileSync(path, "{ ceci n'est pas du JSON");
      const s = new FileTokenStore(path);
      assert.equal(await s.findById("x"), null);
      // le store reste fonctionnel (réécrira un fichier sain au prochain flush)
      await s.put(makeRecord({ id: "ok", secretHash: "h" }));
      await s.flushNow();
      assert.equal((await new FileTokenStore(path).findById("ok"))?.id, "ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("markUsed, revoke et gc persistent aussi (tous les chemins d'écriture)", async () => {
    const { dir, path } = tmpFile();
    try {
      const s1 = new FileTokenStore(path, Date.now, 0); // rétention nulle
      await s1.put(makeRecord({ id: "a", secretHash: "h", expiresAt: null }));
      await s1.markUsed("a", { at: 123, ip: "10.0.0.1" });
      await s1.revoke("a", "manual");
      const purged = await s1.gc(); // PAT révoqué + rétention 0 → purgé
      assert.equal(purged, 1);
      await s1.flushNow();

      const s2 = new FileTokenStore(path);
      assert.equal(await s2.findById("a"), null); // purge persistée
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("le flush différé écrit tout seul (timer debounce, sans flushNow)", async () => {
    const { dir, path } = tmpFile();
    try {
      const s1 = new FileTokenStore(path, Date.now, undefined, 1); // debounce 1 ms
      await s1.put(makeRecord({ id: "a", secretHash: "h" }));
      // pas de flushNow : on laisse le timer coalescé écrire de lui-même.
      await new Promise((resolve) => setTimeout(resolve, 25));
      const s2 = new FileTokenStore(path);
      assert.equal((await s2.findById("a"))?.id, "a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("location expose le chemin physique du fichier (introspection Studio)", () => {
    const { dir, path } = tmpFile();
    try {
      assert.equal(new FileTokenStore(path).location, path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
