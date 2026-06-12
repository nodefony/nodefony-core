import assert from "node:assert/strict";
import {
  BaseUser,
  UserService,
  UserNotFoundError,
  type IUserRepository,
  type IPasswordEncoder,
} from "../../index";

/**
 * UserService en tant qu'IUserProvider — la « source d'identité » consommée par
 * les authenticators de @nodefony/security.
 *
 * Sémantique testée : JAMAIS `null` — l'absence d'identité lève
 * {@link UserNotFoundError} (échec explicite, anti-propagation silencieuse).
 */

// Encodeur stub — les méthodes provider ne touchent pas au credential.
const encoder: IPasswordEncoder = {
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: () => Promise.resolve(true),
  needsRehash: () => false,
};

// Stub repository ciblé : seules les méthodes du contrat provider sont fournies.
function makeService(repo: Partial<IUserRepository>): UserService {
  return new UserService(repo as IUserRepository, encoder);
}

const alice = new BaseUser({
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "alice@exemple.fr",
  roles: ["ROLE_USER"],
  password: null,
});

describe("UserService — IUserProvider (source d'identité)", () => {
  it("loadUserByIdentifier rend l'utilisateur trouvé", async () => {
    const svc = makeService({
      findByIdentifier: () => Promise.resolve(alice),
    });
    assert.equal(await svc.loadUserByIdentifier("alice@exemple.fr"), alice);
  });

  it("loadUserByIdentifier lève UserNotFoundError — jamais null", async () => {
    const svc = makeService({
      findByIdentifier: () => Promise.resolve(null),
    });
    await assert.rejects(
      () => svc.loadUserByIdentifier("ghost@exemple.fr"),
      UserNotFoundError,
    );
  });

  it("loadUserByOAuth rend l'utilisateur lié au compte externe", async () => {
    const calls: Array<[string, string]> = [];
    const svc = makeService({
      findBySocialProvider: (provider: string, providerId: string) => {
        calls.push([provider, providerId]);
        return Promise.resolve(alice);
      },
    });
    assert.equal(await svc.loadUserByOAuth("github", "gh-42"), alice);
    assert.deepEqual(calls, [["github", "gh-42"]]);
  });

  it("loadUserByOAuth lève si le lien social est inconnu (pas de provisionnement ici)", async () => {
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(null),
    });
    await assert.rejects(
      () => svc.loadUserByOAuth("google", "g-404"),
      UserNotFoundError,
    );
  });

  it("refreshUser recharge la version fraîche depuis la source", async () => {
    const fresh = new BaseUser({
      id: alice.id,
      identifier: alice.identifier,
      roles: ["ROLE_USER", "ROLE_ADMIN"], // rôles à jour côté source
      password: null,
    });
    // findById (service) délègue à repository.findOne({ id }).
    const svc = makeService({
      findOne: (criteria: { id?: string }) =>
        Promise.resolve(criteria.id === alice.id ? fresh : null),
    } as Partial<IUserRepository>);
    const reloaded = await svc.refreshUser(alice);
    assert.equal(reloaded, fresh);
    assert.deepEqual(reloaded.roles, ["ROLE_USER", "ROLE_ADMIN"]);
  });

  it("refreshUser lève si le compte a été supprimé", async () => {
    const svc = makeService({
      findOne: () => Promise.resolve(null),
    } as Partial<IUserRepository>);
    await assert.rejects(() => svc.refreshUser(alice), UserNotFoundError);
  });
});
