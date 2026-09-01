import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_CONNECTOR,
} from "../../nodefony/registerStores";
import { createUserEntity } from "../../nodefony/entity/userTable";

/**
 * Une application qui ne possède pas son entité `User` ne peut pas servir
 * d'annuaire hors développement — et doit l'apprendre AU DÉMARRAGE.
 *
 * L'entité de repli du framework rend service en développement, aux bancs et
 * quand l'annuaire est en mémoire. Mais depuis que la table appartient à
 * l'application, ce repli n'est dans AUCUNE chaîne de migration : hors
 * développement, où le schéma est dérivé du code, personne ne crée la table.
 * L'application démarrerait, servirait ses pages, et tomberait à la première
 * authentification — sur une erreur de table absente, qui ne dit pas quoi faire.
 *
 * Le refus ne vise QUE la rencontre des deux conditions. C'est ce que ce banc
 * vérifie : chacune prise seule laisse passer.
 */
describe("l'entité `User` de repli hors développement", () => {
  const cleanup = async (orm: DrizzleOrm): Promise<void> => {
    await orm.disconnect();
    entityRegistry.unregister("User", FRAMEWORK_CONNECTOR);
    ormRegistry.unregister(orm.name);
  };

  it("REFUSE de servir l'annuaire, en nommant le remède", async () => {
    registerDrizzleFrameworkStores("sqlite"); // pose le repli : aucune entité d'app
    const orm = new DrizzleOrm(FRAMEWORK_CONNECTOR, {
      filename: ":memory:",
      deriveSchema: false, // le schéma appartient aux migrations (production)
    });
    await orm.connect();
    try {
      assert.throws(
        () => DrizzleUserRepository.from(orm),
        (error: Error) => {
          assert.match(error.message, /doit posséder son entité/);
          // Un refus qui ne dit pas quoi faire fait détruire des bases.
          assert.match(error.message, /nodefony create entity User/);
          assert.match(error.message, /orm:migrate/);
          return true;
        },
      );
    } finally {
      await cleanup(orm);
    }
  });

  it("LAISSE PASSER en développement — le schéma y est dérivé du code", async () => {
    registerDrizzleFrameworkStores("sqlite");
    const orm = new DrizzleOrm(FRAMEWORK_CONNECTOR, {
      filename: ":memory:",
      deriveSchema: true,
    });
    await orm.connect();
    try {
      assert.ok(DrizzleUserRepository.from(orm));
    } finally {
      await cleanup(orm);
    }
  });

  it("LAISSE PASSER quand l'application possède son entité", async () => {
    // L'app pose la sienne AVANT : le repli la respecte, donc rien n'est « de repli ».
    entityRegistry.register(createUserEntity(FRAMEWORK_CONNECTOR, "sqlite"));
    registerDrizzleFrameworkStores("sqlite");
    const orm = new DrizzleOrm(FRAMEWORK_CONNECTOR, {
      filename: ":memory:",
      deriveSchema: false,
    });
    await orm.connect();
    try {
      assert.ok(DrizzleUserRepository.from(orm));
    } finally {
      await cleanup(orm);
    }
  });
});
