import assert from "node:assert/strict";
import type { IWebhookEndpoint, IWebhookStore } from "../../index";

/**
 * **Banc de contrat UNIQUE** du standard de pagination des endpoints webhook
 * (`IWebhookStore.listPage` / `countEndpoints`). Backend-agnostique : ne dépend
 * que du contrat, se branche sur n'importe quel store via un harness (mémoire,
 * Drizzle × sqlite/postgres/mysql, Mongoose). Vit dans `@nodefony/security` — le
 * propriétaire du contrat — pour être importé par tous les adapters (jamais
 * dupliqué).
 *
 * Contrairement aux sessions/jetons, **tous** les backends d'endpoints savent
 * paginer par offset (Redis n'est PAS un store d'endpoints : configuration
 * durable ≠ éphémère) → un seul mode, pas de capacité déclarée.
 *
 * Seed déterministe : 12 endpoints `wh-00`…`wh-11`, `createdAt` distincts
 * croissants, `enabled` faux sur les ×3 (4 désactivés / 8 actifs), abonnements
 * `user.created` sur les pairs (6) et `order.paid` sur les ×4 (3), tous abonnés
 * à `ping`. `description` porte `alpha` sur les ×5 (3).
 */

/** Fabrique un endpoint complet (défauts sûrs) — seul l'`id` est requis. */
export function makeWebhookEndpoint(
  over: Partial<IWebhookEndpoint> & { id: string },
): IWebhookEndpoint {
  return {
    id: over.id,
    url: over.url ?? `https://hooks.example.test/${over.id}`,
    secretEnc: over.secretEnc ?? `enc-${over.id}`,
    events: over.events ?? ["ping"],
    enabled: over.enabled ?? true,
    description: over.description ?? null,
    tenantId: over.tenantId ?? null,
    createdBy: over.createdBy ?? null,
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
    lastDeliveryAt: over.lastDeliveryAt ?? null,
    lastDeliveryStatus: over.lastDeliveryStatus ?? null,
    lastDeliveryError: over.lastDeliveryError ?? null,
    failureCount: over.failureCount ?? 0,
    metadata: over.metadata ?? {},
  };
}

/** Le seed déterministe partagé par tous les backends. */
export function webhookSeed(): IWebhookEndpoint[] {
  const out: IWebhookEndpoint[] = [];
  for (let i = 0; i < 12; i += 1) {
    const events = ["ping"];
    if (i % 2 === 0) events.push("user.created");
    if (i % 4 === 0) events.push("order.paid");
    out.push(
      makeWebhookEndpoint({
        id: `wh-${String(i).padStart(2, "0")}`,
        url: `https://hooks.example.test/sink-${i}`,
        events,
        enabled: i % 3 !== 0,
        description: i % 5 === 0 ? `alpha-${i}` : `beta-${i}`,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
        // Valeurs RÉPÉTÉES volontairement (0..3) : c'est l'axe d'exploitation
        // « qui échoue le plus », et un champ à ex æquo éprouve le tri là où des
        // valeurs toutes distinctes le rendraient trivial.
        failureCount: i % 4,
      }),
    );
  }
  return out;
}

export interface WebhookPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IWebhookStore;
  /** Vide le store avant le seed (banc idempotent). */
  clear: () => Promise<void>;
}

/** Déroule la suite du contrat de pagination des endpoints sur le store branché. */
export function runWebhookPaginationContract(
  harness: WebhookPaginationHarness,
): void {
  describe("listPage / countEndpoints — contrat de pagination webhooks", () => {
    beforeAll(async () => {
      await harness.clear();
      for (const endpoint of webhookSeed())
        await harness.store().save(endpoint);
    });
    const store = () => harness.store();

    it("rejette le mode de pagination que le store ne supporte pas (400)", async () => {
      // Store OFFSET : un `cursor` de navigation n'a pas de sens ici.
      const adverse = { limit: 4, cursor: "zzz" };
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

    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 5 });
      assert.ok(
        page.items.length <= 5,
        `page de ${page.items.length} éléments pour limit=5`,
      );
      assert.equal(page.limit, 5);
    });

    it("page + total + hasNext (tri createdAt DESC)", async () => {
      const first = await store().listPage({ limit: 5, offset: 0 });
      assert.equal(first.total, 12);
      assert.equal(first.items.length, 5);
      assert.equal(first.hasNext, true);
      assert.equal(first.items[0].id, "wh-11"); // createdAt le plus récent
      assert.equal(first.items[4].id, "wh-07");

      const last = await store().listPage({ limit: 5, offset: 10 });
      assert.equal(last.items.length, 2);
      assert.equal(last.hasNext, false);
      assert.equal(last.items[1].id, "wh-00");
    });

    it("parcours complet par pages : 12 endpoints DISTINCTS, aucun perdu", async () => {
      const seen = new Set<string>();
      for (let offset = 0; offset < 12; offset += 5) {
        const page = await store().listPage({ limit: 5, offset });
        for (const e of page.items) seen.add(e.id);
      }
      assert.equal(seen.size, 12);
    });

    it("filtre enabled", async () => {
      assert.equal(
        (await store().listPage({ limit: 100, enabled: true })).total,
        8,
      );
      const off = await store().listPage({ limit: 100, enabled: false });
      assert.equal(off.total, 4);
      assert.ok(off.items.every((e) => e.enabled === false));
    });

    it("filtre event : appartenance au tableau `events`", async () => {
      const created = await store().listPage({
        limit: 100,
        event: "user.created",
      });
      assert.equal(created.total, 6);
      assert.ok(created.items.every((e) => e.events.includes("user.created")));

      assert.equal(
        (await store().listPage({ limit: 100, event: "order.paid" })).total,
        3,
      );
      assert.equal(
        (await store().listPage({ limit: 100, event: "ping" })).total,
        12,
      );
      // Un événement auquel personne n'est abonné ne doit pas « matcher par préfixe ».
      assert.equal(
        (await store().listPage({ limit: 100, event: "user.create" })).total,
        0,
      );
    });

    it("filtres combinés event + enabled", async () => {
      const page = await store().listPage({
        limit: 100,
        event: "order.paid",
        enabled: true,
      });
      // order.paid = ids ×4 (0,4,8) ; enabled=false sur les ×3 → wh-00 sort.
      assert.equal(page.total, 2);
      assert.ok(
        page.items.every((e) => e.enabled && e.events.includes("order.paid")),
      );
    });

    it("recherche q : sous-chaîne insensible à la casse (url OU description)", async () => {
      assert.equal(
        (await store().listPage({ limit: 100, q: "SINK-3" })).total,
        1,
      );
      const alpha = await store().listPage({ limit: 100, q: "alpha" });
      assert.equal(alpha.total, 3); // description des ×5 : 0, 5, 10
      assert.equal(
        (await store().listPage({ limit: 100, q: "absent" })).total,
        0,
      );
    });

    it("withTotal:false → total omis, hasNext fiable", async () => {
      const page = await store().listPage({ limit: 5, withTotal: false });
      assert.equal(page.total, undefined);
      assert.equal(page.items.length, 5);
      assert.equal(page.hasNext, true);
    });

    it("countEndpoints = COUNT natif filtré", async () => {
      assert.equal(await store().countEndpoints({ limit: 1 }), 12);
      assert.equal(
        await store().countEndpoints({ limit: 1, enabled: true }),
        8,
      );
      assert.equal(
        await store().countEndpoints({ limit: 1, event: "order.paid" }),
        3,
      );
    });

    // ── TRI : ce qu'un store DÉCLARE savoir trier, il le trie VRAIMENT ───────
    // Le vocabulaire est public et identique partout : `?order=` doit produire
    // le même ordre sur mémoire, SQLite, PostgreSQL, MySQL et Mongo. Un store
    // mémoire qui trierait en dur passerait tous les tests ci-dessus tout en
    // mentant sur la production.
    it("le store DÉCLARE son vocabulaire de tri public", async () => {
      const fields = store().sortableFields;
      assert.ok(
        fields && fields.length > 0,
        "un backend d'endpoints doit déclarer ses champs triables",
      );
      assert.ok(
        fields!.includes("createdAt"),
        "`createdAt` est l'axe par défaut du contrat",
      );
    });

    it("`order` inverse réellement le sens (createdAt ASC)", async () => {
      const page = await store().listPage({
        limit: 12,
        order: [["createdAt", "ASC"]],
      });
      assert.deepEqual(
        page.items.map((e) => e.id),
        webhookSeed().map((e) => e.id),
        "ASC doit rendre l'ordre d'écriture du seed",
      );
    });

    it("chaque champ DÉCLARÉ est effectivement honoré", async () => {
      // La garde qui empêche d'annoncer une capacité qu'on n'a pas : le data
      // plane refuse en 400 tout champ hors de cette liste, donc tout ce qui y
      // figure DOIT trier — sans quoi la console offrirait un en-tête inerte.
      //
      // L'invariant vérifié est « DESC rend l'exact renversé de ASC », sur les
      // VALEURS et non sur les identifiants. Il tient quels que soient les ex
      // æquo (`enabled`, `failureCount`) ET quelle que soit la collation du
      // moteur — comparer à un `Array.sort()` JS aurait fait dépendre le test
      // du classement des tirets, qui n'est pas le même en JS et en SQL.
      const declared = store().sortableFields ?? [];
      // Sans cette borne, un store qui ne déclare RIEN ferait passer ce test sur
      // une boucle vide — un test qui ne lit rien ne garantit rien.
      assert.ok(
        declared.length > 0,
        "un backend d'endpoints doit déclarer au moins un champ triable",
      );
      for (const field of declared) {
        const read = (e: IWebhookEndpoint): string =>
          String(e[field as keyof IWebhookEndpoint]);
        const asc = (
          await store().listPage({ limit: 12, order: [[field, "ASC"]] })
        ).items.map(read);
        const desc = (
          await store().listPage({ limit: 12, order: [[field, "DESC"]] })
        ).items.map(read);
        assert.equal(asc.length, 12, `"${field}" ASC doit rendre tout le seed`);
        assert.deepEqual(
          desc,
          [...asc].reverse(),
          `"${field}" DESC doit rendre l'exact renversé de ASC`,
        );
      }
    });

    it("le tri s'applique AVANT la pagination (pas page par page)", async () => {
      // Le piège classique : trier la tranche déjà découpée. La 2ᵉ page d'un tri
      // ASC doit continuer la 1ʳᵉ, pas recommencer.
      const p1 = await store().listPage({
        limit: 4,
        offset: 0,
        order: [["createdAt", "ASC"]],
      });
      const p2 = await store().listPage({
        limit: 4,
        offset: 4,
        order: [["createdAt", "ASC"]],
      });
      assert.deepEqual(
        [...p1.items, ...p2.items].map((e) => e.createdAt),
        webhookSeed()
          .slice(0, 8)
          .map((e) => e.createdAt),
        "les pages se suivent dans l'ordre",
      );
    });

    it("un champ HORS vocabulaire ne trie pas en douce (garde du SQL concaténé)", async () => {
      // Le data plane refuse déjà l'inconnu en 400. Ici on vérifie l'étage du
      // dessous : un appelant interne qui passerait un champ non déclaré ne doit
      // ni trier dessus, ni faire exécuter le nom — côté SQL, l'identifiant est
      // CONCATÉNÉ dans le `ORDER BY`, aucun paramètre ne le lie. Le store doit
      // donc retomber sur son ordre par défaut, sans lever ni corrompre.
      const page = await store().listPage({
        limit: 12,
        order: [["secretEnc", "ASC"]],
      });
      assert.equal(page.items.length, 12);
      assert.equal(
        page.items[0].id,
        "wh-11",
        "ordre par défaut (createdAt DESC) conservé",
      );
    });

    it("la page porte les champs complets (secretEnc inclus : c'est le store, pas la vue)", async () => {
      const page = await store().listPage({ limit: 1 });
      const first = page.items[0];
      assert.equal(first.secretEnc, "enc-wh-11");
      assert.deepEqual([...first.events], ["ping"]); // wh-11 : ni pair, ni ×4

      assert.equal(typeof first.createdAt, "number");
    });
  });
}
