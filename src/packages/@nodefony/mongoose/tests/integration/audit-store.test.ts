import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseAuditStore } from "../../nodefony/src/MongooseAuditStore";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "../../nodefony/entity/auditEventEntity";
import {
  runAuditPaginationContract,
  makeAuditEvent,
} from "../../../security/tests/support/auditPaginationContract";

const ORM = "audit_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `audit_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)(
  "Mongoose MongooseAuditStore — IAuditStore portable",
  () => {
    let orm: MongooseOrm;
    let store: MongooseAuditStore;
    // Horloge contrôlée : le `gc` compare à une fenêtre de rétention, donc
    // l'horloge fait partie du contrat testé.
    let clock = 30_000_000;
    const RETENTION_MS = 3_600_000;

    beforeAll(async () => {
      registerAuditEntities(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
      store = MongooseAuditStore.from(orm, () => clock, RETENTION_MS);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, ORM);
      ormRegistry.unregister(ORM);
    });

    // ── Le banc de contrat PARTAGÉ (mémoire, Drizzle ×3 dialectes, et ici) ────
    // C'est lui qui dit « parité » : mêmes assertions, même seed, autre backend.
    runAuditPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
      },
    });

    // ── Ce que le banc partagé ne couvre pas : l'écriture et la rétention ─────
    describe("append — fidélité du document au repos", () => {
      beforeAll(async () => {
        await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
      });

      it("restitue un événement COMPLET (contexte, drapeaux, métadonnées)", async () => {
        const event = makeAuditEvent({
          id: "evt-complet",
          ts: 1_500_000,
          category: "authz",
          action: "access.denied",
          outcome: "denied",
          actor: "alice",
          resource: "/nodefony/kernel",
          reason: "veto",
          ip: "203.0.113.4",
          userAgent: "curl/8.0",
          requestId: "req-42",
          flags: { hasAuthorization: true, hasCookie: false },
          metadata: { zone: "admin", attempts: 3 },
        });
        await store.append(event);
        const page = await store.listPage({ limit: 10, requestId: "req-42" });
        assert.equal(page.items.length, 1);
        // Égalité STRUCTURELLE : c'est ce qui prouve la parité de mapping — un
        // champ perdu, un `null` devenu `undefined`, et le backend diverge de
        // son frère SQL sans qu'aucune assertion ciblée ne le voie.
        assert.deepEqual(page.items[0], event);
      });

      it("laisse ABSENTS les champs optionnels non fournis (pas `null`)", async () => {
        // `IAuditEvent` déclare `flags`/`metadata` optionnels : les rendre à
        // `null` ferait échouer une comparaison d'événements chez l'appelant,
        // et le document Mongo, lui, les porte bien à `null` au repos.
        await store.append(makeAuditEvent({ id: "evt-nu", ts: 1_500_001 }));
        const page = await store.listPage({ limit: 1 });
        const [item] = page.items;
        assert.equal(item.id, "evt-nu");
        assert.ok(!("flags" in item), "flags ne doit pas être matérialisé");
        assert.ok(
          !("metadata" in item),
          "metadata ne doit pas être matérialisé",
        );
      });

      it("refuse un doublon d'identifiant (append-only, PK = `_id`)", async () => {
        await store.append(makeAuditEvent({ id: "evt-unique", ts: 1_500_002 }));
        // Un journal d'audit ne se réécrit pas : deux événements distincts ne
        // peuvent pas porter le même identifiant, et l'écrasement silencieux
        // serait une perte de trace.
        await assert.rejects(() =>
          store.append(makeAuditEvent({ id: "evt-unique", ts: 1_500_003 })),
        );
      });
    });

    describe("gc — rétention", () => {
      beforeAll(async () => {
        await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
        clock = 30_000_000;
        // Deux événements HORS fenêtre, un DEDANS (borne incluse côté récent).
        await store.append(
          makeAuditEvent({ id: "vieux-1", ts: clock - RETENTION_MS - 1 }),
        );
        await store.append(
          makeAuditEvent({ id: "vieux-2", ts: clock - RETENTION_MS - 1000 }),
        );
        await store.append(
          makeAuditEvent({ id: "recent", ts: clock - RETENTION_MS + 1 }),
        );
      });

      it("purge les événements hors rétention et rend leur compte", async () => {
        const purged = await store.gc();
        assert.equal(purged, 2);
        const page = await store.listPage({ limit: 10 });
        assert.deepEqual(
          page.items.map((e) => e.id),
          ["recent"],
        );
      });

      it("est idempotent (rejouer ne purge plus rien)", async () => {
        assert.equal(await store.gc(), 0);
      });
    });

    describe("dégradation gracieuse — ORM déconnecté", () => {
      // L'audit ne doit JAMAIS faire échouer le flux métier : un événement émis
      // pendant l'arrêt (l'ORM se déconnecte avant le drain des serveurs) est
      // perdu plutôt que de crasher un login. C'est le contrat, pas un accident.
      let degrade: MongooseAuditStore;

      beforeAll(() => {
        degrade = new MongooseAuditStore(
          () => null,
          () => clock,
        );
      });

      it("append est un no-op silencieux", async () => {
        await degrade.append(makeAuditEvent({ id: "perdu", ts: clock }));
      });

      it("listPage rend une page vide honnête", async () => {
        const page = await degrade.listPage({ limit: 10 });
        assert.deepEqual(page.items, []);
        assert.equal(page.total, 0);
        assert.equal(page.hasNext, false);
        assert.equal(page.nextCursor, null);
      });

      it("gc rend 0", async () => {
        assert.equal(await degrade.gc(), 0);
      });
    });

    describe("ordre total servi par l'INDEX, pas par un tri en mémoire", () => {
      it("la requête du journal parcourt l'index composite (ts, _id) — aucune étape SORT", async () => {
        // L'ordre (ts DESC, _id DESC) est ce qui garantit qu'aucun événement ne
        // se répète ni ne se perd d'une page à l'autre. Sans index composite,
        // Mongo sert le filtre par l'index sur `ts` puis départage EN MÉMOIRE
        // les événements d'une même milliseconde : juste, mais d'un coût qui
        // croît avec la rafale. Le plan d'exécution dit lequel des deux on a.
        await orm.pendingIndexAudit;
        const connection = orm.getNativeConnection<{
          model(name: string): {
            collection: {
              find(f: object): {
                sort(s: object): {
                  limit(n: number): { explain(): Promise<unknown> };
                };
              };
            };
          };
        }>();
        const plan = await connection
          .model(AUDIT_ENTITY_NAMES.events)
          .collection.find({})
          .sort({ ts: -1, _id: -1 })
          .limit(11)
          .explain();
        const winning = JSON.stringify(
          (plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner
            ?.winningPlan,
        );
        assert.ok(!winning.includes('"SORT"'), `tri en mémoire : ${winning}`);
        assert.ok(
          winning.includes('"keyPattern":{"ts":-1,"_id":-1}'),
          `index composite absent du plan : ${winning}`,
        );
      });
    });
  },
);
