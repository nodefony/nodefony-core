import assert from "node:assert/strict";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { AnonymousAuthenticator } from "../../nodefony/src/authenticator/AnonymousAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { IAuthenticator } from "../../nodefony/contracts/IAuthenticator";
import type { IToken } from "../../nodefony/contracts/IToken";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineSecurityConfig";

/**
 * Sémantique de la chaîne d'authenticators (mode `first` | `all`) + Zero Trust
 * + challenge RFC 7235 — testée via le contrat PUBLIC du firewall
 * (`registerAuthenticator` + `handleSecurity`), hors kernel (pas de `#build`).
 */

const fakeUser = (identifier: string): IUser => ({
  id: "00000000-0000-4000-8000-000000000002",
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => true,
  isActive: () => true,
  isLocked: () => false,
});

/** Authenticator espion — comportement piloté, compteurs d'appels. */
class SpyAuthenticator implements IAuthenticator {
  created = 0;
  authenticated = 0;
  failures = 0;
  constructor(
    readonly name: string,
    private readonly behavior: {
      supports: boolean;
      ok: boolean;
      user?: IUser;
      challengeValue?: string;
    },
  ) {}
  supports(): boolean {
    return this.behavior.supports;
  }
  createToken(): Promise<IToken> {
    this.created += 1;
    return Promise.resolve(new UserToken(this.name, { raw: "credential" }));
  }
  authenticate(token: IToken): Promise<IToken> {
    this.authenticated += 1;
    if (!this.behavior.ok) {
      return Promise.reject(new AuthenticationError("Invalid credentials"));
    }
    return Promise.resolve(
      (token as UserToken).promote(this.behavior.user ?? fakeUser(this.name)),
    );
  }
  onSuccess(): Promise<void> {
    return Promise.resolve();
  }
  onFailure(): Promise<void> {
    this.failures += 1;
    return Promise.resolve();
  }
  challenge(): string {
    return this.behavior.challengeValue ?? "";
  }
}

const area = (
  config: Partial<ISecurityAreaConfig> & { authenticators: string[] },
) =>
  new SecuredArea("zone-test", {
    pattern: "^/secure",
    security: true,
    stateless: false,
    mode: "first",
    ...config,
  } as ISecurityAreaConfig);

function makeFirewall(...authenticators: IAuthenticator[]): Firewall {
  const firewall = new Firewall({
    container: new Container(),
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  for (const auth of authenticators) firewall.registerAuthenticator(auth);
  return firewall;
}

function makeContext(securityArea: SecuredArea): {
  context: ContextType;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const context = {
    request: { headers: {}, url: new URL("https://localhost/secure/x") },
    security: securityArea,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType;
  return { context, headers };
}

describe("Firewall — mode first", () => {
  it("le premier qui reconnaît la requête authentifie (les suivants jamais sollicités)", async () => {
    const a = new SpyAuthenticator("a", { supports: false, ok: true });
    const b = new SpyAuthenticator("b", { supports: true, ok: true });
    const c = new SpyAuthenticator("c", { supports: true, ok: true });
    const firewall = makeFirewall(a, b, c);
    const { context } = makeContext(area({ authenticators: ["a", "b", "c"] }));
    await RequestContext.run({ requestId: "t-first" }, async () => {
      await firewall.handleSecurity(context);
      assert.equal((RequestContext.getUser() as IUser).identifier, "b");
    });
    assert.equal(a.created, 0);
    assert.equal(b.authenticated, 1);
    assert.equal(c.created, 0);
  });

  it("credential PRÉSENTÉ mais invalide : 401 immédiat, JAMAIS de fallback silencieux", async () => {
    const bad = new SpyAuthenticator("bad", { supports: true, ok: false });
    const next = new SpyAuthenticator("next", { supports: true, ok: true });
    const firewall = makeFirewall(bad, next);
    const { context } = makeContext(area({ authenticators: ["bad", "next"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
    assert.equal(bad.failures, 1); // hook onFailure du maillon fautif
    assert.equal(next.created, 0); // le suivant n'est PAS tenté
  });

  it("Zero Trust : aucune preuve présentée dans une zone protégée → 401", async () => {
    const a = new SpyAuthenticator("a", { supports: false, ok: true });
    const firewall = makeFirewall(a);
    const { context } = makeContext(area({ authenticators: ["a"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      (e: unknown) =>
        e instanceof AuthenticationError &&
        (e as AuthenticationError).code === 401,
    );
  });

  it("anonymat EXPLICITE : `anonymous` en fin de chaîne accepte le visiteur (ALS = anonyme)", async () => {
    const jwtLike = new SpyAuthenticator("jwtlike", {
      supports: false,
      ok: true,
    });
    const firewall = makeFirewall(jwtLike, new AnonymousAuthenticator());
    const { context } = makeContext(
      area({ authenticators: ["jwtlike", "anonymous"] }),
    );
    await RequestContext.run({ requestId: "t-anon" }, async () => {
      await firewall.handleSecurity(context); // ne throw PAS
      assert.equal((RequestContext.getUser() as IUser).identifier, "anon.");
    });
  });

  it("défense en profondeur : token NON promu hors anonymous → 401", async () => {
    const buggy: IAuthenticator = {
      name: "buggy",
      supports: () => true,
      createToken: () => Promise.resolve(new UserToken("buggy", null)),
      authenticate: (t) => Promise.resolve(t), // oublie promote()
      onSuccess: () => Promise.resolve(),
      onFailure: () => Promise.resolve(),
    };
    const firewall = makeFirewall(buggy);
    const { context } = makeContext(area({ authenticators: ["buggy"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
  });

  it("authenticator non enregistré (filet runtime) : fail-closed 401", async () => {
    const firewall = makeFirewall();
    const { context } = makeContext(area({ authenticators: ["ghost"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
  });

  it("erreur INTERNE du maillon (≠ AuthenticationError) : wrappée 401 générique, rien ne fuite", async () => {
    const broken: IAuthenticator = {
      name: "broken",
      supports: () => true,
      createToken: () => Promise.resolve(new UserToken("broken", null)),
      authenticate: () => Promise.reject(new Error("ECONNREFUSED db://users")),
      onSuccess: () => Promise.resolve(),
      onFailure: () => Promise.resolve(),
    };
    const firewall = makeFirewall(broken);
    const { context } = makeContext(area({ authenticators: ["broken"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      (e: unknown) =>
        e instanceof AuthenticationError &&
        !(e as Error).message.includes("ECONNREFUSED"),
    );
  });
});

describe("Firewall — mode all (MFA)", () => {
  it("tous passent : chaque maillon vérifié, le DERNIER porte l'identité", async () => {
    const first = new SpyAuthenticator("mtls-like", {
      supports: true,
      ok: true,
      user: fakeUser("channel"),
    });
    const last = new SpyAuthenticator("jwt-like", {
      supports: true,
      ok: true,
      user: fakeUser("alice"),
    });
    const firewall = makeFirewall(first, last);
    const { context } = makeContext(
      area({ mode: "all", authenticators: ["mtls-like", "jwt-like"] }),
    );
    await RequestContext.run({ requestId: "t-all" }, async () => {
      await firewall.handleSecurity(context);
      assert.equal((RequestContext.getUser() as IUser).identifier, "alice");
    });
    assert.equal(first.authenticated, 1);
    assert.equal(last.authenticated, 1);
  });

  it("une preuve MANQUANTE (supports false) → 401", async () => {
    const present = new SpyAuthenticator("present", {
      supports: true,
      ok: true,
    });
    const missing = new SpyAuthenticator("missing", {
      supports: false,
      ok: true,
    });
    const firewall = makeFirewall(present, missing);
    const { context } = makeContext(
      area({ mode: "all", authenticators: ["present", "missing"] }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
  });

  it("un maillon échoue → 401 (les suivants jamais sollicités)", async () => {
    const bad = new SpyAuthenticator("bad", { supports: true, ok: false });
    const after = new SpyAuthenticator("after", { supports: true, ok: true });
    const firewall = makeFirewall(bad, after);
    const { context } = makeContext(
      area({ mode: "all", authenticators: ["bad", "after"] }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
    assert.equal(after.created, 0);
  });
});

describe("Firewall — challenge RFC 7235 + zones publiques", () => {
  it("tout 401 porte le WWW-Authenticate du premier authenticator à challenge", async () => {
    const silent = new SpyAuthenticator("silent", {
      supports: false,
      ok: true,
    });
    const withChallenge = new SpyAuthenticator("basiclike", {
      supports: false,
      ok: true,
      challengeValue: 'Basic realm="nodefony", charset="UTF-8"',
    });
    const firewall = makeFirewall(silent, withChallenge);
    const { context, headers } = makeContext(
      area({ authenticators: ["silent", "basiclike"] }),
    );
    await assert.rejects(() => firewall.handleSecurity(context));
    assert.equal(
      headers["WWW-Authenticate"],
      'Basic realm="nodefony", charset="UTF-8"',
    );
  });

  it("zone publique explicite (security: false) : aucun authenticator sollicité", async () => {
    const spy = new SpyAuthenticator("spy", { supports: true, ok: true });
    const firewall = makeFirewall(spy);
    const { context } = makeContext(
      area({ security: false, authenticators: ["spy"] }),
    );
    await firewall.handleSecurity(context);
    assert.equal(spy.created, 0);
  });

  it("hors zone (context.security null) : passe sans rien faire", async () => {
    const firewall = makeFirewall();
    const context = {
      request: { headers: {}, url: new URL("https://localhost/public") },
      security: null,
    } as unknown as ContextType;
    await firewall.handleSecurity(context); // ne throw pas
  });
});

describe("Firewall — bypassFirewall (route = mécanisme d'auth)", () => {
  // Une route en bypass (login/logout/me du flux BFF) court-circuite TOUTE la
  // chaîne, MÊME en zone protégée : sinon le login dans l'aire data plane
  // exigerait d'être déjà loggé (deadlock). Le contrôle négatif (2ᵉ test, même
  // zone SANS bypass → 401) prouve que c'est BIEN le bypass qui change le verdict.
  it("zone protégée + resolver.bypassFirewall : aucun authenticator sollicité, pas de 401", async () => {
    const spy = new SpyAuthenticator("spy", { supports: true, ok: false });
    const firewall = makeFirewall(spy);
    const { context } = makeContext(area({ authenticators: ["spy"] }));
    (context as { resolver?: { bypassFirewall?: boolean } }).resolver = {
      bypassFirewall: true,
    };
    await firewall.handleSecurity(context); // ne throw pas malgré spy.ok=false
    assert.equal(spy.created, 0); // chaîne jamais exécutée
  });

  it("contrôle négatif : même zone SANS bypass → 401 (preuve invalide)", async () => {
    const spy = new SpyAuthenticator("spy", { supports: true, ok: false });
    const firewall = makeFirewall(spy);
    const { context } = makeContext(area({ authenticators: ["spy"] }));
    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );
  });
});
