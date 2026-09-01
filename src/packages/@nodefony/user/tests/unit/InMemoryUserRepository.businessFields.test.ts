import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { InMemoryUserRepository } from "../../nodefony/src/InMemoryUserRepository";
import type { IPasswordAuthenticatedUser } from "../../nodefony/contracts/index";

/**
 * Un champ métier écrit sur l'annuaire mémoire doit se relire — comme sur un
 * backend réel.
 *
 * Ce dépôt n'est pas qu'un accessoire de test : il tourne en application réelle
 * (`NF_USER_STORE=memory`, bancs de charge). S'il perdait les champs métier que
 * SQL et Mongo conservent, une mesure faite dessus ne dirait rien de la
 * production.
 */
describe("annuaire mémoire — les champs métier de l'application", () => {
  /** L'écriture passe par le dépôt générique : le contrat typé ne les connaît pas. */
  const withBusiness = (
    data: Record<string, unknown>,
  ): Partial<IPasswordAuthenticatedUser> =>
    data as Partial<IPasswordAuthenticatedUser>;

  it("un champ écrit à la création se relit", async () => {
    const users = new InMemoryUserRepository();
    const created = await users.create(
      withBusiness({ identifier: "carol@example.com", firstName: "Carol" }),
    );
    assert.equal(
      (created as unknown as { firstName: string }).firstName,
      "Carol",
    );

    const reread = await users.findByIdentifier("carol@example.com");
    assert.ok(reread);
    assert.equal(
      (reread as unknown as { firstName: string }).firstName,
      "Carol",
    );
  });

  it("un champ écrit à la mise à jour se relit", async () => {
    const users = new InMemoryUserRepository();
    await users.create(withBusiness({ identifier: "dave@example.com" }));
    await users.updateOne(
      { identifier: "dave@example.com" },
      withBusiness({ firstName: "Dave", department: "R&D" }),
    );
    const reread = await users.findByIdentifier("dave@example.com");
    assert.equal(
      (reread as unknown as { firstName: string }).firstName,
      "Dave",
    );
    assert.equal(
      (reread as unknown as { department: string }).department,
      "R&D",
    );
  });

  it("le contrat reste intact — un champ métier n'usurpe pas une colonne", async () => {
    const users = new InMemoryUserRepository();
    const created = await users.create(
      withBusiness({
        identifier: "erin@example.com",
        roles: ["ROLE_USER"],
        firstName: "Erin",
      }),
    );
    assert.equal(created.identifier, "erin@example.com");
    assert.deepEqual(created.roles, ["ROLE_USER"]);
    assert.equal(created.hasRole("ROLE_USER"), true);
  });
});
