import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type {
  IAuditEvent,
  IAuditEventDraft,
} from "../../nodefony/contracts/IAuditEvent";
import type { IAuditStore } from "../../nodefony/contracts/IAuditStore";

/**
 * **Banc de contrat UNIQUE** du journal d'audit sous RÉGIME RÉEL — la rafale,
 * pas le CRUD isolé. Backend-agnostique : se branche sur n'importe quel store
 * durable via un harness.
 *
 * Ce qu'il éprouve et qu'aucun autre banc ne peut : l'`AuditService` pose des
 * identifiants **séquentiels** (`<préfixe>-<seq en base 36>`) et un `Date.now()`
 * — donc sous rafale, des dizaines d'événements partagent la même milliseconde
 * et leurs identifiants ne sont **pas** ordonnés comme leur horodatage (`z` >
 * `aa` en comparaison de chaînes). C'est exactement la configuration où un ordre
 * total mal choisi perd ou répète des événements d'une page à l'autre — en
 * silence, puisque chaque page reste bien formée.
 *
 * Le banc de pagination du contrat sème 12 événements dont 3 en collision :
 * assez pour le principe, pas pour une rafale de connexions.
 *
 * ⚠️ **Deux tests TÉMOINS ouvrent la suite.** Sans eux, un décor qui espace les
 * écritures (un `await` par événement, une horloge figée) rendrait tous les cas
 * suivants verts pour la pire des raisons : il n'y aurait rien à départager.
 * C'est arrivé en écrivant ce banc — le témoin l'a dit.
 */
export interface AuditBurstHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IAuditStore;
  /** Vide le journal (base réelle qui survit au run précédent). */
  clear: () => Promise<void>;
  /**
   * Supprime PHYSIQUEMENT ces événements, sous le store — pour simuler une
   * purge de rétention survenue **pendant** une pagination.
   */
  removeEvents: (ids: string[]) => Promise<void>;
  /** Taille de la rafale (défaut 400). */
  burst?: number;
}

/** Reproduit la fabrication d'identifiants de l'`AuditService` (séquentielle). */
function makeEmitter(): (draft: IAuditEventDraft) => IAuditEvent {
  const prefix = randomBytes(4).toString("hex");
  let seq = 0;
  return (draft) => ({
    ...draft,
    id: `${prefix}-${(seq++).toString(36)}`,
    ts: Date.now(),
  });
}

/** Déroule la suite de rafale du journal sur le backend branché. */
export function runAuditBurstContract(harness: AuditBurstHarness): void {
  const BURST = harness.burst ?? 400;
  const store = () => harness.store();
  /** Événements écrits, dans l'ordre d'émission. */
  let written: IAuditEvent[] = [];

  describe(`journal d'audit sous RAFALE réelle (${BURST} événements)`, () => {
    beforeAll(async () => {
      await harness.clear();
      const emit = makeEmitter();
      // ÉMISSION d'abord, en boucle SYNCHRONE — c'est ainsi que l'`AuditService`
      // travaille : `record()` est fire-and-forget, il pose `id` et `ts` sans
      // attendre l'écriture. Des dizaines d'événements tombent donc dans la même
      // milliseconde d'horloge RÉELLE.
      //
      // ⚠️ Écrire avec un `await` par événement les espacerait d'un aller-retour
      // chacun — plus AUCUNE collision, et ce banc ne prouverait rien. Les deux
      // témoins ci-dessous existent pour que cette erreur ne puisse pas passer.
      written = [];
      for (let i = 0; i < BURST; i += 1) {
        written.push(
          emit({
            category: i % 3 === 0 ? "authz" : "auth",
            action: i % 3 === 0 ? "access.denied" : "login.success",
            outcome:
              i % 4 === 0 ? "denied" : i % 2 === 0 ? "failure" : "success",
            actor: i % 2 === 0 ? "alice" : "bob",
            requestId: `req-${i % 7}`,
          }),
        );
      }
      // Écriture ensuite, par lots concurrents (le store est appelé en
      // fire-and-forget par le service, jamais sérialisé).
      for (let i = 0; i < written.length; i += 40) {
        await Promise.all(
          written.slice(i, i + 40).map((event) => store().append(event)),
        );
      }
    });

    it("TÉMOIN — la rafale a bien produit des collisions de milliseconde", () => {
      const parTs = new Map<number, number>();
      for (const e of written) parTs.set(e.ts, (parTs.get(e.ts) ?? 0) + 1);
      const maxParMs = Math.max(...parTs.values());
      assert.ok(
        maxParMs > 1,
        `aucune collision de milliseconde sur ${BURST} événements — ` +
          `le banc ne teste pas ce qu'il prétend tester`,
      );
    });

    it("TÉMOIN — les identifiants ne sont PAS ordonnés comme les horodatages", () => {
      // `-z` précède `-aa` en séquence mais le suit en comparaison de chaînes.
      // Si ce n'était pas le cas, trier par identifiant suffirait et l'ordre
      // composite n'aurait rien à prouver.
      const collisions = written.filter(
        (e, i) => i > 0 && e.ts === written[i - 1].ts,
      );
      const desordre = collisions.some(
        (e, i) => i > 0 && e.id < collisions[i - 1].id,
      );
      assert.ok(
        desordre || collisions.length === 0,
        "les identifiants séquentiels devraient se croiser en ordre lexicographique",
      );
    });

    it(`parcours complet par curseur : ${BURST} événements, aucun perdu ni répété`, async () => {
      const vus: IAuditEvent[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await store().listPage({ limit: 37, cursor });
        assert.ok(page.items.length <= 37);
        vus.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        assert.ok(pages < 100, "pagination non convergente");
      } while (cursor);

      const ids = vus.map((e) => e.id);
      assert.equal(
        new Set(ids).size,
        ids.length,
        "un événement a été rendu DEUX fois — l'ordre total ne départage pas",
      );
      assert.equal(
        ids.length,
        BURST,
        `${ids.length} événements relus pour ${BURST} écrits — perte silencieuse`,
      );
      assert.deepEqual(
        new Set(ids),
        new Set(written.map((e) => e.id)),
        "l'ensemble relu diffère de l'ensemble écrit",
      );
    });

    it("l'ordre rendu est DÉCROISSANT et total (ts, puis id)", async () => {
      const vus: IAuditEvent[] = [];
      let cursor: string | undefined;
      do {
        const page = await store().listPage({ limit: 50, cursor });
        vus.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      for (let i = 1; i < vus.length; i += 1) {
        const prev = vus[i - 1];
        const cur = vus[i];
        const ordonne =
          prev.ts > cur.ts || (prev.ts === cur.ts && prev.id > cur.id);
        assert.ok(
          ordonne,
          `ordre rompu entre ${prev.id}@${prev.ts} et ${cur.id}@${cur.ts}`,
        );
      }
    });

    it("un filtre traverse la pagination sans perdre d'événement", async () => {
      // Le curseur se COMPOSE avec le filtre : la clause d'avancement s'y
      // ajoute, elle ne s'y substitue pas.
      const attendus = written.filter((e) => e.requestId === "req-3");
      const vus: IAuditEvent[] = [];
      let cursor: string | undefined;
      do {
        const page = await store().listPage({
          limit: 5,
          requestId: "req-3",
          cursor,
        });
        for (const e of page.items) {
          assert.equal(e.requestId, "req-3", "le filtre a fui");
        }
        vus.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(vus.length, attendus.length);
      assert.deepEqual(
        new Set(vus.map((e) => e.id)),
        new Set(attendus.map((e) => e.id)),
      );
    });

    it("le curseur reste JUSTE quand la page précédente est purgée", async () => {
      // LE cas que le curseur auto-portant existe pour couvrir : un curseur qui
      // porterait un identifiant à re-résoudre rembobinerait à la page la plus
      // récente si l'événement a disparu entre deux pages — la console
      // boucherait indéfiniment sans jamais signaler d'erreur.
      const first = await store().listPage({ limit: 20 });
      const cursor = first.nextCursor;
      assert.ok(cursor, "le journal doit avoir plus d'une page");

      const ids = first.items.map((e) => e.id);
      await harness.removeEvents(ids);

      const second = await store().listPage({ limit: 20, cursor: cursor! });
      for (const e of second.items) {
        assert.ok(
          !ids.includes(e.id),
          `l'événement ${e.id} revient — le curseur a rembobiné`,
        );
      }
      // Et la lecture n'est pas repartie du début : le plus récent restant est
      // strictement plus ancien que la position du curseur.
      const [ts] = cursor!.split(":");
      assert.ok(second.items.length > 0);
      assert.ok(second.items[0].ts <= Number(ts));
    });
  });
}
