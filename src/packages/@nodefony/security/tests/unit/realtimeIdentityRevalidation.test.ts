import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ACCESS_TOKEN_VERIFIER, RequestContext } from "nodefony";
import type { Container, IAccessPrincipal } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser } from "@nodefony/user";
import { ExternalJwtAuthenticator } from "../../nodefony/src/authenticator/ExternalJwtAuthenticator";
import { FirewallRealtimeAuthenticator } from "../../nodefony/src/authenticator/FirewallRealtimeAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { ScopeVoter } from "../../nodefony/src/voter/ScopeVoter";
import { VoterVote } from "../../nodefony/contracts/IAccessVoter";
import type { IRealtimeHandshake } from "../../nodefony/src/realtime/realtimeContracts";

/**
 * **Une socket ne survit pas à l'identité qui l'a ouverte — quel que soit le mode
 * d'authentification.**
 *
 * L'invariant est unique, mais la façon de PROUVER qu'une identité est toujours
 * vivante dépend de la manière dont elle a été obtenue :
 *
 * - **session BFF** : la session est relue ; disparue ou passée à un autre compte,
 *   la socket tombe.
 * - **jeton porteur** (JWT, clé API) : il n'y a aucune session, et il ne DOIT pas
 *   y en avoir — c'est le mode agent / machine à machine. Le jeton porte lui-même
 *   sa borne (`exp`) et son identité de révocation (`jti`, `iat`), que le store
 *   sait invalider avant terme.
 *
 * Confondre les deux revient à révoquer une connexion parfaitement valide au
 * motif qu'elle n'a pas de cookie. C'est ce qui s'est produit : le durcissement
 * fail-closed de la session a été appliqué à toutes les identités, coupant le
 * mode agent — un fail-closed juste, posé sur la mauvaise porte.
 */

const HANDSHAKE: IRealtimeHandshake = {
  headers: {},
  cookies: new Map(),
  url: "/nodefony/test/m2m/realtime",
  remoteAddress: "127.0.0.1",
  protocols: [],
};

const alice = {
  identifier: "alice",
  roles: ["ROLE_ADMIN", "ROLE_USER"],
} as unknown as IUser;

/** Session BFF re-lisible : le contrat minimal que lit le revalidateur. */
function sessionCtx(id: string, stored: { user?: unknown } | null) {
  return {
    session: { id, storage: { read: async () => stored } },
  };
}

/** Jeton porteur tel que le firewall le pose dans l'ALS après authentification. */
function bearerToken(
  type: string,
  claims: Record<string, unknown>,
  jti?: string,
): UserToken {
  const t = new UserToken(type);
  t.promote(alice);
  t.setAttribute("claims", claims);
  if (jti !== undefined) t.setAttribute("jti", jti);
  return t;
}

/** Exécute `fn` dans une bulle ALS telle que le firewall la laisse au handshake. */
function inScope<T>(payload: Record<string, unknown>, fn: () => T): T {
  return RequestContext.run({ requestId: "t-rev", ...payload } as never, fn);
}

const NOW = 1_800_000_000_000; // epoch ms fixe — aucune horloge réelle dans un test
const SEC = (ms: number) => Math.floor(ms / 1000);

describe("Identité realtime — mode SESSION (cookie BFF)", () => {
  it("porte le type `session` et reste valide tant que la session vit", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, context: sessionCtx("sess-1", { user: "alice" }) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "session");
    assert.equal(await token.isValid?.(), true);
  });

  it("tombe quand la session a disparu (déconnexion)", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, context: sessionCtx("sess-1", null) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(), false);
  });

  it("tombe quand la session est passée à un AUTRE compte (navigateur partagé)", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, context: sessionCtx("sess-1", { user: "bob" }) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(), false);
  });

  it("FAIL-CLOSED : identité de session SANS session relisible → révoquée (F84)", async () => {
    // Le durcissement d'origine, conservé : ici l'identité PROMET une révocation
    // par session, et on ne peut pas la tenir. Le seul état sûr est le refus.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope({ user: alice, context: {} }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(), false);
  });
});

describe("Identité realtime — mode JETON PORTEUR (JWT / clé API, agent M2M)", () => {
  it("porte le VRAI type du jeton, pas `session`", async () => {
    // Le type sert au diagnostic ET aux politiques (un scope n'existe que sur un
    // jeton). Annoncer `session` pour un JWT est un mensonge sur l'identité.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "jwt");
  });

  it("reste VALIDE sans aucune session — c'est le mode machine à machine", async () => {
    // Le cas qui était cassé : aucun cookie, aucune session, et pourtant une
    // identité parfaitement authentifiée. La socket ne doit pas être révoquée.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), true);
  });

  it("tombe quand le jeton EXPIRE — la socket ne survit pas à son jeton", async () => {
    // Trou symétrique, jamais couvert : une socket figée au handshake gardait
    // ses flux longtemps après l'expiration du JWT qui l'avait ouverte.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", { exp: SEC(NOW) - 1, sub: "alice" }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("tombe quand le `jti` est mis sur la denylist (révocation ciblée)", async () => {
    const denied = new Set(["jti-42"]);
    const auth = new FirewallRealtimeAuthenticator(() => ({
      isJtiDenied: async (jti: string) => denied.has(jti),
      getInvalidBefore: async () => null,
    }));
    const token = await inScope(
      {
        user: alice,
        token: bearerToken(
          "jwt",
          { exp: SEC(NOW) + 3600, sub: "alice" },
          "jti-42",
        ),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("tombe sur une révocation EN MASSE du porteur (`invalidBefore`)", async () => {
    const auth = new FirewallRealtimeAuthenticator(() => ({
      isJtiDenied: async () => false,
      getInvalidBefore: async () => NOW, // tout jeton émis avant maintenant est mort
    }));
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", {
          exp: SEC(NOW) + 3600,
          iat: SEC(NOW) - 60,
          sub: "alice",
        }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("survit à un store INDISPONIBLE tant que le jeton n'a pas expiré", async () => {
    // Fail-soft de DISPONIBILITÉ, pas de sécurité : la borne `exp` reste vérifiée
    // sans personne. Couper toutes les sockets agent parce qu'un store est en
    // panne serait une panne de plus, pas une protection.
    const auth = new FirewallRealtimeAuthenticator(() => {
      throw new Error("store down");
    });
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), true);
  });

  it("FAIL-CLOSED : jeton SANS borne ni store → rien à prouver, donc révoqué", async () => {
    // Un jeton sans `exp` et sans store de révocation ne peut être invalidé par
    // rien. Le laisser vivre, c'est une socket éternelle.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, token: bearerToken("jwt", { sub: "alice" }) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("une clé API se comporte comme un jeton porteur, pas comme une session", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("apikey", { exp: SEC(NOW) + 3600, sub: "alice" }),
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "apikey");
    assert.equal(await token.isValid?.(NOW), true);
  });
});

describe("Identité realtime — le mode prime sur la présence d'une session", () => {
  it("un jeton porteur n'est PAS revalidé par une session qui traînerait", async () => {
    // Un agent qui passerait par une zone où une session existe (proxy, page
    // ouverte) ne doit pas voir sa durée de vie dictée par ce cookie : son
    // identité vient du jeton, sa révocation aussi.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      {
        user: alice,
        token: bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" }),
        context: sessionCtx("sess-1", null), // session morte
      },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "jwt");
    assert.equal(await token.isValid?.(NOW), true);
  });

  it("sans jeton en ALS, on retombe sur le contrat de session (compat)", async () => {
    // Aucun token posé (zone historique) → l'identité est traitée comme une
    // session : c'est le mode le plus strict, donc le repli sûr.
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, context: sessionCtx("sess-1", { user: "alice" }) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "session");
    assert.equal(await token.isValid?.(), true);
  });
});

/**
 * **Le type du jeton n'est pas un détail d'affichage : c'est une décision
 * d'autorisation.**
 *
 * `ScopeVoter` traite les identités humaines (`session`, `userpassword`) comme
 * **non scopables** : un scope `api:action` ne bride pas un humain, il downscope
 * une clé machine déléguée. Il rend donc `GRANT` sans regarder les scopes.
 *
 * Tant que le jeton realtime s'annonçait `session` quelle que soit la réalité, un
 * agent authentifié par JWT était pris pour un humain : **tous les `@RequireScope`
 * passaient sur la socket, sans qu'aucun scope ne soit détenu**. Le downscoping
 * des clés machine — la garantie même du mode agent — n'existait pas en WebSocket.
 *
 * Corriger le type ne suffit pas : encore faut-il que les scopes VOYAGENT, sinon
 * on remplace un fail-open par un refus systématique.
 */
describe("Scopes d'un agent sur la socket (downscoping des clés machine)", () => {
  it("un jeton porteur EXPOSE ses scopes au verrou d'autorisation", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const issued = bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" });
    issued.setAttribute("scopes", ["orders:read"]);
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.deepEqual(token.getScopes(), ["orders:read"]);
  });

  it("VECTEUR FERMÉ : un agent SANS le scope ne l'obtient pas par sa socket", async () => {
    const voter = new ScopeVoter();
    const auth = new FirewallRealtimeAuthenticator();
    const issued = bearerToken("jwt", { exp: SEC(NOW) + 3600, sub: "alice" });
    issued.setAttribute("scopes", ["orders:read"]);
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    // Le scope détenu passe…
    assert.equal(
      await voter.vote(token as never, "orders:read"),
      VoterVote.GRANT,
    );
    // …celui qui ne l'est pas ne passe PAS (ABSTAIN → refus par default-DENY).
    assert.equal(
      await voter.vote(token as never, "orders:write"),
      VoterVote.ABSTAIN,
    );
  });

  it("une identité HUMAINE reste non scopable (le scope ne bride pas un humain)", async () => {
    const voter = new ScopeVoter();
    const auth = new FirewallRealtimeAuthenticator();
    const token = await inScope(
      { user: alice, context: sessionCtx("sess-1", { user: "alice" }) },
      () => auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "session");
    assert.deepEqual(token.getScopes(), []);
    assert.equal(
      await voter.vote(token as never, "orders:write"),
      VoterVote.GRANT,
    );
  });
});

/**
 * **Un jeton émis AILLEURS ouvre une socket qui meurt avec lui.**
 *
 * Les cas ci-dessus fabriquent le jeton du firewall à la main, ce qui prouve le
 * revalidateur mais suppose qu'un authenticator remplit bien son contrat. Ici on
 * fait tourner le VRAI {@link ExternalJwtAuthenticator} : c'est la seule façon de
 * voir ce qui manquait, car rien, dans le revalidateur, ne pouvait signaler
 * qu'une borne n'était jamais arrivée.
 *
 * Le défaut trouvé en red-team : l'authenticator posait `scopes` et `subject`,
 * mais ni `claims` ni `jti`. Le revalidateur ne trouvait donc aucune borne — et,
 * un store étant présent, il ne tombait pas non plus dans son garde-fou
 * fail-closed : il interrogeait le store avec `jti = null` et `iat = null`, deux
 * questions auxquelles on ne peut répondre que « toujours valable ». **Une socket
 * ouverte au nom d'un jeton tiers ne pouvait jamais être fermée**, ni à
 * l'expiration, ni par une révocation en masse. Atteignable dès qu'une zone
 * `external-jwt` garde `realtime` à son défaut, qui vaut `true`.
 */
describe("Identité realtime — jeton d'un émetteur TIERS (P6.9)", () => {
  const EXT_ISSUER = "https://auth.example.com/realms/nodefony";
  const EXT_RESOURCE = "https://app.example/nodefony/mcp";

  /** Container minimal : le vérificateur est une fonction, c'est le contrat. */
  const extContainer = (principal: IAccessPrincipal): Container =>
    ({
      get: (name: string): unknown =>
        name === ACCESS_TOKEN_VERIFIER
          ? () => Promise.resolve(principal)
          : null,
    }) as unknown as Container;

  const extContext = (): ContextType =>
    ({
      request: { headers: { authorization: "Bearer a.b.c" } },
      security: { name: "ext", resource: EXT_RESOURCE },
    }) as unknown as ContextType;

  /** Authentifie pour de vrai, puis rend le jeton tel que l'ALS le porterait. */
  async function issuedByExternal(
    principal: Omit<IAccessPrincipal, "issuer">,
  ): Promise<UserToken> {
    // L'émetteur est posé ici, pas dans chaque cas : ce qu'on éprouve dans ce
    // banc est la BORNE du jeton, pas l'espace de noms du sujet. Il doit
    // néanmoins être présent et connu de l'authenticator — sans quoi le
    // rattachement échoue en 503 et tous les cas tomberaient pour la mauvaise
    // raison.
    const full: IAccessPrincipal = { ...principal, issuer: EXT_ISSUER };
    const auth = new ExternalJwtAuthenticator(extContainer(full), {
      issuers: [{ issuer: EXT_ISSUER, subjectMapping: "prefixed" }],
      subjectPolicy: "ephemeral",
      ephemeralRoles: ["ROLE_AGENT"],
    });
    const token = await auth.createToken(extContext());
    return (await auth.authenticate(token)) as UserToken;
  }

  it("reste valide tant que le jeton tiers n'a pas expiré", async () => {
    const auth = new FirewallRealtimeAuthenticator();
    const issued = await issuedByExternal({
      subject: "agent-7",
      scopes: ["orders:read"],
      expiresAt: SEC(NOW) + 3600,
    });
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(token.type, "external-jwt");
    assert.equal(await token.isValid?.(NOW), true);
  });

  it("🔴 tombe quand le jeton tiers EXPIRE — la socket ne lui survit pas", async () => {
    // LE vecteur. Sans la borne remontée par le vérificateur puis posée par
    // l'authenticator, cette socket vivait indéfiniment.
    const auth = new FirewallRealtimeAuthenticator();
    const issued = await issuedByExternal({
      subject: "agent-7",
      scopes: [],
      expiresAt: SEC(NOW) - 1,
    });
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("🔴 FAIL-CLOSED : jeton tiers SANS aucune borne → révoqué, même avec un store", async () => {
    // Le filet, distinct de la correction : un store présent ne prouve rien s'il
    // n'a aucune prise. C'est cette formulation — « pas de borne ET pas de
    // store » — qui laissait passer le cas réel, et elle aurait laissé passer
    // n'importe quel futur authenticator oubliant de transmettre les claims.
    const auth = new FirewallRealtimeAuthenticator(() => ({
      isJtiDenied: async () => false,
      getInvalidBefore: async () => null,
    }));
    const issued = await issuedByExternal({ subject: "agent-7", scopes: [] });
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("le `jti` de l'émetteur tiers atteint la denylist (révocation ciblée)", async () => {
    const auth = new FirewallRealtimeAuthenticator(() => ({
      isJtiDenied: async (jti: string) => jti === "ext-jti-9",
      getInvalidBefore: async () => null,
    }));
    const issued = await issuedByExternal({
      subject: "agent-7",
      scopes: [],
      expiresAt: SEC(NOW) + 3600,
      tokenId: "ext-jti-9",
    });
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });

  it("une révocation EN MASSE atteint aussi un porteur externe (`iat`)", async () => {
    const auth = new FirewallRealtimeAuthenticator(() => ({
      isJtiDenied: async () => false,
      getInvalidBefore: async () => NOW,
    }));
    const issued = await issuedByExternal({
      subject: "agent-7",
      scopes: [],
      expiresAt: SEC(NOW) + 3600,
      issuedAt: SEC(NOW) - 60,
    });
    const token = await inScope({ user: alice, token: issued }, () =>
      auth.authenticate(HANDSHAKE),
    );
    assert.equal(await token.isValid?.(NOW), false);
  });
});
