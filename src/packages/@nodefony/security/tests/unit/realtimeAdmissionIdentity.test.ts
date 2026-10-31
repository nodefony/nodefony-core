import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RequestContext } from "nodefony";
import { BaseUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import { FirewallRealtimeAuthenticator } from "../../nodefony/src/authenticator/FirewallRealtimeAuthenticator";
import { UserRealtimeToken } from "../../nodefony/src/realtime/UserRealtimeToken";
import { UserToken } from "../../nodefony/src/token/UserToken";
import type { IRealtimeHandshake } from "../../nodefony/src/realtime/realtimeContracts";

/**
 * Identité d'ADMISSION produite par la sécurité (ADR-0021 §S10) : ce que la
 * règle `allow` d'un canal recevra. Chaque cas garde une protection que le
 * framework applique SEUL — l'application ne construit jamais cette donnée.
 */

const HANDSHAKE: IRealtimeHandshake = {
  headers: {},
  cookies: new Map(),
  url: "/realtime",
  remoteAddress: "127.0.0.1",
  protocols: [],
};

function makeUser(): IUser {
  return new BaseUser({
    id: "acc-42",
    identifier: "alice@example.test",
    roles: ["ROLE_USER"],
  });
}

async function admissionOf(issued: UserToken, user: IUser) {
  const auth = new FirewallRealtimeAuthenticator();
  const token = await RequestContext.run(
    { requestId: "t-adm", user, token: issued },
    () => auth.authenticate(HANDSHAKE),
  );
  const who = token.getIdentity?.();
  assert.ok(who !== undefined, "le jeton de la sécurité produit son identité");
  return who;
}

describe("Identité d'admission — produite par la sécurité, jamais par l'application", () => {
  it("session : `id` = identifiant IMMUABLE du compte, jamais le login ; aucun émetteur ; compte local", async () => {
    const user = makeUser();
    const who = await admissionOf(new UserToken("session").promote(user), user);
    assert.equal(who.id, "acc-42");
    assert.notEqual(who.id, who.userIdentifier);
    assert.equal(who.userIdentifier, "alice@example.test");
    assert.equal(who.type, "session");
    assert.equal(who.authenticated, true);
    assert.equal(who.issuer, null);
    assert.equal(who.account, true);
  });

  it("JWT de l'application : émetteur VÉRIFIÉ repris de l'attribut posé par l'authentificateur", async () => {
    const user = makeUser();
    const issued = new UserToken("jwt").promote(user);
    issued.setAttribute("issuer", "https://app.example.test");
    const who = await admissionOf(issued, user);
    assert.equal(who.issuer, "https://app.example.test");
    assert.equal(who.account, true);
    assert.equal(who.type, "jwt");
  });

  it("émetteur vide ou non textuel → `null`, jamais une chaîne inventée", async () => {
    for (const value of ["", 42, { iss: "x" }]) {
      const user = makeUser();
      const issued = new UserToken("jwt").promote(user);
      issued.setAttribute("issuer", value);
      const who = await admissionOf(issued, user);
      assert.equal(who.issuer, null, `issuer ${JSON.stringify(value)}`);
    }
  });
});

describe("UserRealtimeToken.getIdentity — construite une fois, gelée, isolée", () => {
  it("rend la MÊME référence à chaque appel (le welcome et l'admission ne recopient rien)", () => {
    const token = new UserRealtimeToken(makeUser());
    assert.equal(token.getIdentity(), token.getIdentity());
  });

  it("gelée en profondeur : une règle `allow` ne peut pas s'ajouter un rôle", () => {
    const who = new UserRealtimeToken(makeUser()).getIdentity();
    assert.ok(Object.isFrozen(who));
    assert.ok(Object.isFrozen(who.roles));
    assert.ok(Object.isFrozen(who.scopes));
    assert.throws(() => {
      Reflect.apply(Array.prototype.push, who.roles, ["ROLE_ADMIN"]);
    }, TypeError);
  });

  it("rôles ISOLÉS de l'utilisateur : le muter après coup ne change pas l'identité gelée", () => {
    const user = makeUser();
    const who = new UserRealtimeToken(user).getIdentity();
    assert.notEqual(who.roles, user.roles);
    user.roles.push("ROLE_ADMIN");
    assert.deepEqual([...who.roles], ["ROLE_USER"]);
  });

  it("scopes mutables du jeton d'origine → copiés et gelés ; scopes déjà gelés → repris tels quels", () => {
    const mutable = ["orders:read"];
    const whoA = new UserRealtimeToken(
      makeUser(),
      null,
      "jwt",
      mutable,
    ).getIdentity();
    assert.notEqual(whoA.scopes, mutable);
    mutable.push("orders:write");
    assert.deepEqual([...whoA.scopes], ["orders:read"]);

    const frozen = Object.freeze(["orders:read"]);
    const whoB = new UserRealtimeToken(
      makeUser(),
      null,
      "jwt",
      frozen,
    ).getIdentity();
    assert.equal(whoB.scopes, frozen);
  });

  it("sans source d'admission : une session — aucun émetteur, compte local", () => {
    const who = new UserRealtimeToken(makeUser()).getIdentity();
    assert.equal(who.issuer, null);
    assert.equal(who.account, true);
  });

  it("`getRoles()` garde sa copie défensive : l'identité ne change pas le contrat existant", () => {
    const token = new UserRealtimeToken(makeUser());
    token.getIdentity();
    assert.notEqual(token.getRoles(), token.getRoles());
  });
});
