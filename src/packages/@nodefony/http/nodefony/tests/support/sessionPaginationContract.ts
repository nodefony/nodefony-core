/// <reference types="node" />
import assert from "node:assert/strict";
import type {
  ISessionStorage,
  ISessionRecord,
  ISessionListQuery,
} from "../../interfaces/ISession";

/**
 * **Banc de contrat UNIQUE** du standard de pagination des sessions
 * (`ISessionStorage.listPage` / `countSessions`). Backend-agnostique : ne dépend
 * que du contrat, se branche sur n'importe quel store via un harness (mémoire,
 * Drizzle × sqlite/postgres/mysql, Mongoose, Redis). Vit dans `@nodefony/http` —
 * le propriétaire du contrat — pour être importé par tous les adapters, jamais
 * dupliqué : un écart de comportement entre deux backends devient un test rouge,
 * par construction.
 *
 * **Deux capacités** selon le backend (déclarées par `harness.mode`) :
 * - `offset` (SQL/Mongo/mémoire) : `total` exact, ordre `updatedAt` DESC
 *   déterministe, pagination par décalage ;
 * - `cursor` (Redis `SCAN`) : pas de `total` ni d'ordre global, pages de taille
 *   variable (le client boucle sur `nextCursor`) — capacité réduite ASSUMÉE, et
 *   c'est justement ce que le banc vérifie : elle est *annoncée*, pas simulée.
 *
 * Ce que le banc prouve dans les DEUX modes — les invariants qui font qu'une
 * pagination est utilisable en production :
 * - **partition** : parcourir toutes les pages rend exactement l'ensemble, sans
 *   trou ni doublon (le bug classique d'une pagination maison) ;
 * - **borne** : une page ne rend jamais plus de `limit` éléments ;
 * - **redaction** : `Attributes`/`flashBag` ne sortent jamais du store ;
 * - **filtres** : `user` et `authenticated` sont honorés page par page.
 */

/** Une session du seed : identité + propriétaire (chaîne vide = anonyme). */
interface SeedEntry {
  id: string;
  user: string;
}

/**
 * Le seed déterministe partagé par tous les backends : 12 sessions —
 * **5 alice**, **4 bob**, **3 anonymes** (soit 9 authentifiées / 3 anonymes).
 * Les ids sont ordonnés (`sess-00`…`sess-11`) pour que le départage à horodatage
 * égal reste prévisible.
 */
export function sessionSeed(): SeedEntry[] {
  const out: SeedEntry[] = [];
  for (let i = 0; i < 12; i += 1) {
    const user = i < 5 ? "alice" : i < 9 ? "bob" : "";
    out.push({ id: `sess-${String(i).padStart(2, "0")}`, user });
  }
  return out;
}

/** Attend le changement de milliseconde — garantit des `updatedAt` DISTINCTS. */
async function nextMs(): Promise<void> {
  const start = Date.now();
  while (Date.now() === start) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Écrit le seed dans le store, **une session par milliseconde**.
 *
 * L'attente est délibérée : les stores horodatent eux-mêmes (`updatedAt = now`
 * au `write`), donc sans elle plusieurs sessions partageraient la milliseconde et
 * l'ordre attendu deviendrait ambigu — le banc testerait alors le hasard. 12 ms
 * au total, payées une fois par suite.
 *
 * @returns les ids dans l'ordre d'écriture (donc `updatedAt` croissant).
 */
export async function seedSessions(
  storage: ISessionStorage,
): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of sessionSeed()) {
    await storage.write(entry.id, {
      Attributes: { secret: `attr-${entry.id}` },
      flashBag: { notice: `flash-${entry.id}` },
      metaBag: { ip: "127.0.0.1", ua: "banc" },
      user: entry.user,
    });
    ids.push(entry.id);
    await nextMs();
  }
  return ids;
}

/**
 * Store vu par le banc : `listPage`/`countSessions` y sont **requis**. Les rendre
 * optionnels dans `ISessionStorage` sert les backends qui ne savent pas énumérer ;
 * un store qu'on branche sur ce banc, lui, prétend le savoir — le typage le dit.
 */
export type PaginatedSessionStorage = ISessionStorage &
  Required<Pick<ISessionStorage, "listPage" | "countSessions">>;

export interface SessionPaginationHarness {
  /** Le store sous test (résolu paresseusement — l'ORM peut n'être prêt qu'au `beforeAll`). */
  storage: () => PaginatedSessionStorage;
  /** Vide le store avant le seed (banc idempotent, rejouable). */
  clear: () => Promise<void>;
  /** Capacité de pagination du backend. */
  mode: "offset" | "cursor";
}

/**
 * Collecte TOUTES les pages, quel que soit le mode, et renvoie les records
 * dédupliqués par id.
 *
 * La déduplication n'est pas de la complaisance : `SCAN` garantit qu'un élément
 * présent du début à la fin est rendu **au moins** une fois — il peut l'être
 * plusieurs fois. C'est le contrat Redis, et le banc le respecte au lieu de le
 * contredire. En mode offset, la déduplication est un no-op… sauf si le store
 * duplique, ce que le test de partition détecte via le compteur brut.
 */
async function collectAll(
  storage: PaginatedSessionStorage,
  base: Partial<ISessionListQuery>,
  limit: number,
): Promise<{ records: ISessionRecord[]; rawCount: number; pages: number }> {
  const byId = new Map<string, ISessionRecord>();
  let rawCount = 0;
  let pages = 0;
  let cursor: string | undefined;
  let offset = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await storage.listPage({
      ...base,
      limit,
      ...(cursor !== undefined ? { cursor } : { offset }),
    });
    pages += 1;
    assert.ok(
      page.items.length <= limit,
      `une page ne doit jamais dépasser limit (${page.items.length} > ${limit})`,
    );
    for (const rec of page.items) {
      rawCount += 1;
      byId.set(rec.id, rec);
    }
    if (!page.hasNext) break;
    if (page.nextCursor) cursor = page.nextCursor;
    else offset += limit;
  }
  return { records: [...byId.values()], rawCount, pages };
}

/** Déroule la suite du contrat de pagination des sessions sur le store branché. */
export function runSessionPaginationContract(
  harness: SessionPaginationHarness,
): void {
  describe(`listPage / countSessions — contrat de pagination sessions (${harness.mode})`, () => {
    const storage = () => harness.storage();
    let orderedIds: string[] = [];

    beforeAll(async () => {
      await harness.clear();
      orderedIds = await seedSessions(storage());
    });

    // ── Invariants VALABLES DANS LES DEUX MODES ──────────────────────────────
    // C'est le socle : ce qu'un consommateur (Studio, CLI, agent) peut supposer
    // sans savoir quel backend est branché.

    it("partition : toutes les pages rendent l'ensemble, sans trou ni doublon", async () => {
      const { records, rawCount } = await collectAll(storage(), {}, 5);
      assert.equal(records.length, 12);
      assert.deepEqual(
        records.map((r) => r.id).sort(),
        [...orderedIds].sort(),
        "l'union des pages doit être exactement le seed",
      );
      if (harness.mode === "offset") {
        // En offset, un élément rendu deux fois est un BUG (pas une tolérance
        // du protocole comme avec SCAN) → le compteur brut doit coller.
        assert.equal(rawCount, 12, "aucun doublon attendu en mode offset");
      }
    });

    it("borne : une page ne matérialise jamais plus que `limit`", async () => {
      const page = await storage().listPage({ limit: 3 });
      assert.ok(page.items.length <= 3);
      assert.equal(page.limit, 3);
    });

    it("redaction : Attributes et flashBag ne sortent JAMAIS du store", async () => {
      const { records } = await collectAll(storage(), {}, 12);
      for (const rec of records) {
        assert.deepEqual(
          rec.data.Attributes,
          {},
          `Attributes doit rester en base (${rec.id})`,
        );
        assert.deepEqual(
          rec.data.flashBag,
          {},
          `flashBag doit rester en base (${rec.id})`,
        );
      }
    });

    it("filtre user : honoré sur chaque page", async () => {
      const { records } = await collectAll(storage(), { user: "alice" }, 2);
      assert.equal(records.length, 5);
      assert.ok(records.every((r) => r.data.user === "alice"));
    });

    it("filtre authenticated : partitionne le parc en authentifiées / anonymes", async () => {
      const auth = await collectAll(storage(), { authenticated: true }, 4);
      assert.equal(auth.records.length, 9);
      assert.ok(auth.records.every((r) => !!r.data.user));

      const anon = await collectAll(storage(), { authenticated: false }, 4);
      assert.equal(anon.records.length, 3);
      assert.ok(anon.records.every((r) => !r.data.user));
    });

    it("filtre sans résultat : page vide, pas d'erreur", async () => {
      const { records } = await collectAll(storage(), { user: "nobody" }, 5);
      assert.equal(records.length, 0);
    });

    it("rejette le mode de pagination que le store ne supporte pas (400)", async () => {
      const adverse =
        harness.mode === "offset"
          ? { limit: 4, cursor: "zzz" }
          : { limit: 4, offset: 8 };
      let thrown: unknown;
      try {
        await storage().listPage(adverse);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, "un mode de pagination non supporté doit être rejeté");
      assert.equal((thrown as { code?: unknown }).code, 400);
      assert.ok(thrown instanceof Error);
      assert.match((thrown as Error).message, /pagination mode/i);
    });

    // ── Mode OFFSET : total exact + ordre déterministe ────────────────────────
    if (harness.mode === "offset") {
      it("page + total + hasNext (tri updatedAt DESC)", async () => {
        const first = await storage().listPage({ limit: 5, offset: 0 });
        assert.equal(first.total, 12);
        assert.equal(first.items.length, 5);
        assert.equal(first.hasNext, true);
        // Le seed est écrit du plus ancien au plus récent → DESC inverse l'ordre.
        const expected = [...orderedIds].reverse().slice(0, 5);
        assert.deepEqual(
          first.items.map((r) => r.id),
          expected,
        );

        const last = await storage().listPage({ limit: 5, offset: 10 });
        assert.equal(last.items.length, 2);
        assert.equal(last.hasNext, false);
      });

      it("offset au-delà de la fin → page vide, hasNext false", async () => {
        const page = await storage().listPage({ limit: 5, offset: 999 });
        assert.equal(page.items.length, 0);
        assert.equal(page.hasNext, false);
        assert.equal(page.total, 12);
      });

      it("withTotal:false → total omis, hasNext reste fiable", async () => {
        const page = await storage().listPage({ limit: 5, withTotal: false });
        assert.equal(page.total, undefined);
        assert.equal(page.items.length, 5);
        assert.equal(page.hasNext, true);
      });

      it("total : reflète le FILTRE, pas la collection entière", async () => {
        assert.equal(
          (await storage().listPage({ limit: 2, user: "bob" })).total,
          4,
        );
        assert.equal(
          (await storage().listPage({ limit: 2, authenticated: false })).total,
          3,
        );
      });

      it("countSessions = COUNT natif filtré (sans énumérer)", async () => {
        assert.equal(await storage().countSessions(), 12);
        assert.equal(await storage().countSessions({ limit: 1 }), 12);
        assert.equal(
          await storage().countSessions({ limit: 1, user: "alice" }),
          5,
        );
        assert.equal(
          await storage().countSessions({ limit: 1, authenticated: true }),
          9,
        );
        assert.equal(
          await storage().countSessions({ limit: 1, authenticated: false }),
          3,
        );
      });
    } else {
      // ── Mode CURSEUR : capacité réduite ANNONCÉE ────────────────────────────
      it("curseur : nextCursor est posé tant qu'il reste à scanner, null à la fin", async () => {
        let cursor: string | undefined;
        let sawCursor = false;
        for (let guard = 0; guard < 200; guard += 1) {
          const page = await storage().listPage({ limit: 5, cursor });
          if (page.nextCursor) {
            sawCursor = true;
            assert.equal(page.hasNext, true);
            cursor = page.nextCursor;
            continue;
          }
          assert.equal(page.nextCursor, null, "fin de scan → nextCursor null");
          assert.equal(page.hasNext, false);
          break;
        }
        assert.ok(sawCursor, "le seed doit demander plus d'un passage SCAN");
      });

      it("curseur : pas de total (ne pas inventer ce que le backend ignore)", async () => {
        const page = await storage().listPage({ limit: 5 });
        assert.equal(page.total, undefined);
      });

      it("countSessions = -1 (capacité réduite Redis assumée)", async () => {
        assert.equal(await storage().countSessions(), -1);
        assert.equal(await storage().countSessions({ limit: 1 }), -1);
      });
    }

    // ── Cohérence avec les mutations ─────────────────────────────────────────
    // Placé EN DERNIER : ces tests mutent le seed, donc ils ne doivent pas
    // s'exécuter avant ceux qui comptent sur ses 12 sessions.

    it("destroy retire la session des pages suivantes", async () => {
      const victim = orderedIds[0];
      assert.equal(await storage().destroy(victim), true);
      const { records } = await collectAll(storage(), {}, 5);
      assert.equal(records.length, 11);
      assert.ok(!records.some((r) => r.id === victim));
      if (harness.mode === "offset") {
        assert.equal(await storage().countSessions(), 11);
      }
    });
  });
}
