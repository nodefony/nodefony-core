import assert from "node:assert/strict";
import {
  InMemoryUserRepository,
  UserService,
  UserNotFoundError,
  PROVIDER_ROLES_KEY,
  readProviderRoles,
  reconcileProviderRoles,
  type IOAuthProfile,
  type IPasswordEncoder,
} from "../../index";

/**
 * Rôles GÉRÉS par un fournisseur d'identité (#519) : ceux que sa table de
 * correspondance accorde suivent l'annuaire à chaque connexion et à chaque
 * jeton ; ceux donnés à la main survivent ; rien n'est écrit quand rien ne
 * change.
 */

const encoder: IPasswordEncoder = {
  supports: () => true,
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: () => Promise.resolve(true),
  needsRehash: () => false,
};

const bob: IOAuthProfile = {
  provider: "keycloak",
  providerId: "kc-bob",
  email: "bob@example.test",
  emailVerified: true,
  name: "Bob",
  raw: {},
};

/** Service + compteur d'écritures (`updateOne`) sur un vrai dépôt mémoire. */
function setup(): { svc: UserService; writes: () => number } {
  const repo = new InMemoryUserRepository();
  let count = 0;
  const original = repo.updateOne.bind(repo);
  repo.updateOne = (criteria, data) => {
    count++;
    return original(criteria, data);
  };
  return { svc: new UserService(repo, encoder), writes: () => count };
}

const policy = (providerRoles?: readonly string[]) => ({
  defaultRoles: ["ROLE_USER"],
  allowSignup: true,
  ...(providerRoles === undefined ? {} : { providerRoles }),
});

function managedOf(user: unknown): string[] {
  return readProviderRoles(
    (user as { metadata?: unknown }).metadata,
    "keycloak",
  );
}

describe("reconcileProviderRoles — calcul pur", () => {
  it("retire ce que le fournisseur gérait, ajoute ce qu'il accorde, garde le local", () => {
    const r = reconcileProviderRoles(
      ["ROLE_USER", "ROLE_ADMIN", "ROLE_LOCAL"],
      ["ROLE_ADMIN"],
      ["ROLE_EDITOR"],
    );
    assert.deepEqual(r.roles, ["ROLE_USER", "ROLE_LOCAL", "ROLE_EDITOR"]);
    assert.equal(r.changed, true);
  });

  it("rien ne change → changed=false (aucune écriture à faire)", () => {
    const r = reconcileProviderRoles(
      ["ROLE_USER", "ROLE_ADMIN"],
      ["ROLE_ADMIN"],
      ["ROLE_ADMIN"],
    );
    assert.equal(r.changed, false);
  });

  it("ensemble effectif identique mais trace différente → changed=true", () => {
    // ROLE_ADMIN donné à la main ET désormais accordé par le fournisseur :
    // `roles` ne bouge pas, mais la trace doit l'enregistrer comme géré.
    const r = reconcileProviderRoles(["ROLE_ADMIN"], [], ["ROLE_ADMIN"]);
    assert.deepEqual(r.roles, ["ROLE_ADMIN"]);
    assert.equal(r.changed, true);
  });
});

describe("UserService — rôles gérés par le fournisseur", () => {
  it("création : rôles par défaut ∪ rôles du fournisseur, trace posée", async () => {
    const { svc } = setup();
    const user = await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    assert.deepEqual([...user.roles].sort(), ["ROLE_ADMIN", "ROLE_USER"]);
    assert.deepEqual(managedOf(user), ["ROLE_ADMIN"]);
  });

  it("rôle retiré dans l'annuaire → disparaît au login suivant", async () => {
    const { svc } = setup();
    await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    const again = await svc.provisionOAuthUser(bob, policy([]));
    assert.deepEqual(again.roles, ["ROLE_USER"]);
    assert.deepEqual(managedOf(again), []);
  });

  it("un rôle donné à la main survit au recalcul", async () => {
    const { svc } = setup();
    const created = await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    await svc.updateOne(
      { id: created.id },
      { roles: [...created.roles, "ROLE_AUDITOR"] },
    );
    const again = await svc.provisionOAuthUser(bob, policy([]));
    assert.deepEqual([...again.roles].sort(), ["ROLE_AUDITOR", "ROLE_USER"]);
  });

  it("le profil d'affichage posé à la création n'est pas écrasé par la trace", async () => {
    const { svc } = setup();
    await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    const again = await svc.provisionOAuthUser(bob, policy(["ROLE_EDITOR"]));
    const metadata = (again as { metadata?: Record<string, unknown> }).metadata;
    assert.ok(metadata?.profile, "metadata.profile conservé");
    assert.deepEqual(managedOf(again), ["ROLE_EDITOR"]);
  });

  it("aucune écriture quand l'ensemble n'a pas changé", async () => {
    const { svc, writes } = setup();
    await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    const before = writes();
    await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    await svc.syncOAuthRoles("keycloak", "kc-bob", ["ROLE_ADMIN"]);
    assert.equal(writes(), before);
  });

  it("sans `providerRoles` : comportement historique, rôles jamais réécrits", async () => {
    const { svc, writes } = setup();
    await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    const before = writes();
    const again = await svc.provisionOAuthUser(bob, policy());
    assert.deepEqual([...again.roles].sort(), ["ROLE_ADMIN", "ROLE_USER"]);
    assert.equal(writes(), before);
  });

  it("syncOAuthRoles : recalcule par la paire (fournisseur, sujet)", async () => {
    const { svc } = setup();
    await svc.provisionOAuthUser(bob, policy([]));
    const synced = await svc.syncOAuthRoles("keycloak", "kc-bob", [
      "ROLE_ADMIN",
    ]);
    assert.deepEqual([...synced.roles].sort(), ["ROLE_ADMIN", "ROLE_USER"]);
  });

  it("syncOAuthRoles : sans compte lié → UserNotFoundError", async () => {
    const { svc } = setup();
    await assert.rejects(
      svc.syncOAuthRoles("keycloak", "inconnu", ["ROLE_ADMIN"]),
      UserNotFoundError,
    );
  });

  it("la trace est rangée sous metadata.providerRoles.<fournisseur>", async () => {
    const { svc } = setup();
    const user = await svc.provisionOAuthUser(bob, policy(["ROLE_ADMIN"]));
    const metadata = (user as unknown as { metadata: Record<string, unknown> })
      .metadata;
    assert.deepEqual(metadata[PROVIDER_ROLES_KEY], {
      keycloak: ["ROLE_ADMIN"],
    });
  });
});
