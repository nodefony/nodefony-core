import assert from "node:assert/strict";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType, ISecurityTrace } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { AnonymousAuthenticator } from "../../nodefony/src/authenticator/AnonymousAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { IAuthenticator } from "../../nodefony/contracts/IAuthenticator";
import type { IToken } from "../../nodefony/contracts/IToken";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineModuleConfig";

/**
 * **Radiographie du firewall** (`context.securityTrace`) — la matière que Studio
 * affiche pour expliquer une traversée de zone.
 *
 * Le chemin de succès n'émet AUCUN événement d'audit (délibéré : le volume
 * nominal n'est pas un signal de sécurité) → sans cette trace, une requête qui
 * PASSE ne laisse aucune empreinte de sa zone ni de son authenticator. La trace
 * comble ce trou **en dev seulement**.
 *
 * Les deux sens sont prouvés ici :
 *  - `profiling: true`  → la trace dit qui a résolu l'identité, ou pourquoi le refus ;
 *  - `profiling: false` (= la production) → **aucune allocation**, jamais.
 */

const fakeUser = (
  identifier: string,
  roles: string[] = ["ROLE_USER"],
): IUser => ({
  id: "00000000-0000-4000-8000-000000000042",
  identifier,
  roles,
  hasRole: () => true,
  isActive: () => true,
  isLocked: () => false,
});

/** Authenticator minimal piloté (supporte ? réussit ?). */
class StubAuthenticator implements IAuthenticator {
  constructor(
    readonly name: string,
    private readonly behavior: { supports: boolean; ok: boolean; user?: IUser },
  ) {}
  supports(): boolean {
    return this.behavior.supports;
  }
  createToken(): Promise<IToken> {
    return Promise.resolve(new UserToken(this.name, { raw: "credential" }));
  }
  authenticate(token: IToken): Promise<IToken> {
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
    return Promise.resolve();
  }
  challenge(): string {
    return "";
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

/** Context-like — `profiling` est le témoin posé par le HttpKernel (dev only). */
function makeContext(
  securityArea: SecuredArea,
  opts: { profiling: boolean; bypass?: boolean } = { profiling: true },
): ContextType & { securityTrace: ISecurityTrace | null; profiling: boolean } {
  return {
    request: { headers: {}, url: new URL("https://localhost/secure/x") },
    security: securityArea,
    profiling: opts.profiling,
    securityTrace: null,
    ...(opts.bypass ? { resolver: { bypassFirewall: true } } : {}),
    response: { setHeader: () => undefined },
  } as unknown as ContextType & {
    securityTrace: ISecurityTrace | null;
    profiling: boolean;
  };
}

describe("Firewall — radiographie (securityTrace)", () => {
  it("nomme l'authenticator qui a RÉELLEMENT résolu l'identité (+ ses rôles)", async () => {
    // La zone accepte 2 maillons ; c'est `session` qui reconnaît la requête.
    const jwt = new StubAuthenticator("jwt", { supports: false, ok: true });
    const session = new StubAuthenticator("session", {
      supports: true,
      ok: true,
      user: fakeUser("alice", ["ROLE_NODEFONY_ADMIN"]),
    });
    const firewall = makeFirewall(jwt, session);
    const context = makeContext(area({ authenticators: ["jwt", "session"] }));

    await RequestContext.run({ requestId: "t-granted" }, async () => {
      await firewall.handleSecurity(context);
    });

    const trace = context.securityTrace!;
    assert.equal(trace.outcome, "granted");
    assert.equal(trace.authenticator, "session"); // pas `jwt` : il ne supportait pas
    assert.deepEqual(trace.roles, ["ROLE_NODEFONY_ADMIN"]);
    assert.equal(trace.reason, null);
    // L'identité vit dans l'ALS (pas sur `context.user`), illisible au teardown
    // où le Profiler collecte → sans ce champ, une requête authentifiée
    // s'afficherait « anonyme » tout en portant des rôles.
    assert.equal(trace.user, "alice");
  });

  it("un refus Zero Trust porte son MOTIF (le 401 dit pourquoi)", async () => {
    const jwt = new StubAuthenticator("jwt", { supports: false, ok: true });
    const firewall = makeFirewall(jwt);
    const context = makeContext(area({ authenticators: ["jwt"] }));

    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );

    const trace = context.securityTrace!;
    assert.equal(trace.outcome, "denied");
    assert.equal(trace.reason, "no_credentials"); // aucune preuve présentée
    assert.equal(trace.authenticator, null);
  });

  it("un credential PRÉSENTÉ mais invalide se distingue d'une absence de preuve", async () => {
    const bad = new StubAuthenticator("session", { supports: true, ok: false });
    const firewall = makeFirewall(bad);
    const context = makeContext(area({ authenticators: ["session"] }));

    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );

    const trace = context.securityTrace!;
    assert.equal(trace.outcome, "failure"); // ≠ "denied" : une preuve a échoué
    assert.equal(trace.reason, "invalid_credentials");
  });

  it("l'anonyme EXPLICITE est tracé comme tel (accepté, pas refusé)", async () => {
    const firewall = makeFirewall(new AnonymousAuthenticator());
    const context = makeContext(area({ authenticators: ["anonymous"] }));

    await RequestContext.run({ requestId: "t-anon" }, async () => {
      await firewall.handleSecurity(context);
    });

    const trace = context.securityTrace!;
    assert.equal(trace.outcome, "anonymous");
    assert.equal(trace.authenticator, "anonymous");
  });

  it("une route exemptée (bypassFirewall) est tracée `bypass`, pas `granted`", async () => {
    const session = new StubAuthenticator("session", {
      supports: true,
      ok: true,
    });
    const firewall = makeFirewall(session);
    const context = makeContext(area({ authenticators: ["session"] }), {
      profiling: true,
      bypass: true,
    });

    await firewall.handleSecurity(context);

    // Traversée SANS authentification : ne jamais la lire comme une identité.
    assert.equal(context.securityTrace!.outcome, "bypass");
    assert.equal(context.securityTrace!.authenticator, null);
  });

  it("PROD (profiling=false) : ZÉRO allocation — la trace reste null", async () => {
    const session = new StubAuthenticator("session", {
      supports: true,
      ok: true,
    });
    const firewall = makeFirewall(session);
    // Le HttpKernel ne pose `profiling` que si le Profiler dev est actif.
    const context = makeContext(area({ authenticators: ["session"] }), {
      profiling: false,
    });

    await RequestContext.run({ requestId: "t-prod" }, async () => {
      await firewall.handleSecurity(context); // succès nominal
    });

    assert.equal(
      context.securityTrace,
      null,
      "le hot-path de production ne doit rien allouer",
    );
  });

  it("PROD : un refus non plus n'alloue rien", async () => {
    const jwt = new StubAuthenticator("jwt", { supports: false, ok: true });
    const firewall = makeFirewall(jwt);
    const context = makeContext(area({ authenticators: ["jwt"] }), {
      profiling: false,
    });

    await assert.rejects(
      () => firewall.handleSecurity(context),
      AuthenticationError,
    );

    assert.equal(context.securityTrace, null);
  });
});
