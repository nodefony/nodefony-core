import assert from "node:assert/strict";
import type { IWebAuthnCredential } from "@nodefony/security";
import {
  RedisWebAuthnCredentialStore,
  type RedisClientLike,
} from "../../src/RedisWebAuthnCredentialStore";

/**
 * Double Redis **fidèle** aux commandes node-redis v6 utilisées par le store de
 * credentials (HASH + SET, sans TTL) → on teste la VRAIE logique du store contre
 * une sémantique Redis conforme, sans serveur.
 */
class FakeRedis implements RedisClientLike {
  readonly #hashes = new Map<string, Map<string, string>>();
  readonly #sets = new Map<string, Set<string>>();

  hSet(key: string, fields: Record<string, string>): Promise<number> {
    let m = this.#hashes.get(key);
    if (!m) {
      m = new Map();
      this.#hashes.set(key, m);
    }
    let n = 0;
    for (const [k, v] of Object.entries(fields)) {
      if (!m.has(k)) {
        n++;
      }
      m.set(k, v);
    }
    return Promise.resolve(n);
  }

  hGetAll(key: string): Promise<Record<string, string>> {
    const m = this.#hashes.get(key);
    return Promise.resolve(m ? Object.fromEntries(m) : {});
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(
      this.#hashes.has(key) || this.#sets.has(key) ? 1 : 0,
    );
  }

  del(key: string): Promise<number> {
    const had = this.#hashes.delete(key);
    const hadSet = this.#sets.delete(key);
    return Promise.resolve(had || hadSet ? 1 : 0);
  }

  sAdd(key: string, member: string): Promise<number> {
    let s = this.#sets.get(key);
    if (!s) {
      s = new Set();
      this.#sets.set(key, s);
    }
    const had = s.has(member);
    s.add(member);
    return Promise.resolve(had ? 0 : 1);
  }

  sRem(key: string, member: string): Promise<number> {
    const s = this.#sets.get(key);
    return Promise.resolve(s && s.delete(member) ? 1 : 0);
  }

  sMembers(key: string): Promise<string[]> {
    const s = this.#sets.get(key);
    return Promise.resolve(s ? [...s] : []);
  }

  // SCARD compte les MEMBRES du SET, sans regarder les HASH : un membre
  // orphelin est compté (c'est la sémantique Redis, et le store l'assume
  // fail-closed). Le fake ne doit surtout pas « corriger » ça.
  sCard(key: string): Promise<number> {
    return Promise.resolve(this.#sets.get(key)?.size ?? 0);
  }
}

/** Construit un `IWebAuthnCredential` complet avec surcharges. */
function makeCredential(
  over: Partial<IWebAuthnCredential> & Pick<IWebAuthnCredential, "id">,
): IWebAuthnCredential {
  return {
    userId: "u1",
    publicKey: `pk-${over.id}`,
    signCount: 0,
    transports: ["internal", "hybrid"],
    backupEligible: true,
    backupState: false,
    uvInitialized: true,
    createdAt: 1_000_000,
    lastUsedAt: null,
    ...over,
  };
}

describe("Redis RedisWebAuthnCredentialStore — IWebAuthnCredentialStore (J9)", () => {
  let fake: FakeRedis;
  let store: RedisWebAuthnCredentialStore;

  beforeEach(() => {
    fake = new FakeRedis();
    store = new RedisWebAuthnCredentialStore(() => fake);
  });

  describe("save / findById", () => {
    it("save + findById restitue le credential (transports + booléens + null)", async () => {
      const cred = makeCredential({ id: "c1", signCount: 7 });
      await store.save(cred);
      const found = await store.findById("c1");
      assert.deepEqual(found, cred);
      assert.equal(found?.signCount, 7);
      assert.deepEqual(found?.transports, ["internal", "hybrid"]);
      assert.equal(found?.backupEligible, true);
      assert.equal(found?.lastUsedAt, null);
    });

    it("conserve un nickname et un lastUsedAt non nuls", async () => {
      const cred = makeCredential({
        id: "c2",
        nickname: "MacBook de Chris",
        lastUsedAt: 1_234_567,
      });
      await store.save(cred);
      const found = await store.findById("c2");
      assert.equal(found?.nickname, "MacBook de Chris");
      assert.equal(found?.lastUsedAt, 1_234_567);
    });

    it("findById d'un credential inconnu renvoie null", async () => {
      assert.equal(await store.findById("nope"), null);
    });

    it("save écrase proprement (pas de champ obsolète après ré-enregistrement)", async () => {
      await store.save(makeCredential({ id: "c3", nickname: "ancien" }));
      await store.save(makeCredential({ id: "c3" })); // sans nickname
      const found = await store.findById("c3");
      assert.equal(found?.nickname, undefined);
      assert.equal("nickname" in (found as object), false);
    });
  });

  describe("findByUser", () => {
    it("renvoie tous les credentials d'un utilisateur", async () => {
      await store.save(makeCredential({ id: "a", userId: "alice" }));
      await store.save(makeCredential({ id: "b", userId: "alice" }));
      await store.save(makeCredential({ id: "c", userId: "bob" }));
      const alice = await store.findByUser("alice");
      assert.deepEqual(alice.map((c) => c.id).sort(), ["a", "b"]);
      const bob = await store.findByUser("bob");
      assert.deepEqual(
        bob.map((c) => c.id),
        ["c"],
      );
    });

    it("renvoie [] pour un utilisateur sans credential", async () => {
      assert.deepEqual(await store.findByUser("ghost"), []);
    });

    it("nettoie paresseusement un membre orphelin (credential supprimé hors delete)", async () => {
      await store.save(makeCredential({ id: "x", userId: "alice" }));
      await store.save(makeCredential({ id: "y", userId: "alice" }));
      // Simule un HASH disparu sans passer par delete() (TTL externe, purge manuelle).
      await fake.del("nf:wac:cred:x");
      const alice = await store.findByUser("alice");
      assert.deepEqual(
        alice.map((c) => c.id),
        ["y"],
      );
      // L'id orphelin a été retiré du SET → 2ᵉ lecture stable.
      assert.deepEqual(await fake.sMembers("nf:wac:user:alice"), ["y"]);
    });
  });

  describe("countByUser", () => {
    it("compte par porteur via SCARD, 0 si inconnu", async () => {
      await store.save(makeCredential({ id: "a", userId: "alice" }));
      await store.save(makeCredential({ id: "b", userId: "alice" }));
      await store.save(makeCredential({ id: "c", userId: "bob" }));
      assert.equal(await store.countByUser("alice"), 2);
      assert.equal(await store.countByUser("bob"), 1);
      assert.equal(await store.countByUser("ghost"), 0);
    });

    it("delete libère une place (c'est ce qui débloque un porteur au plafond)", async () => {
      await store.save(makeCredential({ id: "a", userId: "alice" }));
      await store.save(makeCredential({ id: "b", userId: "alice" }));
      await store.delete("a");
      assert.equal(await store.countByUser("alice"), 1);
    });

    it("SUR-COMPTE un membre orphelin — écart fail-closed assumé", async () => {
      // SCARD lit le SET sans regarder les HASH : un credential disparu hors
      // delete() reste compté jusqu'au prochain findByUser (nettoyage paresseux).
      // Conséquence voulue : au pire un enrôlement de plus est refusé, jamais un
      // de trop accepté.
      await store.save(makeCredential({ id: "x", userId: "alice" }));
      await store.save(makeCredential({ id: "y", userId: "alice" }));
      await fake.del("nf:wac:cred:x");
      assert.equal(await store.countByUser("alice"), 2);
      await store.findByUser("alice"); // nettoie l'orphelin
      assert.equal(await store.countByUser("alice"), 1);
    });
  });

  describe("update", () => {
    it("met à jour signCount / backupState / uvInitialized / lastUsedAt", async () => {
      await store.save(
        makeCredential({ id: "u", signCount: 0, uvInitialized: false }),
      );
      await store.update("u", {
        signCount: 42,
        backupState: true,
        uvInitialized: true,
        lastUsedAt: 9_999,
      });
      const found = await store.findById("u");
      assert.equal(found?.signCount, 42);
      assert.equal(found?.backupState, true);
      assert.equal(found?.uvInitialized, true);
      assert.equal(found?.lastUsedAt, 9_999);
    });

    it("no-op si le credentialId est inconnu (ne crée pas de HASH partiel)", async () => {
      await store.update("absent", {
        signCount: 1,
        backupState: false,
        uvInitialized: false,
        lastUsedAt: 1,
      });
      assert.equal(await store.findById("absent"), null);
    });
  });

  describe("delete", () => {
    it("supprime le credential ET le retire du SET utilisateur", async () => {
      await store.save(makeCredential({ id: "d1", userId: "alice" }));
      await store.save(makeCredential({ id: "d2", userId: "alice" }));
      await store.delete("d1");
      assert.equal(await store.findById("d1"), null);
      const alice = await store.findByUser("alice");
      assert.deepEqual(
        alice.map((c) => c.id),
        ["d2"],
      );
    });

    it("est idempotent sur un credential inconnu", async () => {
      await store.delete("never"); // ne throw pas
      assert.equal(await store.findById("never"), null);
    });
  });

  describe("dégradation gracieuse (connexion indisponible)", () => {
    it("lectures vides + écritures no-op quand le client est null", async () => {
      const offline = new RedisWebAuthnCredentialStore(() => null);
      assert.equal(await offline.findById("x"), null);
      assert.deepEqual(await offline.findByUser("u"), []);
      // Aucune de ces écritures ne doit throw.
      await offline.save(makeCredential({ id: "x" }));
      await offline.update("x", {
        signCount: 1,
        backupState: false,
        uvInitialized: false,
        lastUsedAt: 1,
      });
      await offline.delete("x");
    });
  });
});
