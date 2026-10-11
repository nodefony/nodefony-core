import assert from "node:assert/strict";
import { RequestContext } from "nodefony";
import {
  BaseUser,
  anonymousUser,
  authenticatedUser,
  requestUser,
} from "../../index";

// L'utilisateur que le pare-feu a déjà chargé pour la requête : réutilisé tel
// quel s'il est bien celui qu'on cherche, sinon `null` (l'appelant relit).
// La décision « authentifié ? » appartient au cœur : elle part du JETON que le
// pare-feu pose avec l'utilisateur.

const alice = (options: { enabled?: boolean; locked?: boolean } = {}) =>
  new BaseUser({
    id: "u-1",
    identifier: "alice@acme.io",
    roles: ["ROLE_USER"],
    metadata: { givenName: "Alice" },
    ...options,
  });

const token = (authenticated: boolean) => ({
  isAuthenticated: () => authenticated,
});

/** Exécute `fn` dans une requête où le pare-feu a posé `user` et son jeton. */
function inZone<T>(user: unknown, authenticated: boolean, fn: () => T): T {
  return RequestContext.run(
    { requestId: "r", user, token: token(authenticated) },
    fn,
  );
}

describe("requestUser — l'utilisateur déjà chargé pour la requête", () => {
  it("rend le MÊME objet (champs propres compris) quand l'identifiant correspond", () => {
    const user = alice();
    inZone(user, true, () => {
      assert.strictEqual(requestUser("alice@acme.io"), user);
    });
  });

  it("null si l'identifiant diffère : on relit le bon compte", () => {
    inZone(alice(), true, () => {
      assert.equal(requestUser("bob@acme.io"), null);
    });
  });

  it("null pour l'anonyme d'une zone `anonymous` : son jeton n'est pas authentifié", () => {
    inZone(anonymousUser, false, () => {
      assert.equal(requestUser(anonymousUser.identifier), null);
      assert.equal(authenticatedUser(), null);
    });
  });

  it("🔴 null pour un utilisateur posé SANS jeton : personne ne l'a authentifié", () => {
    RequestContext.run({ requestId: "r", user: alice() }, () => {
      assert.equal(requestUser("alice@acme.io"), null);
      assert.equal(authenticatedUser(), null);
    });
  });

  it("null pour un compte verrouillé ou désactivé : l'appelant relit et refuse", () => {
    inZone(alice({ locked: true }), true, () => {
      assert.equal(requestUser("alice@acme.io"), null);
    });
    inZone(alice({ enabled: false }), true, () => {
      assert.equal(requestUser("alice@acme.io"), null);
    });
  });

  it("null hors requête, et pour une identité sans les méthodes du contrat IUser", () => {
    assert.equal(requestUser("alice@acme.io"), null);
    // Identité minimale (projection d'un DTO) : valide pour le cœur, pas un IUser.
    inZone({ id: "u-1", identifier: "alice@acme.io", roles: [] }, true, () => {
      assert.equal(requestUser("alice@acme.io"), null);
      assert.equal(authenticatedUser(), null);
    });
  });
});
