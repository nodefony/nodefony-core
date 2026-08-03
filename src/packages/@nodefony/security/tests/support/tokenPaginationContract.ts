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

/**
 * Le seed déterministe partagé par tous les backends — 12 jetons.
 *
 * Répartition des ÉTATS, qui est ce que la console compte :
 * - **3 révoqués** (`i % 4 === 0` → 0, 4, 8) ;
 * - **2 expirés** — les jetons 1 et 2, non révoqués, portent une échéance en
 *   1970 (donc toujours dépassée, quelle que soit l'horloge du test) ;
 * - **7 actifs** — le reste, sans échéance.
 *
 * Les deux échéances sont posées sur des jetons NON révoqués à dessein : c'est
 * le seul moyen de distinguer « expiré » d'« actif », que l'ancien filtre
 * booléen `revoked` mettait dans le même sac.
 */
export function tokenSeed(): IAccessTokenRecord[] {
  const out: IAccessTokenRecord[] = [];
  for (let i = 0; i < 12; i += 1) {
    const refresh = i % 3 === 0;
    const revoked = i % 4 === 0;
    out.push(
      makeTokenRecord({
        id: `tok-${String(i).padStart(2, "0")}`,
        kind: refresh ? "refresh" : "pat",
        subjectId: i < 5 ? "s1" : "s2",
        createdAt: 1000 + i,
        expiresAt: i === 1 || i === 2 ? 500 : null,
        revokedAt: revoked ? 2000 + i : null,
        revokedReason: revoked ? "manual" : null,
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

    it("rejette le mode de pagination que le store ne supporte pas (400)", async () => {
      const adverse =
        harness.mode === "offset"
          ? { limit: 4, cursor: "zzz" }
          : { limit: 4, offset: 8 };
      // try/catch (PAS assert.rejects) : la garde peut throw SYNCHRONIQUEMENT
      // (store non-async) OU rejeter (store async) — `await` capte les deux.
      let thrown: unknown;
      try {
        await store().listPage(adverse);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, "un mode de pagination non supporté doit être rejeté");
      assert.equal((thrown as { code?: unknown }).code, 400);
      assert.ok(thrown instanceof Error);
      assert.match((thrown as Error).message, /pagination mode/i);
    });

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

      // Les trois états PARTITIONNENT le parc (3 + 2 + 7 = 12). Le banc les
      // vérifie séparément ET vérifie la somme : un backend qui rangerait un
      // jeton révoqué-puis-échu dans deux populations passerait chaque cas isolé
      // tout en faisant dépasser le total.
      it("filtre status : révoqué / expiré / actif partitionnent le parc", async () => {
        assert.equal(
          (await store().listPage({ limit: 100, status: "revoked" })).total,
          3,
        );
        assert.equal(
          (await store().listPage({ limit: 100, status: "expired" })).total,
          2,
          "échéance dépassée, jamais révoqué",
        );
        assert.equal(
          (await store().listPage({ limit: 100, status: "active" })).total,
          7,
          "ni révoqué, ni échu — sans échéance compte comme actif",
        );
        assert.equal(
          (await store().listPage({ limit: 100 })).total,
          12,
          "3 + 2 + 7 : aucun jeton dans deux états, aucun sans état",
        );
      });

      it("status expiré n'attrape PAS un jeton révoqué qui a aussi expiré", async () => {
        // Le seed n'en contient pas ; on en pose un pour forcer le cas, puis on
        // remet le parc en état — les cas suivants comptent dessus.
        await store().put(
          makeTokenRecord({
            id: "tok-both",
            kind: "pat",
            subjectId: "s1",
            createdAt: 999,
            expiresAt: 500,
            revokedAt: 1500,
            revokedReason: "manual",
          }),
        );
        try {
          assert.equal(
            (await store().listPage({ limit: 100, status: "expired" })).total,
            2,
            "révoqué l'emporte sur expiré",
          );
          assert.equal(
            (await store().listPage({ limit: 100, status: "revoked" })).total,
            4,
          );
        } finally {
          await harness.clear();
          for (const record of tokenSeed()) await harness.store().put(record);
        }
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

      // ── TRI : ce qu'un store DÉCLARE savoir trier, il le trie VRAIMENT ─────
      // Le vocabulaire (`createdAt`, `name`, `subjectId`, `id`) est public et
      // identique partout : `?order=` doit produire le même ordre sur mémoire,
      // SQLite, PostgreSQL, MySQL et Mongo. Un store mémoire qui trierait en dur
      // passerait tous les tests ci-dessus tout en mentant sur la production.
      it("un store à offset DÉCLARE son vocabulaire de tri public", async () => {
        const fields = store().sortableFields;
        assert.ok(
          fields && fields.length > 0,
          "un backend offset doit déclarer ses champs triables",
        );
        assert.ok(
          fields!.includes("createdAt"),
          "`createdAt` est l'axe contractuel d'une console de clés",
        );
      });

      it("`order` inverse réellement le sens (createdAt ASC)", async () => {
        const page = await store().listPage({
          limit: 12,
          order: [["createdAt", "ASC"]],
        });
        assert.deepEqual(
          page.items.map((r) => r.id),
          tokenSeed().map((r) => r.id),
          "ASC doit rendre l'ordre d'écriture du seed",
        );
      });

      it("`order` sur `id` trie par identifiant, dans les deux sens", async () => {
        const asc = await store().listPage({
          limit: 12,
          order: [["id", "ASC"]],
        });
        const ids = asc.items.map((r) => r.id);
        assert.deepEqual(ids, [...ids].sort());

        const desc = await store().listPage({
          limit: 12,
          order: [["id", "DESC"]],
        });
        assert.deepEqual(
          desc.items.map((r) => r.id),
          [...ids].reverse(),
        );
      });

      it("`order` sur `name` trie sur le libellé humain", async () => {
        const page = await store().listPage({
          limit: 12,
          order: [["name", "ASC"]],
        });
        const names = page.items.map((r) => r.name);
        assert.deepEqual(names, [...names].sort());
      });

      it("chaque champ DÉCLARÉ est effectivement honoré", async () => {
        // La garde qui empêche d'annoncer une capacité qu'on n'a pas : le data
        // plane refuse en 400 tout champ hors de cette liste, donc tout ce qui y
        // figure DOIT trier — sans quoi la console offrirait un en-tête inerte.
        //
        // On vérifie la MONOTONIE de la suite de valeurs, pas l'inversion des
        // identifiants : `subjectId` n'a que deux valeurs dans le seed, et
        // l'ordre des ex æquo n'est garanti par aucun backend.
        const declared = store().sortableFields ?? [];
        // Sans cette borne, un store qui ne déclare RIEN ferait passer ce test
        // sur une boucle vide — un test qui ne lit rien ne garantit rien.
        assert.ok(
          declared.length > 0,
          "un backend offset doit déclarer au moins un champ triable",
        );
        for (const field of declared) {
          const read = (r: IAccessTokenRecord): string =>
            String(r[field as keyof IAccessTokenRecord]);
          const asc = (
            await store().listPage({ limit: 12, order: [[field, "ASC"]] })
          ).items.map(read);
          const desc = (
            await store().listPage({ limit: 12, order: [[field, "DESC"]] })
          ).items.map(read);
          assert.deepEqual(
            asc,
            [...asc].sort(),
            `"${field}" ASC doit rendre une suite croissante`,
          );
          assert.deepEqual(
            desc,
            [...desc].sort().reverse(),
            `"${field}" DESC doit rendre une suite décroissante`,
          );
        }
      });

      it("le tri s'applique AVANT la pagination (pas page par page)", async () => {
        // Le piège classique : trier la tranche déjà découpée. La 2ᵉ page d'un
        // tri ASC doit continuer la 1ʳᵉ, pas recommencer.
        const p1 = await store().listPage({
          limit: 4,
          offset: 0,
          order: [["id", "ASC"]],
        });
        const p2 = await store().listPage({
          limit: 4,
          offset: 4,
          order: [["id", "ASC"]],
        });
        const all = [...p1.items, ...p2.items].map((r) => r.id);
        assert.deepEqual(
          all,
          [...all].sort(),
          "les pages se suivent dans l'ordre",
        );
      });
    } else {
      it("un store à curseur NE DÉCLARE PAS de tri (il n'en a pas)", async () => {
        // `SCAN` parcourt le keyspace dans un ordre non spécifié : il n'existe
        // aucun tri global à offrir. Le déclarer quand même serait la seule faute
        // possible ici — le data plane exposerait alors un tri qui ne trierait
        // rien, et personne ne le verrait. L'absence de déclaration fait refuser
        // tout `?order=` en 400, ce qui est la vérité de ce backend.
        const fields = store().sortableFields;
        assert.ok(
          !fields || fields.length === 0,
          "un backend curseur ne doit annoncer aucun champ triable",
        );
      });

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
