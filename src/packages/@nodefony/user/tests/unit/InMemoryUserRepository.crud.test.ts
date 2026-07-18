import assert from "node:assert/strict";
import { InMemoryUserRepository } from "../../nodefony/src/InMemoryUserRepository";
import type { IPasswordAuthenticatedUser } from "../../nodefony/contracts/index";
import type { BaseUser } from "../../nodefony/src/BaseUser";
import type { Criteria } from "@nodefony/orm-core";

/**
 * CRUD d'`InMemoryUserRepository` face au contrat `IRepository`.
 *
 * Ce dépôt n'est PAS qu'une fixture de test : `NF_USER_STORE=memory` (et
 * `NF_STORE=memory`) le met en service dans l'application réelle — bancs de
 * charge, scripts, essais manuels. Tout écart avec Drizzle/Mongoose fait donc
 * mesurer et éprouver autre chose que la production. Jusqu'ici seuls
 * `listPage`/`countActiveAdmins` étaient couverts : le CRUD entier, lui, ne
 * l'était pas — et il ne tenait pas sa promesse (cf le cas `enabled`/`locked`).
 *
 * On teste le CONTRAT (ce que tout backend doit garantir), pas l'implémentation.
 */

const crit = (o: Record<string, unknown>) =>
  o as Criteria<IPasswordAuthenticatedUser>;

/** Dépôt neuf avec deux comptes connus. */
async function repo(): Promise<{
  r: InMemoryUserRepository;
  alice: IPasswordAuthenticatedUser;
}> {
  const r = new InMemoryUserRepository();
  const alice = await r.create({
    identifier: "alice",
    password: "hash-a",
    roles: ["ROLE_USER"],
  });
  await r.create({ identifier: "bob", password: "hash-b", roles: [] });
  return { r, alice };
}

describe("InMemoryUserRepository — CRUD (contrat IRepository)", () => {
  describe("create / find / findOne", () => {
    it("create pose un id et les défauts d'un compte utilisable", async () => {
      const { alice } = await repo();
      assert.ok(alice.id, "un id est attribué");
      assert.equal(alice.identifier, "alice");
      assert.equal(alice.isActive(), true, "un compte naît actif");
      assert.equal(alice.isLocked(), false, "et non verrouillé");
    });

    it("find sans critère rend tout ; avec critère, filtre", async () => {
      const { r } = await repo();
      assert.equal((await r.find()).length, 2);
      const found = await r.find(crit({ identifier: "bob" }));
      assert.equal(found.length, 1);
      assert.equal(found[0]!.identifier, "bob");
    });

    it("findOne rend `null` (jamais une erreur) quand rien ne matche", async () => {
      const { r } = await repo();
      assert.equal(await r.findOne(crit({ identifier: "nobody" })), null);
    });

    it("les rôles fournis ne restent PAS partagés avec l'appelant", async () => {
      const r = new InMemoryUserRepository();
      const roles = ["ROLE_USER"];
      const user = await r.create({ identifier: "eve", roles });
      roles.push("ROLE_NODEFONY_ADMIN"); // l'appelant mute SON tableau
      assert.deepEqual(
        user.roles,
        ["ROLE_USER"],
        "une élévation de privilège ne doit pas se produire par aliasing",
      );
    });
  });

  describe("updateOne", () => {
    it("rend `null` si le critère ne matche rien", async () => {
      const { r } = await repo();
      assert.equal(
        await r.updateOne(crit({ identifier: "nobody" }), { password: "x" }),
        null,
      );
    });

    it("applique password et roles", async () => {
      const { r } = await repo();
      const up = await r.updateOne(crit({ identifier: "alice" }), {
        password: "hash-2",
        roles: ["ROLE_NODEFONY_ADMIN"],
      });
      assert.equal(up?.password, "hash-2");
      assert.deepEqual(up?.roles, ["ROLE_NODEFONY_ADMIN"]);
    });

    it("`password: null` est un EFFACEMENT, pas un champ absent (compte 100 % OAuth)", async () => {
      const { r } = await repo();
      const up = await r.updateOne(crit({ identifier: "alice" }), {
        password: null,
      });
      assert.equal(up?.password, null);
    });

    // Le cas qui manquait : `updateOne` n'appliquait QUE password et roles, donc
    // désactiver ou verrouiller un compte était un NO-OP silencieux — l'entité
    // était renvoyée, l'appelant croyait avoir réussi. Drizzle et Mongoose, eux,
    // l'appliquent : en `NF_USER_STORE=memory` on n'exerçait pas la production.
    it("🔒 applique enabled : désactiver un compte le désactive VRAIMENT", async () => {
      const { r } = await repo();
      const up = await r.updateOne(crit({ identifier: "alice" }), {
        enabled: false,
      } as Partial<IPasswordAuthenticatedUser>);
      assert.equal(up?.isActive(), false, "le compte doit être inactif");
      // Et l'état est PERSISTÉ dans le dépôt, pas seulement sur l'objet rendu.
      const reread = await r.findOne(crit({ identifier: "alice" }));
      assert.equal(reread?.isActive(), false);
    });

    it("🔒 applique locked : verrouiller un compte le verrouille VRAIMENT", async () => {
      const { r } = await repo();
      await r.updateOne(crit({ identifier: "alice" }), {
        locked: true,
      } as Partial<IPasswordAuthenticatedUser>);
      const reread = await r.findOne(crit({ identifier: "alice" }));
      assert.equal(reread?.isLocked(), true);
    });

    it("réactiver / déverrouiller fonctionne dans les deux sens", async () => {
      const { r } = await repo();
      const c = crit({ identifier: "alice" });
      await r.updateOne(c, {
        enabled: false,
        locked: true,
      } as Partial<IPasswordAuthenticatedUser>);
      await r.updateOne(c, {
        enabled: true,
        locked: false,
      } as Partial<IPasswordAuthenticatedUser>);
      const u = await r.findOne(c);
      assert.equal(u?.isActive(), true);
      assert.equal(u?.isLocked(), false);
    });

    it("applique metadata et socialProviders (copie défensive)", async () => {
      const { r } = await repo();
      const providers = [
        { provider: "github", providerId: "42", createdAt: new Date(0) },
      ];
      const up = (await r.updateOne(crit({ identifier: "alice" }), {
        metadata: { theme: "dark" },
        socialProviders: providers,
      } as Partial<IPasswordAuthenticatedUser>)) as BaseUser | null;
      // `metadata`/`socialProviders` sont des champs d'ENTITÉ, hors du contrat
      // credential `IPasswordAuthenticatedUser` — d'où la vue `BaseUser` ici.
      assert.deepEqual(up?.metadata, { theme: "dark" });
      assert.equal(up?.socialProviders.length, 1);
      providers.push({
        provider: "google",
        providerId: "7",
        createdAt: new Date(0),
      });
      assert.equal(
        up?.socialProviders.length,
        1,
        "le tableau stocké ne suit pas les mutations de l'appelant",
      );
    });
  });

  describe("upsert", () => {
    it("met à jour quand le critère matche (pas de doublon)", async () => {
      const { r } = await repo();
      const up = await r.upsert(crit({ identifier: "alice" }), {
        password: "hash-3",
      });
      assert.equal(up.password, "hash-3");
      assert.equal(await r.count(), 2, "aucune ligne créée");
    });

    it("crée quand rien ne matche, en fusionnant critère + insertOnly", async () => {
      const { r } = await repo();
      const created = await r.upsert(
        crit({ identifier: "carol" }),
        { password: "hash-c" },
        { roles: ["ROLE_USER"] },
      );
      assert.equal(created.identifier, "carol");
      assert.equal(created.password, "hash-c");
      assert.deepEqual(created.roles, ["ROLE_USER"]);
      assert.equal(await r.count(), 3);
    });
  });

  describe("suppression", () => {
    it("deleteOne supprime AU PLUS une entité et dit si elle existait", async () => {
      const { r } = await repo();
      assert.equal(await r.deleteOne(crit({ identifier: "bob" })), true);
      assert.equal(await r.count(), 1);
      assert.equal(
        await r.deleteOne(crit({ identifier: "bob" })),
        false,
        "seconde suppression : false, jamais une erreur",
      );
    });

    it("findOneAndDelete rend l'entité supprimée, puis `null`", async () => {
      const { r } = await repo();
      const gone = await r.findOneAndDelete(crit({ identifier: "bob" }));
      assert.equal(gone?.identifier, "bob");
      assert.equal(await r.findOneAndDelete(crit({ identifier: "bob" })), null);
    });

    it("delete supprime en masse et rend le compte", async () => {
      const { r } = await repo();
      await r.create({ identifier: "carol", roles: ["ROLE_USER"] });
      assert.equal(
        await r.delete(crit({ roles: [] })),
        0,
        "roles = tableau → égalité stricte, ne matche pas",
      );
      assert.equal(await r.delete({}), 3, "critère vide = tout");
      assert.equal(await r.count(), 0);
    });
  });

  describe("divers", () => {
    it("exists reflète la présence", async () => {
      const { r } = await repo();
      assert.equal(await r.exists(crit({ identifier: "alice" })), true);
      assert.equal(await r.exists(crit({ identifier: "nobody" })), false);
    });

    it("createMany crée tout le lot", async () => {
      const r = new InMemoryUserRepository();
      const made = await r.createMany([
        { identifier: "u1" },
        { identifier: "u2" },
      ]);
      assert.equal(made.length, 2);
      assert.equal(await r.count(), 2);
    });

    it("updateMany applique à toutes les entités matchées et rend le compte", async () => {
      const { r } = await repo();
      const n = await r.updateMany({}, {
        enabled: false,
      } as Partial<IPasswordAuthenticatedUser>);
      assert.equal(n, 2);
      for (const u of await r.find()) {
        assert.equal(u.isActive(), false, "chaque compte est désactivé");
      }
    });

    it("increment ajoute au champ, et rend `null` si rien ne matche", async () => {
      const { r } = await repo();
      const up = await r.increment(crit({ identifier: "alice" }), {
        loginCount: 2,
      } as Partial<Record<keyof IPasswordAuthenticatedUser, number>>);
      assert.equal(
        (up as unknown as Record<string, number>).loginCount,
        2,
        "champ absent traité comme 0",
      );
      assert.equal(
        await r.increment(crit({ identifier: "nobody" }), {} as never),
        null,
      );
    });

    it("withTransaction rend le dépôt lui-même (pas de transaction en mémoire)", async () => {
      const { r } = await repo();
      assert.equal(r.withTransaction({} as never), r);
    });
  });
});
