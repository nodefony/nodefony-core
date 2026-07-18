import assert from "node:assert/strict";
import type { IAccessTokenRecord, ITokenStore } from "../../index";

/**
 * **Banc de contrat UNIQUE** du standard de pagination des jetons
 * (`ITokenStore.listPage` / `countTokens`). Backend-agnostique : ne dépend que du
 * contrat, se branche sur n'importe quel store via un harness (mémoire, Drizzle ×
 * sqlite/postgres/mysql, Mongoose, Redis). Vit dans `@nodefony/security` — le
 * propriétaire du contrat — pour être importé par tous les adapters (jamais dupliqué).
 *
 * **Deux capacités** selon le backend (déclarées par `harness.mode`) :
 * - `offset` (SQL/Mongo/mémoire) : `total` exact, ordre `createdAt` DESC déterministe ;
 * - `cursor` (Redis SCAN) : pas de `total` ni d'ordre global, pages de taille variable
 *   (le client boucle sur `nextCursor`) — capacité réduite ASSUMÉE.
 *
 * Seed déterministe : 12 jetons `tok-00`…`tok-11`, `createdAt` distincts, avec
 * `subjectId` s1 (5) / s2 (7), `kind` refresh sur les ×3 (4) / pat (8), révoqués
 * sur les ×4 (3).
 */
const PAT = "pat";

/** Fabrique un record complet (défauts sûrs) — seul l'`id` est requis. */
export function makeTokenRecord(
  over: Partial<IAccessTokenRecord> & { id: string },
): IAccessTokenRecord {
  return {
    id: over.id,
    kind: over.kind ?? "pat",
    name: over.name ?? over.id,
    prefix: over.prefix ?? null,
    subjectId: over.subjectId ?? "s1",
    subjectType: over.subjectType ?? "user",
    tenantId: over.tenantId ?? null,
    scopes: over.scopes ?? [],
    audience: over.audience ?? [],
    resources: over.resources ?? null,
    secretHash: over.secretHash ?? `hash-${over.id}`,
    hashAlg: over.hashAlg ?? "sha256",
    clientId: over.clientId ?? null,
    cnf: over.cnf ?? null,
    family: over.family ?? null,
    replacedBy: over.replacedBy ?? null,
    createdAt: over.createdAt ?? 0,
    expiresAt: over.expiresAt ?? null,
    lastUsedAt: over.lastUsedAt ?? null,
    lastUsedIp: over.lastUsedIp ?? null,
    lastUsedUserAgent: over.lastUsedUserAgent ?? null,
    revokedAt: over.revokedAt ?? null,
    revokedReason: over.revokedReason ?? null,
    metadata: over.metadata ?? {},
  };
}

/** Le seed déterministe partagé par tous les backends. */
export function tokenSeed(): IAccessTokenRecord[] {
  const out: IAccessTokenRecord[] = [];
  for (let i = 0; i < 12; i += 1) {
    const refresh = i % 3 === 0;
    out.push(
      makeTokenRecord({
        id: `tok-${String(i).padStart(2, "0")}`,
        kind: refresh ? "refresh" : "pat",
        subjectId: i < 5 ? "s1" : "s2",
        createdAt: 1000 + i,
        revokedAt: i % 4 === 0 ? 2000 + i : null,
        revokedReason: i % 4 === 0 ? "manual" : null,
        family: refresh ? `fam-${i}` : null,
      }),
    );
  }
  return out;
}

export interface TokenPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => ITokenStore;
  /** Vide le store avant le seed (banc idempotent). */
  clear: () => Promise<void>;
  /** Capacité de pagination du backend. */
  mode: "offset" | "cursor";
}

/** Collecte toutes les pages d'un listing par curseur (dédup SCAN par id). */
async function collectByCursor(
  store: ITokenStore,
  base: { subjectId?: string; kind?: "pat" | "refresh"; revoked?: boolean },
): Promise<IAccessTokenRecord[]> {
  const byId = new Map<string, IAccessTokenRecord>();
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await store.listPage({ ...base, limit: 5, cursor });
    for (const r of page.items) byId.set(r.id, r); // SCAN peut répéter → dédup
    cursor = page.nextCursor ?? undefined;
    guard += 1;
  } while (cursor && guard < 100);
  return [...byId.values()];
}

/** Déroule la suite du contrat de pagination des jetons sur le store branché. */
export function runTokenPaginationContract(
  harness: TokenPaginationHarness,
): void {
  describe(`listPage / countTokens — contrat de pagination jetons (${harness.mode})`, () => {
    beforeAll(async () => {
      await harness.clear();
      for (const record of tokenSeed()) await harness.store().put(record);
    });
    const store = () => harness.store();

    // Invariant valable dans LES DEUX modes : `IPage.items` contient « au plus
    // `limit` » éléments. Trivial en SQL (`LIMIT`), il ne l'est PAS en Redis :
    // `SCAN COUNT` est un indice d'effort, pas un plafond — un batch peut rendre
    // plus de clés que demandé. Sans ce test, le débordement passe inaperçu tant
    // qu'on ne teste que contre un double.
    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 5 });
      assert.ok(
        page.items.length <= 5,
        `page de ${page.items.length} éléments pour limit=5`,
      );
      assert.equal(page.limit, 5);
    });

    if (harness.mode === "offset") {
      it("page + total + hasNext (tri createdAt DESC)", async () => {
        const first = await store().listPage({ limit: 5, offset: 0 });
        assert.equal(first.total, 12);
        assert.equal(first.items.length, 5);
        assert.equal(first.hasNext, true);
        assert.equal(first.items[0].id, "tok-11"); // createdAt le plus récent
        assert.equal(first.items[4].id, "tok-07");

        const last = await store().listPage({ limit: 5, offset: 10 });
        assert.equal(last.items.length, 2);
        assert.equal(last.hasNext, false);
      });

      it("filtre subjectId", async () => {
        assert.equal(
          (await store().listPage({ limit: 100, subjectId: "s1" })).total,
          5,
        );
      });

      it("filtre kind", async () => {
        assert.equal(
          (await store().listPage({ limit: 100, kind: PAT })).total,
          8,
        );
      });

      it("filtre revoked (présence de revokedAt)", async () => {
        assert.equal(
          (await store().listPage({ limit: 100, revoked: true })).total,
          3,
        );
        assert.equal(
          (await store().listPage({ limit: 100, revoked: false })).total,
          9,
        );
      });

      it("withTotal:false → total omis, hasNext fiable", async () => {
        const page = await store().listPage({ limit: 5, withTotal: false });
        assert.equal(page.total, undefined);
        assert.equal(page.items.length, 5);
        assert.equal(page.hasNext, true);
      });

      it("countTokens = COUNT natif filtré", async () => {
        assert.equal(await store().countTokens({ limit: 1, kind: PAT }), 8);
        assert.equal(
          await store().countTokens({ limit: 1, subjectId: "s2" }),
          7,
        );
      });
    } else {
      it("curseur : collecte toutes les pages (ensemble complet)", async () => {
        const all = await collectByCursor(store(), {});
        assert.equal(all.length, 12);
      });

      it("curseur : filtre kind appliqué sur chaque page", async () => {
        const pats = await collectByCursor(store(), { kind: PAT });
        assert.equal(pats.length, 8);
        assert.ok(pats.every((r) => r.kind === "pat"));
      });

      it("curseur : filtre subjectId", async () => {
        const s1 = await collectByCursor(store(), { subjectId: "s1" });
        assert.equal(s1.length, 5);
      });

      it("countTokens = -1 (capacité réduite Redis assumée)", async () => {
        assert.equal(await store().countTokens({ limit: 1 }), -1);
      });
    }
  });
}
