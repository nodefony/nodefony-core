import assert from "node:assert/strict";
import { BootConfigurationError } from "nodefony";
import { USER_PRIVATE_FIELDS, entityPrivateFields } from "../../index";

const all = (): boolean => true;

describe("entityPrivateFields — ce qu'une relation ne laisse pas sortir", () => {
  it("le contrat tait l'empreinte et l'état d'autorisation, pas l'identifiant", () => {
    assert.ok(USER_PRIVATE_FIELDS.includes("password"));
    for (const field of ["roles", "enabled", "locked", "credentialsVersion"]) {
      assert.ok(USER_PRIVATE_FIELDS.includes(field), field);
    }
    for (const field of ["id", "identifier", "metadata", "createdAt"]) {
      assert.ok(!USER_PRIVATE_FIELDS.includes(field), field);
    }
  });

  it("une entité User qui ne déclare RIEN tait quand même le contrat (défaut fermé)", () => {
    assert.deepEqual(
      entityPrivateFields({ name: "User" }, all),
      USER_PRIVATE_FIELDS,
    );
  });

  it("une entité User qui déclare ses champs les AJOUTE au contrat, sans le remplacer", () => {
    const fields = entityPrivateFields(
      { name: "User", privateFields: ["ssn"] },
      all,
    );
    assert.ok(fields?.includes("password"));
    assert.ok(fields?.includes("ssn"));
  });

  it("un champ du contrat que la table ne porte pas n'est pas exigé", () => {
    const fields = entityPrivateFields(
      { name: "User" },
      (field) => field !== "currentRole",
    );
    assert.ok(fields?.includes("password"));
    assert.ok(!fields?.includes("currentRole"));
  });

  it("une autre entité ne tait que ce qu'elle déclare", () => {
    assert.equal(entityPrivateFields({ name: "Book" }, all), null);
    assert.deepEqual(
      entityPrivateFields({ name: "Book", privateFields: ["cost"] }, all),
      ["cost"],
    );
  });

  it("un champ privé mal orthographié refuse le démarrage en le nommant", () => {
    assert.throws(
      () =>
        entityPrivateFields(
          { name: "Book", privateFields: ["cots"] },
          (field) => field === "cost",
        ),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("« cots »") &&
        error.message.includes("« Book »"),
    );
  });
});
