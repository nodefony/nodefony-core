import assert from "node:assert/strict";
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
} from "../../index";

/**
 * **Banc de contrat UNIQUE** du store de passkeys (`IWebAuthnCredentialStore`).
 * Backend-agnostique : se branche sur n'importe quel store via un harness
 * (mémoire, Drizzle × sqlite/postgres/mysql, Mongoose × MongoDB). Vit chez le
 * propriétaire du contrat — deux copies divergeraient en silence, chacune
 * passant ses propres tests.
 *
 * Enjeu : une passkey remplace le mot de passe. Deux propriétés doivent tenir
 * sur tout backend — le **`signCount`** (compteur anti-clonage FIDO : il doit
 * survivre exactement, y compris à 0 et sur de grandes valeurs) et les
 * **booléens** `backupEligible`/`backupState`/`uvInitialized`, qui traversent
 * des encodages différents selon le moteur — un `false` qui revient en `0`
 * truthy changerait une décision de sécurité.
 *
 * Le listing paginé a son propre banc (`webauthnPaginationContract`), branché
 * à part par chaque adaptateur.
 */
export interface WebAuthnStoreContractHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IWebAuthnCredentialStore;
  /** Vide le store (banc idempotent, et base réelle qui survit au run précédent). */
  clear: () => Promise<void>;
  /**
   * **Capacité optionnelle** : réchauffe le pool de connexions. Un pool froid
   * sérialise les premières requêtes et masque les courses que le cas d'écriture
   * concurrente existe pour débusquer.
   */
  warm?: () => Promise<void>;
}

/** Fabrique une passkey complète — surcharges par-dessus des défauts sûrs. */
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

/** Messages des promesses rejetées (lisibles dans l'assertion d'échec). */
function rejections(rs: PromiseSettledResult<unknown>[]): string[] {
  return rs
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason?.message);
}

/** Déroule la suite du contrat de store de passkeys sur le backend branché. */
export function runWebAuthnStoreContract(
  harness: WebAuthnStoreContractHarness,
): void {
  const store = () => harness.store();
  const purge = () => harness.clear();

  describe("save / findById", () => {
    it("save + findById : round-trip complet (transports JSON, booléens, epoch)", async () => {
      await purge();
      const credential = makeCredential({ id: "c1", signCount: 7 });
      await store().save(credential);
      const c = await store().findById("c1");
      assert.ok(c);
      // Égalité STRUCTURELLE : un champ ajouté, perdu ou retypé par un
      // backend (colonne en trop, `_id` qui fuit, `nickname: null`) fait
      // tomber ce cas.
      assert.deepEqual(c, credential);
      assert.deepEqual(c.transports, ["internal", "hybrid"]);
      assert.equal(c.signCount, 7);
      assert.equal(c.publicKey, "pk-c1");
      assert.equal(c.createdAt, 1_000_000);
      // Les booléens doivent revenir en VRAIS booléens (pas 0/1) : un `false`
      // truthy changerait une décision de sécurité.
      assert.equal(c.backupEligible, true);
      assert.equal(c.backupState, false);
      assert.equal(c.uvInitialized, true);
      assert.equal(typeof c.backupState, "boolean", "booléen, pas 0/1");
    });

    it("omet nickname quand la colonne est NULL (≠ null dans le contrat)", async () => {
      const c = await store().findById("c1");
      assert.equal("nickname" in (c as object), false, "clé ABSENTE, pas null");
    });

    it("conserve un nickname et un lastUsedAt non nuls", async () => {
      await store().save(
        makeCredential({
          id: "c2",
          nickname: "clé YubiKey 5 — é👩‍💻",
          lastUsedAt: 9_999,
        }),
      );
      const c = await store().findById("c2");
      assert.equal(c?.nickname, "clé YubiKey 5 — é👩‍💻");
      assert.equal(c?.lastUsedAt, 9_999);
    });

    it("ne partage pas `transports` avec l'appelant, ni à l'écriture ni à la lecture", async () => {
      const transports = ["usb"];
      await store().save(makeCredential({ id: "c-ref", transports }));
      transports.push("MUTATED");
      const first = await store().findById("c-ref");
      assert.deepEqual(first?.transports, ["usb"], "copie à l'écriture");
      assert.ok(first);
      // `readonly` ne protège qu'à la compilation : un appelant JS (ou un cast)
      // mute quand même à l'exécution — c'est ce que la copie doit absorber.
      const mutable = first as unknown as {
        transports: string[];
        signCount: number;
      };
      mutable.transports.push("MUTATED");
      mutable.signCount = 999;
      const again = await store().findById("c-ref");
      assert.deepEqual(again?.transports, ["usb"], "copie à la lecture");
      assert.equal(again?.signCount, 0);
    });

    it("findById d'un credential inconnu renvoie null", async () => {
      assert.equal(await store().findById("nope"), null);
    });

    it("save écrase un credential existant (upsert), 1 seule ligne", async () => {
      await store().save(makeCredential({ id: "c4", signCount: 1 }));
      await store().save(makeCredential({ id: "c4", signCount: 99 }));
      assert.equal((await store().findById("c4"))?.signCount, 99);
      assert.equal(
        (await store().findByUser("u1")).filter((c) => c.id === "c4").length,
        1,
      );
    });

    it("save CONCURRENT × 10 du même id : 0 rejet, une seule ligne", async () => {
      await harness.warm?.();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store().save(makeCredential({ id: "c-conc", signCount: i })),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(
        (await store().findByUser("u1")).filter((c) => c.id === "c-conc")
          .length,
        1,
      );
    });

    it("transports VIDE : tableau vide préservé (≠ null)", async () => {
      // Une passkey sans transport déclaré est légale ; `[]` ne doit pas
      // ressortir en `null` (le client itérerait sur null).
      await store().save(makeCredential({ id: "c-empty", transports: [] }));
      assert.deepEqual((await store().findById("c-empty"))?.transports, []);
    });

    it("signCount : 0 ≠ absent, et borne uint32 du W3C non tronquée", async () => {
      // Compteur anti-clonage FIDO. Deux pièges : un `0` confondu avec « absent »
      // (les authenticators d'Apple renvoient TOUJOURS 0) et une valeur tronquée
      // silencieusement, qui ferait diverger la détection de clonage.
      //
      // Le W3C définit `signCount` comme un **uint32** : la borne haute doit
      // survivre sur TOUT backend. La colonne SQL est un entier 64 bits
      // (`kind: "int64"`) — un int32 signé lèverait au-delà de 2 147 483 647.
      const UINT32_MAX = 4_294_967_295;
      await store().save(makeCredential({ id: "c-zero", signCount: 0 }));
      assert.equal(
        (await store().findById("c-zero"))?.signCount,
        0,
        "0 ≠ null",
      );
      await store().save(
        makeCredential({ id: "c-big", signCount: UINT32_MAX }),
      );
      assert.equal((await store().findById("c-big"))?.signCount, UINT32_MAX);
    });
  });

  describe("findByUser", () => {
    it("renvoie tous les credentials d'un utilisateur, et rien des autres", async () => {
      await purge();
      await store().save(makeCredential({ id: "m1", userId: "alice" }));
      await store().save(makeCredential({ id: "m2", userId: "alice" }));
      await store().save(makeCredential({ id: "m3", userId: "bob" }));
      const alice = await store().findByUser("alice");
      assert.deepEqual(alice.map((c) => c.id).sort(), ["m1", "m2"]);
    });

    it("renvoie [] pour un utilisateur sans credential", async () => {
      assert.deepEqual(await store().findByUser("ghost"), []);
    });

    it("un re-save du MÊME id sous un AUTRE porteur le retire de l'ancien", async () => {
      // La clé primaire est l'id de la passkey : une ligne, un porteur. Un
      // index par utilisateur qui garderait l'ancien lien ferait proposer à
      // l'ancien porteur une passkey qui ne lui appartient plus.
      await purge();
      await store().save(makeCredential({ id: "moved", userId: "alice" }));
      await store().save(makeCredential({ id: "moved", userId: "bob" }));
      assert.deepEqual(await store().findByUser("alice"), []);
      assert.equal(await store().countByUser("alice"), 0);
      assert.deepEqual(
        (await store().findByUser("bob")).map((c) => c.id),
        ["moved"],
      );
    });
  });

  describe("countByUser", () => {
    it("compte les credentials du porteur, et d'aucun autre", async () => {
      await purge();
      await store().save(makeCredential({ id: "c1", userId: "alice" }));
      await store().save(makeCredential({ id: "c2", userId: "alice" }));
      await store().save(makeCredential({ id: "c3", userId: "bob" }));
      assert.equal(await store().countByUser("alice"), 2);
      assert.equal(await store().countByUser("bob"), 1);
    });

    it("renvoie 0 pour un utilisateur sans credential", async () => {
      assert.equal(await store().countByUser("ghost"), 0);
    });

    it("suit save et delete (c'est ce qui LIBÈRE une place sous le plafond)", async () => {
      await purge();
      await store().save(makeCredential({ id: "n1", userId: "alice" }));
      assert.equal(await store().countByUser("alice"), 1);
      await store().save(makeCredential({ id: "n2", userId: "alice" }));
      assert.equal(await store().countByUser("alice"), 2);
      await store().delete("n1");
      assert.equal(await store().countByUser("alice"), 1);
    });

    it("un re-save du MÊME id ne double pas le compte (upsert)", async () => {
      await purge();
      await store().save(makeCredential({ id: "dup", userId: "alice" }));
      await store().save(makeCredential({ id: "dup", userId: "alice" }));
      assert.equal(await store().countByUser("alice"), 1);
    });
  });

  describe("update", () => {
    it("met à jour signCount / backupState / uvInitialized / lastUsedAt", async () => {
      await purge();
      await store().save(makeCredential({ id: "u-1" }));
      await store().update("u-1", {
        signCount: 42,
        backupState: true,
        uvInitialized: false,
        lastUsedAt: 123_456,
      });
      const c = await store().findById("u-1");
      assert.equal(c?.signCount, 42);
      assert.equal(c?.backupState, true);
      assert.equal(
        c?.uvInitialized,
        false,
        "false ÉCRIT (pas ignoré comme falsy)",
      );
      assert.equal(c?.lastUsedAt, 123_456);
      assert.equal(c?.publicKey, "pk-u-1", "la clé publique n'est PAS touchée");
      assert.equal(c?.userId, "u1", "le porteur n'est PAS touché");
      assert.equal(c?.createdAt, 1_000_000, "createdAt n'est PAS touché");
      assert.deepEqual(c?.transports, ["internal", "hybrid"]);
    });

    it("no-op si le credentialId est inconnu (ne lève pas, ne crée rien)", async () => {
      await store().update("jamais-vu", {
        signCount: 1,
        backupState: false,
        uvInitialized: true,
        lastUsedAt: 1,
      });
      assert.equal(await store().findById("jamais-vu"), null);
    });
  });

  describe("delete", () => {
    it("supprime le credential", async () => {
      await purge();
      await store().save(makeCredential({ id: "d1" }));
      await store().delete("d1");
      assert.equal(await store().findById("d1"), null);
    });

    it("est idempotent sur un credential inconnu", async () => {
      await store().delete("jamais-vu");
      await store().delete("d1");
    });

    it("ne supprime QUE la passkey visée (les autres du même user survivent)", async () => {
      await purge();
      await store().save(makeCredential({ id: "k1", userId: "multi" }));
      await store().save(makeCredential({ id: "k2", userId: "multi" }));
      await store().delete("k1");
      assert.deepEqual(
        (await store().findByUser("multi")).map((c) => c.id),
        ["k2"],
        "révoquer une passkey ne déconnecte pas les autres appareils",
      );
    });
  });
}
