import assert from "node:assert/strict";
import type { IIdempotencyKeyEntry, IIdempotencyStore } from "../../index";

/**
 * **Banc de contrat UNIQUE** du listing paginé des clés d'idempotence
 * (`IIdempotencyStore.listPage`). Backend-agnostique : se branche sur n'importe
 * quel store via un harness (mémoire, Redis, Drizzle × 3 dialectes). Vit au
 * CORE — le propriétaire du contrat — pour être importé par `framework` et
 * `drizzle` sans duplication.
 *
 * Il porte une exigence de SÉCURITÉ autant que de pagination : la réponse
 * mémorisée d'une mutation est la donnée métier d'un utilisateur. Un backend qui
 * la laisserait remonter par ce chemin recréerait l'IDOR sur le cache que le
 * contrat interdit — le test `🔒` échoue alors.
 *
 * **Deux capacités** selon le backend (déclarées par `harness.mode`) :
 * - `offset` (mémoire, SQL) : `total` exact, ordre `expiresAtMs` ASC ;
 * - `cursor` (Redis `SCAN`) : pas de `total` ni d'ordre global, pages de taille
 *   variable — le client boucle sur `nextCursor`. Capacité réduite ASSUMÉE.
 */

export interface IdempotencyPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IIdempotencyStore;
  /** Prépare une ardoise propre (banc idempotent). */
  clear: () => Promise<void>;
  /** Capacité de pagination du backend. */
  mode: "offset" | "cursor";
  /**
   * Sème `n` clés `<prefix>-00…` : `done` une sur deux (réponse mémorisée),
   * `in-flight` sinon. Le harness sait seul comment atteindre les deux états sur
   * son backend (l'API publique `begin`/`complete` suffit partout).
   */
  seed: (prefix: string, n: number) => Promise<void>;
  /**
   * **Capacité optionnelle** : rend échues toutes les entrées déjà semées (en
   * avançant l'horloge du backend, ou en semant dans le passé). Fournie, elle
   * déverrouille la vérification qu'une clé expirée **ne sort pas** du listing.
   *
   * Sans elle le cas est **annoncé skippé** plutôt que silencieusement absent :
   * un store qui oublierait son filtre d'échéance resterait vert, et le listing
   * présenterait un parc mort comme s'il était encore opposable.
   */
  expireSeeded?: () => Promise<void>;
}

/** Collecte toutes les pages d'un listing par curseur (dédup SCAN par clé). */
async function collectByCursor(
  store: IIdempotencyStore,
  base: { state?: "in-flight" | "done"; q?: string },
): Promise<IIdempotencyKeyEntry[]> {
  const byKey = new Map<string, IIdempotencyKeyEntry>();
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await store.listPage({ ...base, limit: 4, cursor });
    assert.ok(
      page.items.length <= 4,
      `page de ${page.items.length} éléments pour limit=4`,
    );
    for (const e of page.items) byKey.set(e.key, e); // SCAN peut répéter → dédup
    cursor = page.nextCursor ?? undefined;
    guard += 1;
  } while (cursor && guard < 100);
  return [...byKey.values()];
}

/** Déroule la suite du contrat de listing d'idempotence sur le store branché. */
export function runIdempotencyPaginationContract(
  harness: IdempotencyPaginationHarness,
): void {
  describe(`listPage — contrat de listing d'idempotence (${harness.mode})`, () => {
    beforeAll(async () => {
      await harness.clear();
      await harness.seed("nf-a", 10);
    });
    const store = () => harness.store();

    // Invariant valable dans LES DEUX modes. Trivial en SQL (`LIMIT`), il ne
    // l'est PAS en Redis : `SCAN COUNT` est un indice d'effort, pas un plafond —
    // un batch peut rendre plus de clés que demandé. Sans ce test, le
    // débordement passe inaperçu tant qu'on ne teste que contre un double.
    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 3 });
      assert.ok(
        page.items.length <= 3,
        `page de ${page.items.length} éléments pour limit=3`,
      );
      assert.equal(page.limit, 3);
    });

    it("🔒 la vue ne porte NI la réponse mémorisée NI le fingerprint", async () => {
      const page = await store().listPage({ limit: 100 });
      assert.ok(page.items.length > 0, "le seed doit produire des entrées");
      for (const item of page.items) {
        const raw = item as unknown as Record<string, unknown>;
        assert.equal(raw.response, undefined, "la réponse ne doit pas sortir");
        assert.equal(raw.body, undefined);
        assert.equal(raw.fingerprint, undefined);
        // Le FAIT qu'une réponse existe, lui, est exposé.
        assert.equal(typeof item.hasResponse, "boolean");
        assert.ok(item.state === "in-flight" || item.state === "done");
        // `hasResponse` est la projection fidèle de l'état, pas un champ libre.
        assert.equal(item.hasResponse, item.state === "done");
      }
    });

    it("les deux états sont représentés (in-flight ET done)", async () => {
      const all =
        harness.mode === "cursor"
          ? await collectByCursor(store(), {})
          : (await store().listPage({ limit: 100 })).items;
      assert.ok(
        all.some((e) => e.state === "in-flight"),
        "au moins une clé in-flight",
      );
      assert.ok(
        all.some((e) => e.state === "done"),
        "au moins une clé done",
      );
    });

    it("filtre state", async () => {
      const done =
        harness.mode === "cursor"
          ? await collectByCursor(store(), { state: "done" })
          : (await store().listPage({ limit: 100, state: "done" })).items;
      assert.ok(done.length > 0);
      assert.ok(done.every((e) => e.state === "done"));

      const inflight =
        harness.mode === "cursor"
          ? await collectByCursor(store(), { state: "in-flight" })
          : (await store().listPage({ limit: 100, state: "in-flight" })).items;
      assert.ok(inflight.length > 0);
      assert.ok(inflight.every((e) => e.state === "in-flight"));
    });

    it("q filtre par PRÉFIXE de clé (les clés sont composées → le préfixe isole un scope)", async () => {
      await harness.seed("nf-b", 4);
      const a =
        harness.mode === "cursor"
          ? await collectByCursor(store(), { q: "nf-a" })
          : (await store().listPage({ limit: 100, q: "nf-a" })).items;
      assert.equal(a.length, 10);
      assert.ok(a.every((e) => e.key.startsWith("nf-a")));

      const b =
        harness.mode === "cursor"
          ? await collectByCursor(store(), { q: "nf-b" })
          : (await store().listPage({ limit: 100, q: "nf-b" })).items;
      assert.equal(b.length, 4);
    });

    it("porte une échéance exploitable", async () => {
      const page = await store().listPage({ limit: 1 });
      assert.equal(typeof page.items[0].expiresAtMs, "number");
      assert.ok(
        page.items[0].expiresAtMs > 0,
        "une clé vivante a une échéance future",
      );
    });

    if (harness.mode === "offset") {
      it("page + total + hasNext (ordre expiresAtMs ASC)", async () => {
        const first = await store().listPage({
          limit: 4,
          offset: 0,
          q: "nf-a",
        });
        assert.equal(first.total, 10);
        assert.equal(first.items.length, 4);
        assert.equal(first.hasNext, true);
        const last = await store().listPage({ limit: 4, offset: 8, q: "nf-a" });
        assert.equal(last.items.length, 2);
        assert.equal(last.hasNext, false);
      });

      it("parcours complet : 10 clés DISTINCTES, aucune perdue", async () => {
        const seen = new Set<string>();
        for (let offset = 0; offset < 10; offset += 4) {
          const page = await store().listPage({ limit: 4, offset, q: "nf-a" });
          for (const e of page.items) seen.add(e.key);
        }
        assert.equal(seen.size, 10);
      });

      it("withTotal:false → total omis, hasNext fiable", async () => {
        const page = await store().listPage({
          limit: 4,
          withTotal: false,
          q: "nf-a",
        });
        assert.equal(page.total, undefined);
        assert.equal(page.items.length, 4);
        assert.equal(page.hasNext, true);
      });
    } else {
      it("curseur : collecte toutes les pages (ensemble complet, rien perdu)", async () => {
        const all = await collectByCursor(store(), { q: "nf-a" });
        assert.equal(all.length, 10);
      });

      it("curseur : pas de `total` inventé (capacité réduite assumée)", async () => {
        const page = await store().listPage({ limit: 4 });
        assert.equal(page.total, undefined);
      });
    }

    // Une clé échue n'est plus opposable : le GC applicatif passe plus tard,
    // mais entre-temps elle ne doit PAS figurer au parc vivant. Sans ce cas, un
    // store qui perd son filtre d'échéance reste vert — constaté sur le store
    // Drizzle, dont le filtre pouvait être retiré sans faire rougir la suite.
    // Placé en DERNIER : il périme le jeu de données de toute la suite.
    it.skipIf(!harness.expireSeeded)(
      "🔒 une clé ÉCHUE ne figure plus au listing",
      async () => {
        const before = await store().listPage({ limit: 100 });
        assert.ok(
          before.items.length > 0,
          "pré-condition : des clés vivantes avant expiration",
        );
        await harness.expireSeeded!();
        const after = await store().listPage({ limit: 100 });
        assert.deepEqual(
          after.items,
          [],
          "des clés échues sortent encore du listing",
        );
        assert.equal(after.hasNext, false);
        if (harness.mode === "offset") {
          assert.equal(after.total, 0);
        }
      },
    );
  });
}
