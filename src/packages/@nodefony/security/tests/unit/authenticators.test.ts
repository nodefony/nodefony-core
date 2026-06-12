import assert from "node:assert/strict";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import { AnonymousAuthenticator } from "../../nodefony/src/authenticator/AnonymousAuthenticator";
import { UserPasswordAuthenticator } from "../../nodefony/src/authenticator/UserPasswordAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";

/**
 * Authenticators socle (J1) — gates normatives :
 * - RFC 7617 (Basic) : scheme case-insensitive, charset UTF-8, split au PREMIER `:`.
 * - Anti-énumération : message 401 UNIFORME quelle que soit la cause.
 * - Anti-fuite : credential EFFACÉ du token au succès.
 */

const fakeUser = (
  identifier: string,
  roles: string[] = ["ROLE_USER"],
): IUser => ({
  id: "00000000-0000-4000-8000-000000000001",
  identifier,
  roles,
  hasRole: (r: string) => roles.includes(r),
  isActive: () => true,
  isLocked: () => false,
});

const httpContext = (authorization?: string): ContextType =>
  ({
    request: {
      headers: authorization ? { authorization } : {},
      url: new URL("https://localhost/api/secure"),
    },
  }) as unknown as ContextType;

const basic = (identifier: string, password: string): string =>
  `Basic ${Buffer.from(`${identifier}:${password}`, "utf8").toString("base64")}`;

describe("AnonymousAuthenticator", () => {
  const auth = new AnonymousAuthenticator();

  it("supporte toute requête et produit un token anonyme (succès sans vérification)", async () => {
    assert.equal(auth.name, "anonymous");
    assert.equal(auth.supports(), true);
    const token = await auth.authenticate(await auth.createToken());
    assert.equal(token.type, "anonymous");
    assert.equal(token.isAuthenticated(), false);
    assert.equal(token.getUser().identifier, "anon.");
  });
});

describe("UserToken — cycle deux états", () => {
  it("non authentifié à la création : porte le credential, rend l'anonyme", () => {
    const token = new UserToken("userpassword", {
      identifier: "a",
      password: "b",
    });
    assert.equal(token.isAuthenticated(), false);
    assert.deepEqual(token.getCredentials(), {
      identifier: "a",
      password: "b",
    });
    assert.equal(token.getUser().identifier, "anon.");
  });

  it("promote() pose l'utilisateur et EFFACE le credential (anti-fuite)", () => {
    const token = new UserToken("userpassword", {
      identifier: "a",
      password: "b",
    });
    token.promote(fakeUser("alice"));
    assert.equal(token.isAuthenticated(), true);
    assert.equal(token.getUser().identifier, "alice");
    assert.equal(token.getCredentials(), null);
    assert.deepEqual(token.getRoles(), ["ROLE_USER"]);
  });

  it("attributs lazy + scopes par attribut", () => {
    const token = new UserToken("userpassword", null);
    assert.deepEqual(token.getScopes(), []);
    token.setAttribute("scopes", ["repo:read"]);
    assert.deepEqual(token.getScopes(), ["repo:read"]);
    assert.equal(token.getAttribute<string[]>("scopes")?.[0], "repo:read");
  });
});

describe("UserPasswordAuthenticator — HTTP Basic (RFC 7617)", () => {
  const verifier = {
    calls: [] as Array<[string, string]>,
    async authenticate(
      identifier: string,
      plain: string,
    ): Promise<IUser | null> {
      this.calls.push([identifier, plain]);
      return identifier === "admin" && plain === "secret"
        ? fakeUser("admin", ["ROLE_ADMIN"])
        : null;
    },
  };
  const auth = new UserPasswordAuthenticator(() => verifier);

  beforeEach(() => {
    verifier.calls = [];
  });

  it("supports : en-tête Basic présent (scheme case-insensitive RFC 7235)", () => {
    assert.equal(auth.supports(httpContext()), false);
    assert.equal(auth.supports(httpContext("Bearer xyz")), false);
    assert.equal(auth.supports(httpContext(basic("a", "b"))), true);
    assert.equal(
      auth.supports(httpContext(basic("a", "b").replace("Basic", "basic"))),
      true,
    );
  });

  it("authentifie un credential valide : token promu, credential effacé", async () => {
    const ctx = httpContext(basic("admin", "secret"));
    const token = await auth.authenticate(await auth.createToken(ctx));
    assert.equal(token.isAuthenticated(), true);
    assert.equal(token.getUser().identifier, "admin");
    assert.equal(token.getCredentials(), null);
    assert.deepEqual(verifier.calls, [["admin", "secret"]]);
  });

  it("split au PREMIER `:` — le mot de passe peut contenir des `:`", async () => {
    const ctx = httpContext(basic("admin", "se:cr:et"));
    await assert.rejects(
      async () => auth.authenticate(await auth.createToken(ctx)),
      AuthenticationError,
    );
    assert.deepEqual(verifier.calls, [["admin", "se:cr:et"]]);
  });

  it("UTF-8 (RFC 7617 charset) : identifiant accentué transmis intact", async () => {
    const ctx = httpContext(basic("rené", "secret"));
    await assert.rejects(async () =>
      auth.authenticate(await auth.createToken(ctx)),
    );
    assert.deepEqual(verifier.calls, [["rené", "secret"]]);
  });

  it("anti-énumération : message 401 UNIFORME (inconnu = mauvais mot de passe)", async () => {
    const reject = async (header: string) => {
      try {
        await auth.authenticate(await auth.createToken(httpContext(header)));
        assert.fail("aurait dû rejeter");
      } catch (e) {
        assert.ok(e instanceof AuthenticationError);
        assert.equal((e as AuthenticationError).code, 401);
        return (e as Error).message;
      }
    };
    const unknownUser = await reject(basic("ghost", "whatever"));
    const badPassword = await reject(basic("admin", "wrong"));
    assert.equal(unknownUser, badPassword);
  });

  it("enveloppe malformée (base64 pourri, `:` absent) : 401 SANS appeler le verifier", async () => {
    for (const header of [
      "Basic !!!",
      "Basic ",
      `Basic ${Buffer.from("nocolon").toString("base64")}`,
    ]) {
      await assert.rejects(
        async () =>
          auth.authenticate(await auth.createToken(httpContext(header))),
        AuthenticationError,
      );
    }
    assert.deepEqual(verifier.calls, []);
  });

  it("challenge RFC 7235 : Basic + realm + charset", () => {
    assert.equal(auth.challenge(), 'Basic realm="nodefony", charset="UTF-8"');
  });

  it("résolution lazy du verifier : aucun appel avant le premier login", async () => {
    let resolved = 0;
    const lazy = new UserPasswordAuthenticator(() => {
      resolved += 1;
      return verifier;
    });
    assert.equal(resolved, 0);
    const ctx = httpContext(basic("admin", "secret"));
    await lazy.authenticate(await lazy.createToken(ctx));
    await lazy.authenticate(await lazy.createToken(ctx));
    assert.equal(resolved, 1); // résolu UNE fois puis caché
  });
});
