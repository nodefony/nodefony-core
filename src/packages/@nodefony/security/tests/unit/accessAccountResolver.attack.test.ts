import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  Container,
  Event,
  ACCESS_ACCOUNT_RESOLVER,
  ACCESS_TOKEN_VERIFIER,
} from "nodefony";
import type {
  IAccessAccountResolver,
  IAccessPrincipal,
  IAccessTokenVerifier,
  Module,
} from "nodefony";
import type { IUser } from "@nodefony/user";
import * as jose from "jose";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { ScopeVoter } from "../../nodefony/src/voter/ScopeVoter";
import { VoterVote } from "../../nodefony/contracts/IAccessVoter";
import { AccessTokenVerifierService } from "../../nodefony/service/accessTokenVerifier";

/**
 * RED-TEAM — le résolveur de compte d'une ressource protégée (#648) : un outil
 * MCP `actsForUser` s'exécute au nom du compte que le jeton désigne, et ce
 * compte est retrouvé par les MÊMES règles qu'une zone du pare-feu.
 *
 * Matrice écrite avant le code : compte disparu / désactivé / verrouillé entre
 * la vérification et l'appel, jeton émis pour un AUTRE compte du même nom,
 * changement de mot de passe, émetteur tiers sans rattachement, annuaire tiers
 * qui réclame un compte local par son seul `sub`.
 */

const ISSUER = "https://app.test";
const RESOURCE = "https://app.test/api/mcp";
/** Un émetteur TIERS « de confiance » — aucune clé lue : on part du principal. */
const THIRD_PARTY = "https://idp.test/realms/app";

const user = (identifier: string, over: Partial<IUser> = {}): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
  ...over,
});

/** `alice` active, `bob` désactivé, `carol` verrouillée, `dave` a changé de mot de passe. */
const accounts: Record<string, IUser> = {
  alice: user("alice", { roles: ["ROLE_ADMIN"] }),
  bob: user("bob", { isActive: () => false }),
  carol: user("carol", { isLocked: () => true }),
  dave: user("dave", { credentialsVersion: 2 }),
  [`${THIRD_PARTY}#ext-1`]: user(`${THIRD_PARTY}#ext-1`),
  // Un compte LOCAL que le `sub` nu d'un annuaire tiers pourrait réclamer.
  admin: user("admin", { roles: ["ROLE_ADMIN"] }),
};

let lookups: string[];
const users = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
    lookups.push(id);
    const found = accounts[id];
    if (found === undefined) throw new Error("inconnu");
    return found;
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("aucun lien");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

let keystore: JwtKeystore;

beforeEach(() => {
  keystore = new JwtKeystore({}, () => {});
  lookups = [];
});

/** Monte le service sur un conteneur réel, et joue `onBoot`. */
function boot(options: Record<string, unknown>): Container {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  container.set("jwtKeystore", keystore);
  container.set("tokenStore", new MemoryTokenStore());
  container.set("users", users);
  new AccessTokenVerifierService({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  kernel.emit("onBoot");
  return container;
}

const LOCAL_ONLY = { jwt: { issuer: ISSUER, audiences: [ISSUER, RESOURCE] } };
const WITH_THIRD_PARTY = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...LOCAL_ONLY,
  resourceServer: {
    issuers: [{ issuer: THIRD_PARTY, ...over }],
  },
});

function resolverOf(container: Container): IAccessAccountResolver {
  const resolve = container.get<IAccessAccountResolver>(
    ACCESS_ACCOUNT_RESOLVER,
  );
  assert.equal(typeof resolve, "function", "aucun résolveur posé");
  return resolve as IAccessAccountResolver;
}

/** Un principal de jeton MAISON, tel que `verifyForResource` le rend. */
function local(
  subject: string,
  claims: Record<string, unknown> = { uid: `u-${subject}` },
): IAccessPrincipal {
  return {
    issuer: ISSUER,
    subject,
    scopes: ["admin:read"],
    tokenId: "jti-1",
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    claims: { sub: subject, ...claims },
  };
}

describe("contrôle POSITIF — sans lui, « tout refuser » serait vert", () => {
  it("jeton maison → le compte, et un jeton `mcp` qui porte les scopes", async () => {
    const account = await resolverOf(boot(LOCAL_ONLY))(local("alice"));
    assert.ok(account !== null);
    assert.equal(account.user.identifier, "alice");
    const token = account.token as UserToken;
    assert.ok(token instanceof UserToken);
    assert.equal(token.type, "mcp");
    assert.equal(token.isAuthenticated(), true);
    // Rôles = ceux du COMPTE, comme dans une zone `jwt`.
    assert.deepEqual(token.getRoles(), ["ROLE_ADMIN"]);
    assert.deepEqual(token.getScopes(), ["admin:read"]);
    assert.equal(token.getAttribute("jti"), "jti-1");
  });

  it("le jeton `mcp` est SCOPABLE : un scope absent n'ouvre pas `api:action`", async () => {
    const account = await resolverOf(boot(LOCAL_ONLY))(local("alice"));
    const voter = new ScopeVoter();
    const token = account?.token as UserToken;
    assert.equal(await voter.vote(token, "admin:read"), VoterVote.GRANT);
    assert.equal(await voter.vote(token, "admin:write"), VoterVote.ABSTAIN);
  });
});

describe("jeton maison — les règles de la zone `jwt`, rejouées", () => {
  it("compte DÉSACTIVÉ depuis la vérification → null", async () => {
    assert.equal(await resolverOf(boot(LOCAL_ONLY))(local("bob")), null);
  });

  it("compte VERROUILLÉ → null", async () => {
    assert.equal(await resolverOf(boot(LOCAL_ONLY))(local("carol")), null);
  });

  it("sujet INCONNU → null, jamais une exception", async () => {
    assert.equal(await resolverOf(boot(LOCAL_ONLY))(local("zoe")), null);
  });

  it("jeton émis pour un AUTRE compte du même nom (`uid` différent) → null", async () => {
    const resolve = resolverOf(boot(LOCAL_ONLY));
    assert.equal(await resolve(local("alice", { uid: "u-ancienne" })), null);
  });

  it("jeton SANS liaison au compte → null", async () => {
    assert.equal(await resolverOf(boot(LOCAL_ONLY))(local("alice", {})), null);
  });

  it("jeton antérieur à un changement de mot de passe → null", async () => {
    const resolve = resolverOf(boot(LOCAL_ONLY));
    assert.equal(await resolve(local("dave", { uid: "u-dave", cv: 1 })), null);
    assert.notEqual(
      await resolve(local("dave", { uid: "u-dave", cv: 2 })),
      null,
    );
  });

  it("émetteur ni local ni tiers déclaré → null, sans lire l'annuaire", async () => {
    const resolve = resolverOf(boot(LOCAL_ONLY));
    const account = await resolve({
      ...local("alice"),
      issuer: "https://ailleurs.test",
    });
    assert.equal(account, null);
    assert.deepEqual(lookups, []);
  });
});

describe("jeton TIERS — les règles de la zone `external-jwt`, rejouées", () => {
  const external = (subject: string): IAccessPrincipal => ({
    issuer: THIRD_PARTY,
    subject,
    scopes: ["admin:read"],
  });

  it("sujet rattaché par son espace de noms → le compte", async () => {
    const account = await resolverOf(boot(WITH_THIRD_PARTY()))(
      external("ext-1"),
    );
    assert.equal(account?.user.identifier, `${THIRD_PARTY}#ext-1`);
  });

  it("le `sub` nu `admin` d'un annuaire tiers ne réclame PAS le compte local", async () => {
    const account = await resolverOf(boot(WITH_THIRD_PARTY()))(
      external("admin"),
    );
    assert.equal(account, null);
    assert.deepEqual(lookups, [`${THIRD_PARTY}#admin`]);
  });

  it("émetteur INCONNU alors qu'un tiers est déclaré → null, jamais une panne", async () => {
    const account = await resolverOf(boot(WITH_THIRD_PARTY()))({
      ...external("ext-1"),
      issuer: "https://ailleurs.test",
    });
    assert.equal(account, null);
    assert.deepEqual(lookups, []);
  });

  it("sujet sans compte local → null", async () => {
    assert.equal(
      await resolverOf(boot(WITH_THIRD_PARTY()))(external("ext-inconnu")),
      null,
    );
  });

  it("politique `ephemeral` → une identité sans compte, aux rôles déclarés", async () => {
    const container = boot({
      ...WITH_THIRD_PARTY(),
      resourceServer: {
        issuers: [{ issuer: THIRD_PARTY }],
        subjectPolicy: "ephemeral",
        ephemeralRoles: ["ROLE_AGENT"],
      },
    });
    const account = await resolverOf(container)(external("robot"));
    assert.equal(account?.user.identifier, `${THIRD_PARTY}#robot`);
    assert.deepEqual([...(account?.user.roles ?? [])], ["ROLE_AGENT"]);
    assert.deepEqual(lookups, []);
  });
});

describe("posé avec le vérificateur, jamais seul", () => {
  it("capacité JWT coupée et aucun émetteur tiers → ni vérificateur ni résolveur", () => {
    const container = boot({ jwt: { enabled: false } });
    // Le conteneur rend `null` pour un nom absent.
    assert.equal(container.get(ACCESS_TOKEN_VERIFIER) ?? null, null);
    assert.equal(container.get(ACCESS_ACCOUNT_RESOLVER) ?? null, null);
  });

  it("le vérificateur établit, le résolveur retrouve : la boucle entière", async () => {
    const container = boot(LOCAL_ONLY);
    const signing = await keystore.getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({
      iss: ISSUER,
      aud: RESOURCE,
      sub: "alice",
      uid: "u-alice",
      jti: "jti-boucle",
      iat: now,
      exp: now + 900,
      scope: "admin:read",
    })
      .setProtectedHeader({ alg: "EdDSA", kid: signing.kid, typ: "at+jwt" })
      .sign(signing.key);
    const verify = container.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER);
    const principal = await (verify as IAccessTokenVerifier)(token, RESOURCE);
    assert.ok(principal !== null);
    const account = await resolverOf(container)(principal);
    assert.equal(account?.user.identifier, "alice");
  });
});
