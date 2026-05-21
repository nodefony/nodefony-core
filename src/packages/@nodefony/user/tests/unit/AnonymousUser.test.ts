/// <reference types="node" />
import assert from "node:assert";
import { describe, it } from "mocha";
import {
  AnonymousUser,
  anonymousUser,
  ROLE_ANONYMOUS,
} from "../../nodefony/src/AnonymousUser";

describe("AnonymousUser", () => {
  it("porte ROLE_ANONYMOUS, actif, non verrouillé", () => {
    const u = new AnonymousUser();
    assert.strictEqual(u.id, "anonymous");
    assert.deepStrictEqual(u.roles, [ROLE_ANONYMOUS]);
    assert.strictEqual(u.hasRole(ROLE_ANONYMOUS), true);
    assert.strictEqual(u.hasRole("ROLE_USER"), false);
    assert.strictEqual(u.isActive(), true);
    assert.strictEqual(u.isLocked(), false);
  });

  it("le singleton est gelé (pas de mutation par requête)", () => {
    assert.ok(Object.isFrozen(anonymousUser));
    try {
      // @ts-expect-error mutation interdite sur le singleton gelé
      anonymousUser.identifier = "x";
    } catch {
      /* mode strict : TypeError ; mode sloppy : no-op silencieux */
    }
    assert.strictEqual(anonymousUser.identifier, "anon.");
  });

  it("le tableau de rôles partagé est gelé", () => {
    assert.ok(Object.isFrozen(anonymousUser.roles));
    assert.throws(() => anonymousUser.roles.push("ROLE_HACK"));
  });
});
