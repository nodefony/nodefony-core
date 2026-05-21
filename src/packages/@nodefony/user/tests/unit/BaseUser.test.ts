/// <reference types="node" />
import assert from "node:assert";
import { describe, it } from "mocha";
import { BaseUser } from "../../nodefony/src/BaseUser";
import type { ISocialProvider } from "../../nodefony/contracts/IUser";

describe("BaseUser", () => {
  const make = () =>
    new BaseUser({ id: "u-1", identifier: "alice@acme.io", roles: ["ROLE_USER"] });

  it("applique les défauts (password null, actif, non verrouillé, collections vides)", () => {
    const u = new BaseUser({ id: "u-1", identifier: "alice@acme.io" });
    assert.strictEqual(u.id, "u-1");
    assert.strictEqual(u.identifier, "alice@acme.io");
    assert.deepStrictEqual(u.roles, []);
    assert.strictEqual(u.password, null);
    assert.strictEqual(u.currentRole, null);
    assert.deepStrictEqual(u.socialProviders, []);
    assert.deepStrictEqual(u.metadata, {});
    assert.strictEqual(u.isActive(), true);
    assert.strictEqual(u.isLocked(), false);
  });

  it("copie défensivement le tableau de rôles fourni", () => {
    const src = ["ROLE_USER"];
    const u = new BaseUser({ id: "u-1", identifier: "a", roles: src });
    src.push("ROLE_ADMIN");
    assert.deepStrictEqual(u.roles, ["ROLE_USER"]);
  });

  it("hasRole = test plat exact (pas de hiérarchie)", () => {
    const u = make();
    assert.strictEqual(u.hasRole("ROLE_USER"), true);
    assert.strictEqual(u.hasRole("ROLE_ADMIN"), false);
  });

  it("addRole / removeRole sont idempotents", () => {
    const u = make();
    u.addRole("ROLE_ADMIN").addRole("ROLE_ADMIN");
    assert.deepStrictEqual(u.roles, ["ROLE_USER", "ROLE_ADMIN"]);
    u.removeRole("ROLE_USER").removeRole("ROLE_USER");
    assert.deepStrictEqual(u.roles, ["ROLE_ADMIN"]);
  });

  it("enable/disable et lock/unlock pilotent isActive/isLocked", () => {
    const u = make();
    assert.strictEqual(u.disable().isActive(), false);
    assert.strictEqual(u.enable().isActive(), true);
    assert.strictEqual(u.lock().isLocked(), true);
    assert.strictEqual(u.unlock().isLocked(), false);
  });

  it("setCurrentRole n'altère pas les rôles plats", () => {
    const u = make();
    u.setCurrentRole("ROLE_TEACHER");
    assert.strictEqual(u.currentRole, "ROLE_TEACHER");
    assert.deepStrictEqual(u.roles, ["ROLE_USER"]);
  });

  it("setPassword remplace le hash", () => {
    const u = make();
    assert.strictEqual(u.password, null);
    u.setPassword("$2b$12$hash");
    assert.strictEqual(u.password, "$2b$12$hash");
  });

  it("addSocialProvider est idempotent sur (provider, providerId)", () => {
    const u = make();
    const link: ISocialProvider = {
      provider: "google",
      providerId: "g-42",
      createdAt: new Date(),
    };
    u.addSocialProvider(link).addSocialProvider({ ...link });
    assert.strictEqual(u.socialProviders.length, 1);
    u.addSocialProvider({ ...link, providerId: "g-99" });
    assert.strictEqual(u.socialProviders.length, 2);
  });
});
