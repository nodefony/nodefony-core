import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAccessTokenRecord } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import { runTokenStoreContract } from "./token-store-contract";

/**
 * Contrat `ITokenStore` — dialecte **sqlite** (MÊME suite que postgres/mysql).
 * Tourne toujours (`:memory:`, aucune infra).
 */
describe("DrizzleTokenStore — contrat (sqlite)", () => {
  runTokenStoreContract({
    dialect: "sqlite",
    connector: "tokens_sqlite",
    connection: { filename: ":memory:" },
  });
});

/**
 * Cas **propres à sqlite**, hors banc de parité : ils exploitent la connexion
 * UNIQUE (donc l'ordre d'exécution déterministe), ce qui n'est pas un invariant
 * portable — sur un pool pg/mysql, l'ordre d'arrivée au SGBD est libre et ces
 * assertions seraient flaky. Le banc partagé n'exige, lui, que ce qui vaut
 * PARTOUT (cf sa doc : « divergences assumées »).
 */
describe("DrizzleTokenStore — spécifique sqlite (ordre déterministe)", () => {
  const ORM = "tokens_sqlite_order";
  let CLOCK = 1_000_000;
  const now = (): number => CLOCK;
  let orm: DrizzleOrm;
  let store: DrizzleTokenStore;

  const makeRecord = (
    over: Partial<IAccessTokenRecord> & Pick<IAccessTokenRecord, "id">,
  ): IAccessTokenRecord =>
    ({
      kind: "pat",
      name: "test",
      prefix: null,
      subjectId: "u1",
      subjectType: "user",
      tenantId: null,
      scopes: [],
      audience: [],
      resources: null,
      secretHash: `hash-${over.id}`,
      hashAlg: "sha256",
      clientId: null,
      cnf: null,
      family: null,
      replacedBy: null,
      createdAt: CLOCK,
      expiresAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedUserAgent: null,
      revokedAt: null,
      revokedReason: null,
      metadata: {},
      ...over,
    }) as IAccessTokenRecord;

  beforeAll(async () => {
    registerTokenEntities(ORM);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleTokenStore.from(orm, now, 30 * 24 * 3_600_000);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, ORM);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, ORM);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, ORM);
    ormRegistry.unregister(ORM);
  });

  it("collision de secretHash : sqlite REJETTE (l'autre moitié de la divergence mysql)", async () => {
    // Pendant du test `token-store-mysql.e2e` : ici `ON CONFLICT (id)` n'arbitre
    // pas la 2ᵉ unique (`secretHash`) → la violation remonte, le jeton légitime
    // est INTACT. En mysql (ODKU sans `target`), le même appel écrase la ligne en
    // conflit. L'invariant portable — « un secret ne désigne jamais deux jetons »
    // — tient dans les deux cas et vit au banc ; c'est le COMMENT qui diverge.
    await store.put(
      makeRecord({ id: "coll-1", secretHash: "dup", name: "LEGITIME" }),
    );
    await assert.rejects(
      () => store.put(makeRecord({ id: "coll-2", secretHash: "dup" })),
      /UNIQUE constraint failed/,
    );
    const legit = await store.findById("coll-1");
    assert.equal(legit?.name, "LEGITIME", "le jeton légitime est INTACT");
    assert.equal(await store.findById("coll-2"), null);
  });

  it("revoke CONCURRENT : c'est bien la 1ʳᵉ LANCÉE qui gagne (FIFO microtasks)", async () => {
    // En sqlite la connexion est unique et les `await` se réordonnancent en FIFO
    // → `logout`, lancé en premier, atteint la base en premier : c'est LUI la
    // « 1ʳᵉ » révocation, au sens fort. Sans le `revokedAt IS NULL` au WHERE,
    // les deux lisent « pas révoqué » et écrivent → c'est `manual`, le DERNIER,
    // qui reste, et la promesse « conserve la 1ʳᵉ date/raison » tombe en silence.
    // C'est le test qui a prouvé le bug (rouge 3/3 sans le fix).
    await store.put(makeRecord({ id: "det-1" }));
    CLOCK = 7_000_000;
    await Promise.all([
      store.revoke("det-1", "logout"),
      store.revoke("det-1", "manual"),
    ]);
    const after = await store.findById("det-1");
    assert.equal(after?.revokedAt, 7_000_000);
    assert.equal(
      after?.revokedReason,
      "logout",
      "la 1ʳᵉ raison tient — la 2ᵉ ne réécrit pas l'audit",
    );
  });
});
