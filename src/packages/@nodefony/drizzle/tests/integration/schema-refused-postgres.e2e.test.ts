import assert from "node:assert/strict";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * **Un schéma REFUSÉ par PostgreSQL n'est pas une connexion manquée.**
 *
 * Vécu en CI : une clé étrangère `uuid` vers une colonne `text` — SQLSTATE
 * `42804` (datatype_mismatch) — rapportée « n'a pas pu se connecter à
 * 127.0.0.1:5432 », avec le conseil de vérifier que la base est démarrée. Elle
 * répondait très bien. Ce banc rejoue le refus sur un VRAI serveur : le test
 * unitaire du diagnostic suppose la forme de l'erreur, celui-ci la constate.
 *
 * GATE : `NF_PG_URL` (sinon skip).
 */

const PG_URL = process.env.NF_PG_URL;
const CONNECTOR = "schema_refuse_pg";
const suffix = `${process.pid}`;
const parentTable = pgTable(`refus_parent_${suffix}`, {
  id: text("id").primaryKey(),
});
const childTable = pgTable(`refus_enfant_${suffix}`, {
  id: text("id").primaryKey(),
  // 🔴 uuid → text : PostgreSQL refuse la contrainte (42804).
  parentId: uuid("parentId").references(() => parentTable.id),
});

describe.skipIf(!PG_URL)(
  "DrizzleService — PostgreSQL refuse le schéma (42804)",
  () => {
    afterAll(() => {
      entityRegistry.unregister("RefusParent", CONNECTOR);
      entityRegistry.unregister("RefusEnfant", CONNECTOR);
      ormRegistry.unregister(CONNECTOR);
    });

    it("🔴 le message nomme le refus, en tête, et ne parle pas de connexion", async () => {
      entityRegistry.register({
        connector: CONNECTOR,
        name: "RefusParent",
        schema: parentTable,
      });
      entityRegistry.register({
        connector: CONNECTOR,
        name: "RefusEnfant",
        schema: childTable,
      });
      const service = new DrizzleService({
        config: {
          connectors: {
            [CONNECTOR]: {
              dialect: "postgres",
              url: PG_URL,
              ddl: "auto",
            },
          },
        },
        hookKernel: () => undefined,
      } as unknown as Module);

      let message = "";
      try {
        await service.connectAll();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert.ok(message.length > 0, "le démarrage aurait dû être refusé");
      assert.match(message, /42804/, message);
      assert.ok(
        !message.includes("n'a pas pu se connecter"),
        `annonce encore une connexion manquée : ${message}`,
      );
      assert.ok(!message.includes("démarrée"), message);
      assert.match(
        message,
        /s'est connecté, mais le serveur a refusé une instruction/,
      );
    });
  },
);
