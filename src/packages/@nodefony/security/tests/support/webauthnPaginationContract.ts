import assert from "node:assert/strict";
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
  IWebAuthnCredentialSummary,
} from "../../index";

/**
 * **Banc de contrat UNIQUE** du listing paginé des passkeys
 * (`IWebAuthnCredentialStore.listPage` / `countCredentials`). Backend-agnostique :
 * se branche sur n'importe quel store via un harness (mémoire, Drizzle ×
 * sqlite/postgres/mysql, Mongoose, Redis). Vit chez le propriétaire du contrat.
 *
 * **Deux capacités** selon le backend (déclarées par `harness.mode`) :
 * - `offset` (SQL/Mongo/mémoire) : `total` exact, ordre `createdAt` DESC déterministe ;
 * - `cursor` (Redis, dont l'index par utilisateur est un Set) : pas de `total` ni
 *   d'ordre global, pages de taille variable — capacité réduite ASSUMÉE.
 *
 * Il porte aussi une exigence de PROJECTION : la vue admin ne contient pas la clé
 * publique. Un backend qui élargirait sa projection casse ici.
 *
 * Seed déterministe : 12 passkeys `cred-00`…`cred-11`, `createdAt` distincts,
 * porteurs `u1` (5) / `u2` (7), sauvegardées sauf les ×3 (4 liées à un appareil).
 */

/** Fabrique un credential complet (défauts sûrs) — seul l'`id` est requis. */
export function makeWebAuthnCredential(
  over: Partial<IWebAuthnCredential> & { id: string },
): IWebAuthnCredential {
  return {
    id: over.id,
    userId: over.userId ?? "u1",
    publicKey: over.publicKey ?? `pk-${over.id}`,
    signCount: over.signCount ?? 0,
    transports: over.transports ?? ["internal"],
    backupEligible: over.backupEligible ?? true,
    backupState: over.backupState ?? true,
    uvInitialized: over.uvInitialized ?? true,
    createdAt: over.createdAt ?? 0,
    lastUsedAt: over.lastUsedAt ?? null,
    ...(over.nickname !== undefined ? { nickname: over.nickname } : {}),
  };
}

/** Le seed déterministe partagé par tous les backends. */
export function webauthnSeed(): IWebAuthnCredential[] {
  const out: IWebAuthnCredential[] = [];
  for (let i = 0; i < 12; i += 1) {
    const backedUp = i % 3 !== 0;
    out.push(
      makeWebAuthnCredential({
        id: `cred-${String(i).padStart(2, "0")}`,
        userId: i < 5 ? "u1" : "u2",
        createdAt: 1000 + i,
        signCount: i,
        backupState: backedUp,
        backupEligible: backedUp,
        lastUsedAt: i % 2 === 0 ? 5000 + i : null,
      }),
    );
  }
  return out;
}

export interface WebAuthnPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IWebAuthnCredentialStore;
  /** Vide le store avant le seed (banc idempotent). */
  clear: () => Promise<void>;
  /** Capacité de pagination du backend. */
  mode: "offset" | "cursor";
}

/** Collecte toutes les pages d'un listing par curseur (dédup SCAN par id). */
async function collectByCursor(
  store: IWebAuthnCredentialStore,
  base: { userId?: string; backedUp?: boolean },
): Promise<IWebAuthnCredentialSummary[]> {
  const byId = new Map<string, IWebAuthnCredentialSummary>();
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await store.listPage({ ...base, limit: 5, cursor });
    for (const c of page.items) byId.set(c.id, c); // SCAN peut répéter → dédup
    cursor = page.nextCursor ?? undefined;
    guard += 1;
  } while (cursor && guard < 100);
  return [...byId.values()];
}

/** Déroule la suite du contrat de listing des passkeys sur le store branché. */
export function runWebAuthnPaginationContract(
  harness: WebAuthnPaginationHarness,
): void {
  describe(`listPage / countCredentials — contrat de listing passkeys (${harness.mode})`, () => {
    beforeAll(async () => {
      await harness.clear();
      for (const cred of webauthnSeed()) await harness.store().save(cred);
    });
    const store = () => harness.store();

    // Invariant valable dans LES DEUX modes. Trivial en SQL (`LIMIT`), il ne
    // l'est PAS en Redis : `SCAN COUNT` est un indice d'effort, pas un plafond.
    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 5 });
      assert.ok(
        page.items.length <= 5,
        `page de ${page.items.length} éléments pour limit=5`,
      );
      assert.equal(page.limit, 5);
    });

    // La raison d'être du chantier : le listing admin ne doit JAMAIS servir de
    // `allowCredentials`. La projection le rend impossible par construction.
    it("🔒 la vue admin ne porte PAS la clé publique", async () => {
      const page = await store().listPage({ limit: 100 });
      assert.ok(page.items.length > 0);
      for (const item of page.items) {
        const raw = item as unknown as Record<string, unknown>;
        assert.equal(raw.publicKey, undefined, "publicKey ne doit pas sortir");
      }
    });

    it("porte ce qui S'EXPLOITE (sauvegarde, compteur anti-clone, usage)", async () => {
      const page = await store().listPage({ limit: 100, userId: "u1" });
      const one = page.items.find((c) => c.id === "cred-04");
      assert.ok(one);
      assert.equal(one.signCount, 4);
      assert.equal(one.backupState, true);
      assert.equal(one.uvInitialized, true);
      assert.deepEqual(one.transports, ["internal"]);
    });

    if (harness.mode === "offset") {
      it("page + total + hasNext (tri createdAt DESC)", async () => {
        const first = await store().listPage({ limit: 5, offset: 0 });
        assert.equal(first.total, 12);
        assert.equal(first.items.length, 5);
        assert.equal(first.hasNext, true);
        assert.equal(first.items[0].id, "cred-11"); // createdAt le plus récent
        assert.equal(first.items[4].id, "cred-07");

        const last = await store().listPage({ limit: 5, offset: 10 });
        assert.equal(last.items.length, 2);
        assert.equal(last.hasNext, false);
        assert.equal(last.items[1].id, "cred-00");
      });

      it("parcours complet : 12 passkeys DISTINCTES, aucune perdue", async () => {
        const seen = new Set<string>();
        for (let offset = 0; offset < 12; offset += 5) {
          const page = await store().listPage({ limit: 5, offset });
          for (const c of page.items) seen.add(c.id);
        }
        assert.equal(seen.size, 12);
      });

      it("filtre userId (les appareils d'un porteur)", async () => {
        const u1 = await store().listPage({ limit: 100, userId: "u1" });
        assert.equal(u1.total, 5);
        assert.ok(u1.items.every((c) => c.userId === "u1"));
        assert.equal(
          (await store().listPage({ limit: 100, userId: "u2" })).total,
          7,
        );
      });

      it("filtre backedUp : les passkeys qui MEURENT avec leur appareil", async () => {
        const fragile = await store().listPage({ limit: 100, backedUp: false });
        assert.equal(fragile.total, 4);
        assert.ok(fragile.items.every((c) => c.backupState === false));
        assert.equal(
          (await store().listPage({ limit: 100, backedUp: true })).total,
          8,
        );
      });

      it("q filtre par PRÉFIXE d'userId", async () => {
        assert.equal(
          (await store().listPage({ limit: 100, q: "u" })).total,
          12,
        );
        assert.equal(
          (await store().listPage({ limit: 100, q: "u2" })).total,
          7,
        );
        assert.equal(
          (await store().listPage({ limit: 100, q: "zzz" })).total,
          0,
        );
      });

      it("withTotal:false → total omis, hasNext fiable", async () => {
        const page = await store().listPage({ limit: 5, withTotal: false });
        assert.equal(page.total, undefined);
        assert.equal(page.items.length, 5);
        assert.equal(page.hasNext, true);
      });

      it("countCredentials = COUNT natif filtré", async () => {
        assert.equal(await store().countCredentials({ limit: 1 }), 12);
        assert.equal(
          await store().countCredentials({ limit: 1, userId: "u1" }),
          5,
        );
        assert.equal(
          await store().countCredentials({ limit: 1, backedUp: false }),
          4,
        );
      });
    } else {
      it("curseur : collecte toutes les pages (ensemble complet)", async () => {
        const all = await collectByCursor(store(), {});
        assert.equal(all.length, 12);
      });

      it("curseur : filtre userId appliqué sur chaque page", async () => {
        const u1 = await collectByCursor(store(), { userId: "u1" });
        assert.equal(u1.length, 5);
        assert.ok(u1.every((c) => c.userId === "u1"));
      });

      it("curseur : filtre backedUp", async () => {
        const fragile = await collectByCursor(store(), { backedUp: false });
        assert.equal(fragile.length, 4);
        assert.ok(fragile.every((c) => c.backupState === false));
      });

      it("countCredentials = -1 (capacité réduite Redis assumée)", async () => {
        assert.equal(await store().countCredentials({ limit: 1 }), -1);
      });
    }
  });
}
