import assert from "node:assert/strict";
import { BaseUser, anonymousUser, requestUser } from "../../index";

// L'utilisateur que le pare-feu a déjà chargé pour la requête : réutilisé tel
// quel s'il est bien celui qu'on cherche, sinon `null` (l'appelant relit).

const alice = (options: { enabled?: boolean; locked?: boolean } = {}) =>
  new BaseUser({
    id: "u-1",
    identifier: "alice@acme.io",
    roles: ["ROLE_USER"],
    metadata: { givenName: "Alice" },
    ...options,
  });

describe("requestUser — l'utilisateur déjà chargé pour la requête", () => {
  it("rend le MÊME objet (champs propres compris) quand l'identifiant correspond", () => {
    const user = alice();
    const found = requestUser(user, "alice@acme.io");
    assert.strictEqual(found, user);
  });

  it("null si l'identifiant diffère : on relit le bon compte", () => {
    assert.equal(requestUser(alice(), "bob@acme.io"), null);
  });

  it("null pour l'utilisateur anonyme, même interrogé sous son identifiant", () => {
    assert.equal(requestUser(anonymousUser, anonymousUser.identifier), null);
  });

  it("null pour un compte verrouillé ou désactivé : l'appelant relit et refuse", () => {
    assert.equal(requestUser(alice({ locked: true }), "alice@acme.io"), null);
    assert.equal(requestUser(alice({ enabled: false }), "alice@acme.io"), null);
  });

  it("null pour une valeur qui n'a pas la forme du contrat", () => {
    assert.equal(requestUser(null, "alice@acme.io"), null);
    assert.equal(requestUser("alice@acme.io", "alice@acme.io"), null);
    // Identité minimale sans les méthodes du contrat (ex. projection d'un DTO).
    assert.equal(
      requestUser({ id: "u-1", identifier: "alice@acme.io" }, "alice@acme.io"),
      null,
    );
  });
});
