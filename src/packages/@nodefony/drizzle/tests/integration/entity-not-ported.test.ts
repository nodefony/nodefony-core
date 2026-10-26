import assert from "node:assert/strict";
import { pgTable, text } from "drizzle-orm/pg-core";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  DrizzleOrm,
  EntityNotPortedError,
} from "../../nodefony/src/orm-core/index";

/**
 * Une entité écrite pour un AUTRE moteur est refusée par une erreur à part.
 *
 * Rangé avec les échecs du pilote, ce refus ouvrait le message de démarrage
 * par « n'a pas pu se connecter — vérifier qu'elle est démarrée » devant une
 * base qui répondait (banc de portabilité, #683). Le démarrage reconnaît la
 * classe et met la cause en tête : ce test garde la forme qu'il reconnaît.
 */
const ORM = "db_entity_not_ported";

const nativePgTable = pgTable("NativeOnly", {
  id: text("id").primaryKey(),
});

describe("Drizzle — une entité non portée sur le dialecte du connecteur", () => {
  afterAll(() => {
    entityRegistry.unregister("NativeOnly", ORM);
    ormRegistry.unregister(ORM);
  });

  it("lève EntityNotPortedError, qui nomme l'entité et le dialecte", async () => {
    entityRegistry.register({
      connector: ORM,
      name: "NativeOnly",
      schema: nativePgTable,
    });
    const orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await assert.rejects(
      () => orm.connect(),
      (e: unknown) =>
        e instanceof EntityNotPortedError &&
        e.entity === "NativeOnly" &&
        e.dialect === "sqlite" &&
        e.message.includes("is not ported to this dialect"),
    );
  });
});
