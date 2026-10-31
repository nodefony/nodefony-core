/// <reference types="node" />
import { describe, it, expect } from "vitest";
import type { ISubscriberIdentity } from "nodefony";
import { welcomeIdentityOf } from "../../src/server/welcomeIdentity";
import {
  ANONYMOUS_REALTIME_TOKEN,
  ANONYMOUS_SUBSCRIBER_IDENTITY,
} from "../../src/server/AnonymousRealtimeToken";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

const who: ISubscriberIdentity = Object.freeze({
  type: "jwt",
  authenticated: true,
  id: "acc-1",
  userIdentifier: "alice@example.test",
  roles: Object.freeze(["ROLE_USER"]),
  scopes: Object.freeze(["chat:write"]),
  issuer: "https://sso.example.test",
  account: true,
});

function decor(identity: ISubscriberIdentity | null): {
  token: IRealtimeToken;
  rolesCalls: () => number;
} {
  let rolesCalls = 0;
  const token: IRealtimeToken = {
    type: "jwt",
    getUserIdentifier: () => "alice@example.test",
    isAuthenticated: () => true,
    getRoles: () => {
      rolesCalls += 1;
      return ["ROLE_USER"];
    },
    getScopes: () => ["chat:write"],
    getAttribute: () => undefined,
    ...(identity === null ? {} : { getIdentity: () => identity }),
  };
  return { token, rolesCalls: () => rolesCalls };
}

function tokenWith(identity: ISubscriberIdentity | null): IRealtimeToken {
  return decor(identity).token;
}

describe("welcomeIdentityOf — vue PUBLIQUE de l'identité annoncée au client", () => {
  it("tirée de l'identité d'admission : même `id`, et la partie SERVEUR ne part jamais", () => {
    const view = welcomeIdentityOf(tokenWith(who));
    expect(view).to.deep.equal({
      type: "jwt",
      authenticated: true,
      id: "acc-1",
      userIdentifier: "alice@example.test",
      roles: ["ROLE_USER"],
      scopes: ["chat:write"],
    });
    // Ce que JSON.stringify enverrait au client : ni émetteur, ni compte.
    const wire: unknown = JSON.parse(JSON.stringify(view));
    expect(wire).to.not.have.property("issuer");
    expect(wire).to.not.have.property("account");
  });

  it("un objet NEUF, jamais l'identité d'admission elle-même (sinon `issuer` partirait)", () => {
    expect(welcomeIdentityOf(tokenWith(who))).to.not.equal(who);
  });

  it("rôles et scopes repris par RÉFÉRENCE (gelés une fois, jamais recopiés)", () => {
    const { token, rolesCalls } = decor(who);
    const view = welcomeIdentityOf(token);
    expect(view.roles).to.equal(who.roles);
    expect(view.scopes).to.equal(who.scopes);
    // La voie qui recopie (`getRoles()`) n'est pas empruntée.
    expect(rolesCalls()).to.equal(0);
  });

  it("jeton sans `getIdentity` (authentificateur tiers) → `id: null`, jamais déduit du login", () => {
    const view = welcomeIdentityOf(tokenWith(null));
    expect(view.id).to.equal(null);
    expect(view.userIdentifier).to.equal("alice@example.test");
    expect(view.authenticated).to.equal(true);
  });
});

describe("ANONYMOUS_SUBSCRIBER_IDENTITY — l'identité d'admission de l'anonyme", () => {
  it("porte l'invariant : anonyme ⇔ authenticated=false ∧ id=null ∧ issuer=null", () => {
    expect(ANONYMOUS_SUBSCRIBER_IDENTITY.authenticated).to.equal(false);
    expect(ANONYMOUS_SUBSCRIBER_IDENTITY.id).to.equal(null);
    expect(ANONYMOUS_SUBSCRIBER_IDENTITY.issuer).to.equal(null);
    expect(ANONYMOUS_SUBSCRIBER_IDENTITY.account).to.equal(false);
  });

  it("gelée en profondeur : une règle `allow` ne peut pas s'ajouter un rôle", () => {
    expect(Object.isFrozen(ANONYMOUS_SUBSCRIBER_IDENTITY)).to.equal(true);
    expect(Object.isFrozen(ANONYMOUS_SUBSCRIBER_IDENTITY.roles)).to.equal(true);
    expect(Object.isFrozen(ANONYMOUS_SUBSCRIBER_IDENTITY.scopes)).to.equal(
      true,
    );
  });

  it("le jeton anonyme rend TOUJOURS la même référence (0 allocation par connexion)", () => {
    const getIdentity = ANONYMOUS_REALTIME_TOKEN.getIdentity;
    expect(getIdentity).to.be.a("function");
    expect(ANONYMOUS_REALTIME_TOKEN.getIdentity?.()).to.equal(
      ANONYMOUS_SUBSCRIBER_IDENTITY,
    );
    expect(ANONYMOUS_REALTIME_TOKEN.getIdentity?.()).to.equal(
      ANONYMOUS_REALTIME_TOKEN.getIdentity?.(),
    );
  });

  it("welcome de l'anonyme : la vue publique concorde avec le jeton (mêmes rôles)", () => {
    expect(welcomeIdentityOf(ANONYMOUS_REALTIME_TOKEN)).to.deep.equal({
      type: "anonymous",
      authenticated: false,
      id: null,
      userIdentifier: "anonymous",
      roles: ANONYMOUS_REALTIME_TOKEN.getRoles(),
      scopes: ANONYMOUS_REALTIME_TOKEN.getScopes(),
    });
  });
});
