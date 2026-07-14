import assert from "node:assert/strict";
import {
  BaseUser,
  UserService,
  UserNotFoundError,
  type IUserRepository,
  type IPasswordAuthenticatedUser,
  type IPasswordEncoder,
  type ISocialProvider,
  type IOAuthProfile,
} from "../../index";

/**
 * UserService en tant qu'IOAuthUserProvisioner — provisioning Shadow User OAuth
 * Just-In-Time. Distinct de `loadUserByOAuth` (qui LIT) : le provisioner CRÉE la
 * ligne locale au premier login externe.
 *
 * Invariants de sécurité prouvés : `password: null` (compte 100 % OAuth), rôles =
 * politique de l'appelant à la création, lien social persisté, fail-closed si
 * `allowSignup` est faux, et **zéro liaison automatique** à un compte local par
 * email (anti account-takeover OWASP).
 */

// Encodeur stub — le provisioning ne touche jamais au credential local.
const encoder: IPasswordEncoder = {
  supports: (hash) => hash.startsWith("hashed:"),
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: () => Promise.resolve(true),
  needsRehash: () => false,
};

function makeService(repo: Partial<IUserRepository>): UserService {
  return new UserService(repo as IUserRepository, encoder);
}

// Lit les liens sociaux du payload de création (champ d'entité hors contrat credential).
function linksOf(data: Partial<IPasswordAuthenticatedUser>): ISocialProvider[] {
  return (
    (data as { socialProviders?: ISocialProvider[] }).socialProviders ?? []
  );
}

const googleProfile: IOAuthProfile = {
  provider: "google",
  providerId: "g-108",
  email: "bob@gmail.com",
  emailVerified: true,
  name: "Bob",
  raw: {},
};

describe("UserService — IOAuthUserProvisioner (Shadow User JIT)", () => {
  it("login existant : rend l'utilisateur lié sans rien créer", async () => {
    const linked = new BaseUser({
      id: "11111111-1111-4111-8111-111111111111",
      identifier: "bob@gmail.com",
      roles: ["ROLE_USER"],
      password: null,
    });
    let createCalled = false;
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(linked),
      create: () => {
        createCalled = true;
        return Promise.resolve(linked);
      },
    });
    const user = await svc.provisionOAuthUser(googleProfile, {
      defaultRoles: ["ROLE_USER"],
      allowSignup: true,
    });
    assert.equal(user, linked);
    assert.equal(createCalled, false);
  });

  it("JIT : crée un Shadow User (password null, rôles défaut, lien social) au 1er login", async () => {
    // Porteur tableau plutôt qu'un `let x = null` : l'assignation se fait dans une
    // closure, invisible de l'analyse de flux TS (le `let` resterait figé à `null`).
    // Bonus : il enregistre aussi le NOMBRE d'appels à `create`.
    const created: Partial<IPasswordAuthenticatedUser>[] = [];
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(null),
      create: (data: Partial<IPasswordAuthenticatedUser>) => {
        created.push(data);
        return Promise.resolve(
          new BaseUser({
            id: "22222222-2222-4222-8222-222222222222",
            identifier: data.identifier as string,
            roles: (data.roles ?? []) as string[],
            password: null,
            socialProviders: linksOf(data),
          }),
        );
      },
    });
    const user = await svc.provisionOAuthUser(googleProfile, {
      defaultRoles: ["ROLE_USER"],
      allowSignup: true,
    });
    assert.equal(user.identifier, "bob@gmail.com");
    assert.deepEqual([...user.roles], ["ROLE_USER"]);
    assert.equal(created.length, 1);
    const payload = created[0];
    assert.equal(payload.password, null);
    const links = linksOf(payload);
    assert.equal(links.length, 1);
    assert.equal(links[0].provider, "google");
    assert.equal(links[0].providerId, "g-108");
    assert.ok(links[0].createdAt instanceof Date);
  });

  it("email absent : l'identifiant dérive du compte externe (provider:id)", async () => {
    let created: Partial<IPasswordAuthenticatedUser> | null = null;
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(null),
      create: (data: Partial<IPasswordAuthenticatedUser>) => {
        created = data;
        return Promise.resolve(
          new BaseUser({
            id: "33333333-3333-4333-8333-333333333333",
            identifier: data.identifier as string,
            roles: [],
            password: null,
          }),
        );
      },
    });
    await svc.provisionOAuthUser(
      { ...googleProfile, email: null },
      { defaultRoles: ["ROLE_USER"], allowSignup: true },
    );
    assert.equal(created!.identifier, "google:g-108");
  });

  it("signup interdit + lien inconnu : fail-closed (UserNotFoundError, rien créé)", async () => {
    let createCalled = false;
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(null),
      create: () => {
        createCalled = true;
        return Promise.resolve(
          new BaseUser({ id: "x", identifier: "x", roles: [], password: null }),
        );
      },
    });
    await assert.rejects(
      () =>
        svc.provisionOAuthUser(googleProfile, {
          defaultRoles: ["ROLE_USER"],
          allowSignup: false,
        }),
      UserNotFoundError,
    );
    assert.equal(createCalled, false);
  });

  it("zéro liaison-email auto : un email connu localement ne lie PAS le compte (anti-takeover)", async () => {
    let findByIdentifierCalled = false;
    let created: Partial<IPasswordAuthenticatedUser> | null = null;
    const svc = makeService({
      findBySocialProvider: () => Promise.resolve(null),
      // Un compte local ROLE_ADMIN partage l'email : il NE DOIT PAS être lié.
      findByIdentifier: () => {
        findByIdentifierCalled = true;
        return Promise.resolve(
          new BaseUser({
            id: "victim",
            identifier: "bob@gmail.com",
            roles: ["ROLE_ADMIN"],
            password: "hash",
          }),
        );
      },
      create: (data: Partial<IPasswordAuthenticatedUser>) => {
        created = data;
        return Promise.resolve(
          new BaseUser({
            id: "44444444-4444-4444-8444-444444444444",
            identifier: data.identifier as string,
            roles: (data.roles ?? []) as string[],
            password: null,
          }),
        );
      },
    });
    const user = await svc.provisionOAuthUser(
      { ...googleProfile, emailVerified: true },
      { defaultRoles: ["ROLE_USER"], allowSignup: true },
    );
    // Un NOUVEL utilisateur est créé ; jamais le compte ROLE_ADMIN existant.
    assert.equal(findByIdentifierCalled, false);
    assert.ok(created);
    assert.deepEqual([...user.roles], ["ROLE_USER"]);
    assert.notEqual(user.id, "victim");
  });
});
