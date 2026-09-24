import assert from "node:assert/strict";
import type { IWebhookEndpoint, IWebhookStore } from "../../index";
import { runWebhookPaginationContract } from "./webhookPaginationContract";

/**
 * **Banc de contrat UNIQUE** du store d'endpoints webhook (`IWebhookStore`),
 * au-delà du seul listing. Backend-agnostique : se branche sur n'importe quel
 * store via un harness (mémoire, Drizzle × sqlite/postgres/mysql, Mongoose ×
 * MongoDB). Vit chez le propriétaire du contrat — deux copies divergeraient en
 * silence, chacune passant ses propres tests.
 *
 * Enjeu : `listAll` est le **snapshot du dispatcher** (il décide où partent les
 * événements, avec quel secret de signature). Deux propriétés doivent tenir sur
 * tout backend — le `secretEnc` doit ressortir intact (sans lui, aucune
 * signature HMAC) et `enabled: false` doit rester FAUX (un booléen qui revient
 * en `0` truthy réactiverait un endpoint désactivé, donc une fuite d'événements
 * vers une cible retirée).
 *
 * Le banc de **listing** (`runWebhookPaginationContract`) est déroulé en
 * dernier : son seed doit survivre aux purges des cas ci-dessus.
 */
export interface WebhookStoreContractHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IWebhookStore;
  /** Vide le store (banc idempotent, et base réelle qui survit au run précédent). */
  clear: () => Promise<void>;
  /**
   * **Capacité optionnelle** : réchauffe le pool de connexions. Un pool froid
   * sérialise les premières requêtes et masque les courses que le cas d'écriture
   * concurrente existe pour débusquer.
   */
  warm?: () => Promise<void>;
}

/** Fabrique un endpoint complet — surcharges par-dessus des défauts sûrs. */
function makeEndpoint(
  over: Partial<IWebhookEndpoint> & Pick<IWebhookEndpoint, "id">,
): IWebhookEndpoint {
  return {
    url: `https://hook.example.com/${over.id}`,
    secretEnc: `gcm1.${over.id}`,
    events: ["login.success", "user.created"],
    enabled: true,
    description: null,
    tenantId: null,
    createdBy: "admin1",
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    failureCount: 0,
    metadata: {},
    ...over,
  };
}

/** Messages des promesses rejetées (lisibles dans l'assertion d'échec). */
function rejections(rs: PromiseSettledResult<unknown>[]): string[] {
  return rs
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason?.message);
}

/** Déroule la suite du contrat de store webhook sur le backend branché. */
export function runWebhookStoreContract(
  harness: WebhookStoreContractHarness,
): void {
  const store = () => harness.store();
  const purge = () => harness.clear();

  describe("save / findById", () => {
    it("save + findById : round-trip complet (events + metadata JSON, booléen, nulls)", async () => {
      await purge();
      const endpoint = makeEndpoint({
        id: "wh1",
        description: "prod — é👩‍💻",
        metadata: { team: "core", n: 3 },
      });
      await store().save(endpoint);
      const e = await store().findById("wh1");
      assert.ok(e);
      // Égalité STRUCTURELLE : un champ ajouté, perdu ou retypé par un
      // backend (colonne en trop, `_id` qui fuit) fait tomber ce cas.
      assert.deepEqual(e, endpoint);
      assert.equal(typeof e.enabled, "boolean", "booléen, pas 0/1");
      assert.equal(
        e.secretEnc,
        "gcm1.wh1",
        "le secret de signature ressort intact",
      );
    });

    it("findById d'un endpoint inconnu renvoie null", async () => {
      assert.equal(await store().findById("nope"), null);
    });

    it("save écrase un endpoint existant (upsert), 1 seule ligne", async () => {
      await store().save(makeEndpoint({ id: "wh_up", failureCount: 1 }));
      await store().save(makeEndpoint({ id: "wh_up", failureCount: 9 }));
      assert.equal((await store().findById("wh_up"))?.failureCount, 9);
      assert.equal(
        (await store().listAll()).filter((e) => e.id === "wh_up").length,
        1,
      );
    });

    it("save CONCURRENT × 10 du même id : 0 rejet, une seule ligne", async () => {
      // Rejeu d'un formulaire d'admin : un « lire puis créer » laisse deux
      // écrivains voir « absent » → violation de clé primaire pour le perdant.
      await harness.warm?.();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store().save(makeEndpoint({ id: "wh_conc", failureCount: i })),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(
        (await store().listAll()).filter((e) => e.id === "wh_conc").length,
        1,
      );
    });

    it("ne partage pas les références JSON avec l'appelant (copie défensive)", async () => {
      const events = ["a"];
      const metadata: Record<string, unknown> = { k: 1 };
      await store().save(makeEndpoint({ id: "wh_ref", events, metadata }));
      events.push("MUTATED");
      metadata.k = 999;
      const e = await store().findById("wh_ref");
      assert.deepEqual(e?.events, ["a"]);
      assert.deepEqual(e?.metadata, { k: 1 });
    });

    it("ne partage pas les références JSON en LECTURE (muter le rendu ne touche pas le stock)", async () => {
      await store().save(makeEndpoint({ id: "wh_read", events: ["a"] }));
      const first = await store().findById("wh_read");
      assert.ok(first);
      // `readonly` ne protège qu'à la compilation : un appelant JS (ou un cast)
      // mute quand même à l'exécution — c'est ce que la copie doit absorber.
      const mutable = first as unknown as {
        events: string[];
        enabled: boolean;
      };
      mutable.events.push("MUTATED");
      mutable.enabled = false;
      const again = await store().findById("wh_read");
      assert.deepEqual(again?.events, ["a"]);
      assert.equal(again?.enabled, true);
    });

    it("events VIDE : tableau vide préservé (endpoint qui n'écoute rien)", async () => {
      await store().save(makeEndpoint({ id: "wh_none", events: [] }));
      assert.deepEqual((await store().findById("wh_none"))?.events, []);
    });

    it("enabled: false SURVIT (un endpoint désactivé ne se réveille pas)", async () => {
      // Le piège du booléen : `0` truthy, ou un `false` ignoré comme falsy à
      // l'écriture, ferait repartir des événements vers une cible RETIRÉE.
      await store().save(makeEndpoint({ id: "wh_off", enabled: false }));
      const e = await store().findById("wh_off");
      assert.equal(e?.enabled, false);
      assert.equal(typeof e?.enabled, "boolean");
    });

    it("URL longue + secret opaque : pas de troncature", async () => {
      const url = `https://exemple.test/${"s".repeat(300)}?a=1&b=%C3%A9`;
      await store().save(
        makeEndpoint({ id: "wh_long", url, secretEnc: "gcm1.aXY=.dGFn+/=" }),
      );
      const e = await store().findById("wh_long");
      assert.equal(e?.url, url, "URL de 300+ caractères intacte");
      assert.equal(e?.secretEnc, "gcm1.aXY=.dGFn+/=");
    });
  });

  describe("update", () => {
    it("applique un patch partiel (enabled/url/events/failureCount/lastDelivery*/updatedAt)", async () => {
      await purge();
      await store().save(makeEndpoint({ id: "up1" }));
      await store().update("up1", {
        enabled: false,
        url: "https://new.example.com/hook",
        events: ["user.deleted"],
        failureCount: 3,
        lastDeliveryAt: 2_000_000,
        lastDeliveryStatus: 500,
        lastDeliveryError: "timeout",
        updatedAt: 2_000_000,
      });
      const e = await store().findById("up1");
      assert.equal(e?.enabled, false);
      assert.equal(e?.url, "https://new.example.com/hook");
      assert.deepEqual(e?.events, ["user.deleted"]);
      assert.equal(e?.failureCount, 3);
      assert.equal(e?.lastDeliveryAt, 2_000_000);
      assert.equal(e?.lastDeliveryStatus, 500);
      assert.equal(e?.lastDeliveryError, "timeout");
      assert.equal(e?.updatedAt, 2_000_000);
      assert.equal(e?.secretEnc, "gcm1.up1", "le secret n'est PAS touché");
      assert.equal(e?.createdBy, "admin1");
      assert.equal(e?.createdAt, 1_000_000, "createdAt n'est PAS touché");
    });

    it("met à jour metadata (copie défensive)", async () => {
      const metadata: Record<string, unknown> = { a: 1 };
      await store().update("up1", { metadata });
      metadata.a = 999;
      assert.deepEqual((await store().findById("up1"))?.metadata, { a: 1 });
    });

    it("no-op si l'id est inconnu (ne lève pas, ne crée rien)", async () => {
      await store().update("jamais-vu", { enabled: false });
      assert.equal(await store().findById("jamais-vu"), null);
    });

    it("épuration d'un échec : lastDeliveryError remis à null", async () => {
      // Après une livraison réussie, l'erreur précédente doit DISPARAÎTRE —
      // sinon l'admin voit une alerte périmée.
      await store().update("up1", {
        lastDeliveryStatus: 200,
        lastDeliveryError: null,
        failureCount: 0,
      });
      const e = await store().findById("up1");
      assert.equal(e?.lastDeliveryError, null);
      assert.equal(e?.failureCount, 0);
    });
  });

  describe("delete", () => {
    it("supprime l'endpoint", async () => {
      await purge();
      await store().save(makeEndpoint({ id: "d1" }));
      await store().delete("d1");
      assert.equal(await store().findById("d1"), null);
    });

    it("est idempotent sur un endpoint inconnu", async () => {
      await store().delete("jamais-vu");
      await store().delete("d1");
    });

    it("ne supprime QUE l'endpoint visé", async () => {
      await purge();
      await store().save(makeEndpoint({ id: "keep" }));
      await store().save(makeEndpoint({ id: "drop" }));
      await store().delete("drop");
      assert.deepEqual(
        (await store().listAll()).map((e) => e.id),
        ["keep"],
      );
    });
  });

  describe("listAll (snapshot du dispatcher)", () => {
    it("renvoie les endpoints persistés AVEC secretEnc (sans lui, pas de signature)", async () => {
      await purge();
      await store().save(makeEndpoint({ id: "l1" }));
      await store().save(makeEndpoint({ id: "l2", enabled: false }));
      const all = await store().listAll();
      assert.deepEqual(all.map((e) => e.id).sort(), ["l1", "l2"]);
      assert.ok(
        all.every((e) => e.secretEnc.startsWith("gcm1.")),
        "le secret de signature est dans le snapshot",
      );
      // Le dispatcher voit AUSSI les désactivés : c'est LUI qui filtre (le store
      // ne décide pas). Garder les deux visibles est le contrat.
      assert.equal(all.filter((e) => !e.enabled).length, 1);
    });

    it("renvoie [] quand aucun endpoint n'est enregistré", async () => {
      await purge();
      assert.deepEqual(await store().listAll(), []);
    });
  });

  // Standard de pagination : déclaré en DERNIER, son seed doit survivre aux
  // `purge()` des cas ci-dessus.
  runWebhookPaginationContract({ store, clear: purge });
}
