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

/** Record minimal complet (24 champs) pour le banc de divergence. */
function makeMinimalRecord(
  over: Partial<IAccessTokenRecord> & Pick<IAccessTokenRecord, "id">,
): IAccessTokenRecord {
  return {
    kind: "pat",
    name: "test",
    prefix: null,
    subjectId: "u-div",
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
    createdAt: 1_000_000,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
    ...over,
  } as IAccessTokenRecord;
}

/**
 * Contrat `ITokenStore` — dialecte **mysql** (MÊME suite que sqlite/postgres).
 *
 * C'est le dialecte aux chemins les plus divergents pour ce store : pas de
 * `RETURNING` (les verbes `*One` deviennent SELECT-cible → mutation bornée PK →
 * relecture), `ON DUPLICATE KEY UPDATE` au lieu d'`ON CONFLICT` (donc arbitrage
 * sur TOUTES les uniques, sans `target`), `GREATEST()` au lieu de `MAX()` pour
 * `$max`, `bigint` pour les epoch ms, et un JSON que MariaDB rend en string
 * (customType) là où MySQL rend un objet. Chaque assertion partagée prouve que
 * cette divergence reste INVISIBLE au contrat.
 *
 * Couvre MySQL Community ET MariaDB (mêmes e2e, autre port).
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 *   # MySQL 8.4 (preuve de compat) : même commande, port 3307
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("DrizzleTokenStore — contrat (mysql)", () => {
  runTokenStoreContract({
    dialect: "mysql",
    connector: "tokens_mysql",
    connection: { url: MYSQL_URL },
  });
});

/**
 * DIVERGENCE ASSUMÉE, hors banc de parité — gravée ici pour qu'elle soit
 * CONNUE plutôt que découverte en production.
 *
 * `put` d'un record dont le `secretHash` est déjà pris par un AUTRE id :
 * sqlite/postgres **rejettent** (leur `ON CONFLICT (id)` n'arbitre pas la 2ᵉ
 * unique → violation), mysql **écrase la ligne en conflit** (`ON DUPLICATE KEY
 * UPDATE` n'accepte pas de `target` : MySQL arbitre sur TOUTES les uniques, ici
 * `secretHash`). Le jeton légitime garde son `id` mais reçoit les champs de
 * l'intrus, et le nouvel id n'existe pas.
 *
 * **Pourquoi on ne corrige pas** : le seul remède serait un SELECT d'existence
 * avant chaque `put` (2 round-trips sur un chemin chaud : toute création de
 * jeton et toute rotation de refresh) — pour un cas inatteignable, le hash étant
 * un sha256 de secret aléatoire (collision ≈ 2⁻¹²⁸). L'invariant qui compte —
 * « un secret ne désigne jamais deux jetons » — tient sur les trois dialectes,
 * et c'est lui qui est au banc.
 */
describe.skipIf(!MYSQL_URL)(
  "DrizzleTokenStore — divergence mysql (ODKU sans target)",
  () => {
    const ORM = "tokens_mysql_div";
    let orm: DrizzleOrm;
    let store: DrizzleTokenStore;

    beforeAll(async () => {
      registerTokenEntities(ORM, "mysql");
      orm = new DrizzleOrm(ORM, { dialect: "mysql", url: MYSQL_URL });
      await orm.connect();
      store = DrizzleTokenStore.from(orm, () => 1_000_000);
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
    });

    afterAll(async () => {
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      await orm.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, ORM);
      ormRegistry.unregister(ORM);
    });

    it("collision de secretHash : mysql ÉCRASE le jeton en place au lieu de rejeter", async () => {
      await store.put(
        makeMinimalRecord({ id: "d1", secretHash: "dup", name: "LEGITIME" }),
      );
      // Ne lève PAS (contrairement à sqlite/pg) : ODKU bascule en UPDATE.
      await store.put(
        makeMinimalRecord({ id: "d2", secretHash: "dup", name: "INTRUS" }),
      );
      const all = await store.listAll();
      assert.equal(all.length, 1, "toujours 1 seule ligne (l'invariant tient)");
      assert.equal(all[0].id, "d1", "l'id de la ligne en conflit est CONSERVÉ");
      assert.equal(all[0].name, "INTRUS", "…mais ses champs sont ÉCRASÉS");
      assert.equal(
        await store.findById("d2"),
        null,
        "le nouvel id n'existe pas",
      );
    });
  },
);
