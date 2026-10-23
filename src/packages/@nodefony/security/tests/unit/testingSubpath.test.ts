import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "../../nodefony/testing/index";
import type { IChannelPolicy } from "../../nodefony/src/realtime/realtimeContracts";

/**
 * `@nodefony/security/testing` — l'identité d'essai et le VRAI verrou de frame.
 *
 * Sans eux, une application éprouvait un canal protégé avec un verrou recopié
 * qui ne regardait que `isAuthenticated()` : la politique de rôles n'était
 * jamais appliquée, et un canal mal protégé restait vert (#654). Ce qui est
 * éprouvé ici : le verrou rendu applique les RÔLES d'une politique déclarée,
 * suit la hiérarchie qu'on lui donne, garde les canaux système, et l'identité
 * rend l'utilisateur qu'attend `@CurrentUser()`.
 */

/** Les politiques que le hub aurait reçues des décorateurs. */
function hubOf(policies: Record<string, IChannelPolicy>) {
  return {
    resolveChannelPolicy: (name: string): IChannelPolicy | null =>
      policies[name] ?? null,
  };
}

const sub = (channel: string) => ({ method: "subscribe", params: { channel } });
const ANONYMOUS = {
  type: "anonymous",
  getUserIdentifier: () => "anonymous",
  isAuthenticated: () => false,
  getRoles: () => ["ROLE_ANONYMOUS"],
  getScopes: () => [],
  getAttribute: () => undefined,
};

describe("createTestFrameAuthorizer — la politique de rôles est APPLIQUÉE", () => {
  const authorize = createTestFrameAuthorizer(
    hubOf({ "chat:private": { roles: ["ROLE_USER"] } }),
  );

  it("canal { roles: [ROLE_USER] } : refusé à l'anonyme", () => {
    assert.equal(authorize(sub("chat:private"), ANONYMOUS), false);
  });

  it("canal { roles: [ROLE_USER] } : refusé à un compte SANS le rôle", () => {
    const guest = createTestIdentity({ roles: ["ROLE_GUEST"] });
    assert.equal(authorize(sub("chat:private"), guest), false);
  });

  it("canal { roles: [ROLE_USER] } : accepté avec le rôle", () => {
    assert.equal(authorize(sub("chat:private"), createTestIdentity()), true);
  });

  it("un canal sans politique reste libre", () => {
    assert.equal(authorize(sub("chat:events"), ANONYMOUS), true);
  });

  it("une action protégée (frame entrante) suit la même politique", () => {
    const frame = { method: "chat:private", params: {} };
    assert.equal(authorize(frame, ANONYMOUS), false);
    assert.equal(authorize(frame, createTestIdentity()), true);
  });

  it("les canaux SYSTÈME restent gardés (plancher du pare-feu)", () => {
    assert.equal(
      authorize(sub("nodefony:syslog"), createTestIdentity()),
      false,
    );
  });
});

describe("createTestFrameAuthorizer — hiérarchie de rôles", () => {
  const policies = hubOf({ "chat:private": { roles: ["ROLE_USER"] } });
  const admin = createTestIdentity({ roles: ["ROLE_ADMIN"] });

  it("sans hiérarchie, ROLE_ADMIN ne couvre pas ROLE_USER", () => {
    const authorize = createTestFrameAuthorizer(policies);
    assert.equal(authorize(sub("chat:private"), admin), false);
  });

  it("avec { ROLE_ADMIN: [ROLE_USER] }, il le couvre", () => {
    const authorize = createTestFrameAuthorizer(policies, {
      roleHierarchy: { ROLE_ADMIN: ["ROLE_USER"] },
    });
    assert.equal(authorize(sub("chat:private"), admin), true);
  });
});

describe("createTestIdentity", () => {
  it("authentifiée, rôle ROLE_USER et utilisateur par défaut", () => {
    const id = createTestIdentity({ identifier: "bob" });
    assert.equal(id.isAuthenticated(), true);
    assert.equal(id.getUserIdentifier(), "bob");
    assert.deepEqual(id.getRoles(), ["ROLE_USER"]);
    assert.deepEqual(id.getAttribute("user"), {
      identifier: "bob",
      roles: ["ROLE_USER"],
    });
  });

  it("les rôles rendus sont une copie : les modifier ne donne aucun droit", () => {
    const id = createTestIdentity();
    id.getRoles().push("ROLE_ADMIN");
    assert.deepEqual(id.getRoles(), ["ROLE_USER"]);
  });
});
