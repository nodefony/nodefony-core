import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  PROBE_ENTITY,
  runRepositoryContract,
} from "../../../orm-core/tests/support/repositoryContract";

const ORM = "repo_contract";
// Serveur Mongo PARTAGÉ (globalSetup, ReplSet pour les transactions) scopé sur
// la base `repo_contract`. `null` → infra absente → suite skippée.
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du **banc de contrat UNIQUE** `IRepository` + `IOrm` — le
 * banc vit chez `@nodefony/orm-core`, et `@nodefony/drizzle` branche EXACTEMENT
 * le même sur ses trois dialectes. C'est cette identité qui fait la parité : un
 * écart de comportement entre les deux adaptateurs devient un test rouge, par
 * construction.
 *
 * L'entité sonde suit les conventions des entités du framework côté Mongo :
 * `_id` texte porté par la clé naturelle, `default: null` pour un champ
 * nullable (l'équivalent d'une colonne SQL sans `NOT NULL`).
 */
describe.skipIf(!URI)("MongooseOrm — contrat IRepository + IOrm", () => {
  let orm: MongooseOrm;

  beforeAll(async () => {
    entityRegistry.register({
      connector: ORM,
      name: PROBE_ENTITY,
      schema: {
        _id: { type: String, default: () => randomUUID() },
        name: { type: String, required: true },
        age: { type: Number, required: true, index: true },
        score: { type: Number, required: true },
        tags: { type: Object, default: null },
        active: { type: Boolean, required: true, default: true },
        createdAt: { type: Number, required: true, default: () => Date.now() },
        note: { type: String, default: null },
      },
    });
    orm = new MongooseOrm(ORM, URI!);
    await orm.connect(); // le banc purge la collection (base persistante)
  });

  afterAll(async () => {
    await orm?.disconnect();
    entityRegistry.unregister(PROBE_ENTITY, ORM);
    ormRegistry.unregister(ORM);
  });

  runRepositoryContract({
    orm: () => orm,
    offline: () => ({
      orm: new MongooseOrm(`${ORM}_offline`, URI!),
      dispose: () => ormRegistry.unregister(`${ORM}_offline`),
    }),
    driver: "mongodb",
    // Mongo n'a pas de savepoints : `savepoint`/`rollbackTo` sont un no-op
    // documenté (cf `advanced.test.ts`) — le cas est sauté, et nommé.
    savepoints: false,
    assertProbe: async (o) => {
      const p = await o.probe!();
      assert.ok(p, "sonde rendue");
    },
  });
});
