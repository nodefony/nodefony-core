import assert from "node:assert/strict";
import type { Container, IAccessPrincipal } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser, IUserProvider } from "@nodefony/user";
import { ExternalJwtAuthenticator } from "../../nodefony/src/authenticator/ExternalJwtAuthenticator";
import type { ExternalSubjectMapping } from "../../nodefony/src/authenticator/externalSubject";
import { JwtAuthenticator } from "../../nodefony/src/authenticator/JwtAuthenticator";
import { peekIssuer } from "../../nodefony/src/authenticator/peekIssuer";
import type { ISecuredArea } from "../../nodefony/contracts/ISecuredArea";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { UnverifiableTokenError } from "../../nodefony/errors/UnverifiableTokenError";

/**
 * Le chaînon entre un jeton émis AILLEURS et un utilisateur d'ICI.
 *
 * Trois choses s'y jouent, et aucune n'est visible depuis les briques prises
 * séparément : l'AIGUILLAGE (deux authenticators reconnaissent la même forme de
 * credential), la distinction REFUS / PANNE (401 contre 503), et le
 * RATTACHEMENT du sujet à un compte local.
 *
 * Rien n'ouvre de port ni ne signe quoi que ce soit : le vérificateur est le
 * contrat du cœur, donc une fonction — c'est exactement ce qui permet d'écrire
 * ici la panne, le refus et le succès de façon déterministe. La cryptographie
 * réelle est éprouvée chez `RemoteJwtVerifier`, la chaîne complète chez
 * `protectedResourceChain`.
 */

const ISSUER = "https://auth.example.com/realms/nodefony";
/**
 * Ce que compose le mapping `prefixed` : l'identité est la paire `(iss, sub)`.
 * Écrit en dur ici, et non via `localIdentifierFor`, pour que le banc échoue si
 * la composition change — un test qui réutilise la fonction qu'il éprouve
 * suivrait la régression sans rien dire.
 */
const EXT_ID = `${ISSUER}#agent-7`;
const RESOURCE = "https://app.example/nodefony/mcp";

/** Fabrique un JWS compact dont seul le payload compte (rien n'est vérifié ici). */
const jws = (claims: Record<string, unknown>): string => {
  const seg = (o: unknown): string =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${seg({ alg: "ES256", typ: "JWT" })}.${seg(claims)}.c2ln`;
};

const container = (services: Record<string, unknown>): Container =>
  ({
    get: (name: string): unknown => services[name],
  }) as unknown as Container;

const area = (over: Partial<ISecuredArea> = {}): ISecuredArea =>
  ({
    name: "mcp",
    security: true,
    stateless: true,
    mode: "first",
    authenticators: ["external-jwt"],
    realtime: false,
    resource: RESOURCE,
    ...over,
  }) as unknown as ISecuredArea;

const httpContext = (
  authorization?: string,
  securedArea: ISecuredArea | null = area(),
): ContextType =>
  ({
    request: {
      headers: authorization ? { authorization } : {},
      url: new URL("https://app.example/nodefony/mcp"),
      pathname: "/nodefony/mcp",
    },
    security: securedArea,
  }) as unknown as ContextType;

const user = (
  identifier: string,
  state: { active?: boolean; locked?: boolean } = {},
): IUser => ({
  id: "00000000-0000-4000-8000-000000000042",
  identifier,
  roles: ["ROLE_USER"],
  hasRole: (r: string) => r === "ROLE_USER",
  isActive: () => state.active !== false,
  isLocked: () => state.locked === true,
});

const provider = (users: Record<string, IUser>): IUserProvider =>
  ({
    loadUserByIdentifier: (id: string): Promise<IUser> => {
      const found = users[id];
      if (!found) return Promise.reject(new Error("no such user"));
      return Promise.resolve(found);
    },
  }) as unknown as IUserProvider;

/** Vérificateur qui accepte, refuse ou tombe en panne — au choix du test. */
const verifier = (
  behaviour: "accept" | "reject" | "down",
  seen?: { token?: string; audience?: string },
) => {
  return (
    token: string,
    audience: string,
  ): Promise<IAccessPrincipal | null> => {
    if (seen) {
      seen.token = token;
      seen.audience = audience;
    }
    if (behaviour === "down") {
      return Promise.reject(new Error("issuer unreachable"));
    }
    if (behaviour === "reject") return Promise.resolve(null);
    return Promise.resolve({
      issuer: ISSUER,
      subject: "agent-7",
      scopes: ["mcp:call"],
    });
  };
};

const build = (
  services: Record<string, unknown>,
  over: Partial<{
    subjectPolicy: "require" | "ephemeral";
    ephemeralRoles: string[];
    issuers: string[];
    subjectMapping: ExternalSubjectMapping;
  }> = {},
): ExternalJwtAuthenticator =>
  new ExternalJwtAuthenticator(container(services), {
    // Défaut de PRODUCTION (`prefixed`), pas un défaut de confort : un banc qui
    // se donnerait « subject » d'office ne verrait jamais la garde d'espace de
    // noms, et prouverait l'ancien comportement en croyant prouver le nouveau.
    issuers: (over.issuers ?? [ISSUER]).map((issuer) => ({
      issuer,
      subjectMapping: over.subjectMapping ?? "prefixed",
    })),
    subjectPolicy: over.subjectPolicy ?? "require",
    ephemeralRoles: over.ephemeralRoles ?? [],
  });

describe("peekIssuer — aiguillage, jamais décision", () => {
  it("rend l'émetteur revendiqué d'un JWS compact", () => {
    assert.equal(peekIssuer(jws({ iss: ISSUER, sub: "x" })), ISSUER);
  });

  it("rend null sur ce qui n'est pas exploitable, sans jamais lever", () => {
    assert.equal(peekIssuer(""), null);
    assert.equal(peekIssuer("pas-un-jwt"), null);
    assert.equal(peekIssuer("a..c"), null, "payload vide");
    assert.equal(peekIssuer("a.%%%%.c"), null, "base64 illisible");
    assert.equal(
      peekIssuer(`a.${Buffer.from("pas du json").toString("base64url")}.c`),
      null,
    );
    assert.equal(peekIssuer(jws({ sub: "x" })), null, "sans iss");
    assert.equal(peekIssuer(jws({ iss: 42 })), null, "iss non textuel");
  });

  it("refuse de décoder au-delà de la borne (JSON.parse sur entrée non fiable)", () => {
    const huge = jws({ iss: ISSUER, pad: "x".repeat(9000) });
    assert.ok(huge.length > 8192);
    assert.equal(peekIssuer(huge), null);
  });
});

describe("ExternalJwtAuthenticator — aiguillage", () => {
  it("ne prend QUE les jetons d'un émetteur déclaré", () => {
    const auth = build({});
    assert.equal(auth.name, "external-jwt");
    assert.equal(
      auth.supports(httpContext(`Bearer ${jws({ iss: ISSUER })}`)),
      true,
    );
    assert.equal(
      auth.supports(
        httpContext(`Bearer ${jws({ iss: "https://autre.example" })}`),
      ),
      false,
      "émetteur inconnu",
    );
    assert.equal(
      auth.supports(httpContext(`Bearer ${jws({ sub: "x" })}`)),
      false,
      "jeton maison (sans iss)",
    );
    assert.equal(auth.supports(httpContext()), false, "aucun en-tête");
    assert.equal(auth.supports(httpContext("Basic abc")), false);
  });

  it("tolère la barre oblique terminale de l'émetteur", () => {
    const auth = build({});
    assert.equal(
      auth.supports(httpContext(`Bearer ${jws({ iss: `${ISSUER}/` })}`)),
      true,
    );
  });

  it("🔴 ne LÈVE JAMAIS sur un `iss` forgé — supports() est appelé HORS du rattrapage du pare-feu", () => {
    const auth = build({});
    // Un émetteur qui n'est pas une URL https fait lever `canonicalIssuer`.
    // Une exception ici deviendrait une 500 provoquée par un anonyme, avec une
    // simple chaîne dans `iss`.
    for (const forged of [
      "ftp://x",
      "nodefony",
      "http://auth.example.com",
      "https://auth.example.com?x=1",
      "javascript:alert(1)",
      "",
    ]) {
      assert.doesNotThrow(
        () => auth.supports(httpContext(`Bearer ${jws({ iss: forged })}`)),
        `iss = ${JSON.stringify(forged)}`,
      );
      assert.equal(
        auth.supports(httpContext(`Bearer ${jws({ iss: forged })}`)),
        false,
      );
    }
  });

  it("un émetteur mal formé en configuration est ignoré, pas fatal (le vérificateur est l'autorité)", () => {
    const auth = build({}, { issuers: ["pas-une-url", ISSUER] });
    assert.equal(
      auth.supports(httpContext(`Bearer ${jws({ iss: ISSUER })}`)),
      true,
    );
    assert.equal(
      auth.supports(httpContext(`Bearer ${jws({ iss: "pas-une-url" })}`)),
      false,
    );
  });
});

describe("Cohabitation avec les jetons maison — l'ORDRE de la zone ne décide de RIEN", () => {
  const maison = jws({ iss: "nodefony", sub: "u1" });
  const tiers = jws({ iss: ISSUER, sub: "agent-7" });

  const externe = build({});
  const local = new JwtAuthenticator(container({}), {
    issuer: "nodefony",
    audiences: ["nodefony"],
    accessTtlS: 60,
    refreshTtlS: 60,
  } as never);

  it("chacun ne reconnaît que SA famille de jetons", () => {
    assert.equal(local.supports(httpContext(`Bearer ${maison}`)), true);
    assert.equal(local.supports(httpContext(`Bearer ${tiers}`)), false);
    assert.equal(externe.supports(httpContext(`Bearer ${tiers}`)), true);
    assert.equal(externe.supports(httpContext(`Bearer ${maison}`)), false);
  });

  it("🔴 en mode `first`, le premier listé ne capture PAS le jeton de l'autre", () => {
    // C'est la garde entière : sans discriminant, `jwt` listé en tête refuserait
    // tout jeton tiers en 401 sans que `external-jwt` soit jamais consulté — et
    // l'ordre d'une liste de configuration deviendrait une décision de sécurité.
    for (const chaine of [
      [local, externe],
      [externe, local],
    ]) {
      const retenu = chaine.find((a) =>
        a.supports(httpContext(`Bearer ${tiers}`)),
      );
      assert.equal(retenu?.name, "external-jwt");
      const retenuMaison = chaine.find((a) =>
        a.supports(httpContext(`Bearer ${maison}`)),
      );
      assert.equal(retenuMaison?.name, "jwt");
    }
  });

  it("un jeton dont l'émetteur est illisible reste pris par l'authenticator maison", () => {
    // Il sera refusé en le disant, plutôt que de disparaître sans trace.
    const malforme = "a.b.c";
    assert.equal(local.supports(httpContext(`Bearer ${malforme}`)), true);
    assert.equal(externe.supports(httpContext(`Bearer ${malforme}`)), false);
  });
});

describe("ExternalJwtAuthenticator — conditions d'emploi au BOOT", () => {
  it("🔴 refuse une zone sans ressource : sans audience, un jeton d'un AUTRE service passerait", () => {
    const auth = build({});
    assert.throws(
      () => auth.validateArea(area({ resource: undefined })),
      /resource/,
    );
  });

  it("accepte une zone qui déclare sa ressource", () => {
    const auth = build({});
    assert.doesNotThrow(() => auth.validateArea(area()));
  });
});

describe("ExternalJwtAuthenticator — refus (401) contre panne (503)", () => {
  it("l'audience passée au vérificateur est celle de la ZONE, jamais celle du jeton", async () => {
    const seen: { token?: string; audience?: string } = {};
    const auth = build({
      accessTokenVerifier: verifier("accept", seen),
      users: provider({ [EXT_ID]: user(EXT_ID) }),
    });
    const raw = jws({
      iss: ISSUER,
      sub: "agent-7",
      aud: "https://autre.service",
    });
    await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(seen.audience, RESOURCE);
    assert.equal(seen.token, raw);
  });

  it("jeton refusé par le vérificateur → 401 au message uniforme", async () => {
    const auth = build({ accessTokenVerifier: verifier("reject") });
    const token = await auth.createToken(
      httpContext(`Bearer ${jws({ iss: ISSUER })}`),
    );
    await assert.rejects(auth.authenticate(token), (e: Error) => {
      assert.ok(e instanceof AuthenticationError);
      assert.equal(e.message, "Invalid token");
      return true;
    });
  });

  it("🔴 émetteur injoignable → 503, JAMAIS 401", async () => {
    // Un 401 enverrait le porteur renouveler en boucle un jeton parfaitement
    // bon, et rangerait une panne de dépendance dans la statistique des échecs
    // d'authentification.
    const auth = build({ accessTokenVerifier: verifier("down") });
    const token = await auth.createToken(
      httpContext(`Bearer ${jws({ iss: ISSUER })}`),
    );
    await assert.rejects(auth.authenticate(token), (e: Error) => {
      assert.ok(
        e instanceof UnverifiableTokenError,
        `reçu ${e.constructor.name}`,
      );
      assert.ok(!(e instanceof AuthenticationError));
      assert.equal((e as unknown as { code: number }).code, 503);
      return true;
    });
  });

  it("🔴 la cause technique ne touche JAMAIS le message — elle vit dans `detail`", async () => {
    // Le message est rendu au client, et le rendu d'erreur de développement y
    // ajoute la pile d'appels. Composer la cause dedans publie la topologie
    // interne de l'authentification à qui présente un jeton quelconque.
    // Constaté sur le fil avant correction : l'URL de l'émetteur défaillant
    // ressortait dans le corps d'une réponse 503.
    const auth = build({
      accessTokenVerifier: (): Promise<never> =>
        Promise.reject(new Error("jwks https://secret.interne/keys ENOTFOUND")),
    });
    const token = await auth.createToken(
      httpContext(`Bearer ${jws({ iss: ISSUER })}`),
    );
    await assert.rejects(auth.authenticate(token), (e: Error) => {
      assert.equal(e.message, "Token verification unavailable");
      assert.doesNotMatch(e.message, /secret\.interne|jwks|ENOTFOUND/);
      assert.match(
        (e as UnverifiableTokenError).detail ?? "",
        /secret\.interne/,
        "la cause doit rester disponible POUR LE JOURNAL",
      );
      return true;
    });
  });

  it("🔴 aucun vérificateur posé → 503 : la porte refuse de servir, elle n'accepte personne", async () => {
    const auth = build({});
    const token = await auth.createToken(
      httpContext(`Bearer ${jws({ iss: ISSUER })}`),
    );
    await assert.rejects(
      auth.authenticate(token),
      (e: Error) => e instanceof UnverifiableTokenError,
    );
  });

  it("zone sans ressource au moment de la requête → 503, jamais une vérification sans audience", async () => {
    const auth = build({ accessTokenVerifier: verifier("accept") });
    const token = await auth.createToken(
      httpContext(
        `Bearer ${jws({ iss: ISSUER })}`,
        area({ resource: undefined }),
      ),
    );
    await assert.rejects(
      auth.authenticate(token),
      (e: Error) => e instanceof UnverifiableTokenError,
    );
  });

  it("jeton vide ou absent → 401", async () => {
    const auth = build({ accessTokenVerifier: verifier("accept") });
    const token = await auth.createToken(httpContext("Bearer "));
    await assert.rejects(
      auth.authenticate(token),
      (e: Error) => e instanceof AuthenticationError,
    );
  });
});

describe("ExternalJwtAuthenticator — rattachement du sujet (policy `require`)", () => {
  const raw = jws({ iss: ISSUER, sub: "agent-7" });

  it("sujet connu et actif → promu, avec les scopes du jeton", async () => {
    const auth = build({
      accessTokenVerifier: verifier("accept"),
      users: provider({ [EXT_ID]: user(EXT_ID) }),
    });
    const token = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(token.isAuthenticated(), true);
    // Le compte local est désigné par la PAIRE ; le sujet brut et l'émetteur
    // restent lisibles séparément, pour que l'audit puisse dire « qui, chez
    // quel annuaire » sans redécouper une chaîne.
    assert.equal(token.getUser().identifier, EXT_ID);
    assert.deepEqual(token.getAttribute("scopes"), ["mcp:call"]);
    assert.equal(token.getAttribute("subject"), "agent-7");
    assert.equal(token.getAttribute("issuer"), ISSUER);
  });

  it("🔴 sujet sans compte local → 401 : l'annuaire tiers n'est pas l'autorité d'accès", async () => {
    const auth = build({
      accessTokenVerifier: verifier("accept"),
      users: provider({}),
    });
    await assert.rejects(
      auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
      (e: Error) => e instanceof AuthenticationError,
    );
  });

  it("compte désactivé ou verrouillé → 401 sans attendre l'expiration du jeton", async () => {
    for (const state of [{ active: false }, { locked: true }]) {
      const auth = build({
        accessTokenVerifier: verifier("accept"),
        users: provider({ "agent-7": user("agent-7", state) }),
      });
      await assert.rejects(
        auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
        (e: Error) => e instanceof AuthenticationError,
        JSON.stringify(state),
      );
    }
  });

  it("jeton accepté SANS sujet → 401 (rien à rattacher, rien à auditer)", async () => {
    const auth = build({
      accessTokenVerifier: (): Promise<IAccessPrincipal> =>
        Promise.resolve({ issuer: ISSUER, scopes: ["mcp:call"] }),
      users: provider({}),
    });
    await assert.rejects(
      auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
      (e: Error) => e instanceof AuthenticationError,
    );
  });

  it("aucun service `users` → erreur de CÂBLAGE nommée, pas un refus silencieux", async () => {
    const auth = build({ accessTokenVerifier: verifier("accept") });
    await assert.rejects(
      auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
      (e: Error) => {
        assert.ok(!(e instanceof AuthenticationError));
        assert.match(e.message, /users/);
        return true;
      },
    );
  });
});

describe("ExternalJwtAuthenticator — appelant purement machine (policy `ephemeral`)", () => {
  const raw = jws({ iss: ISSUER, sub: "agent-7" });

  it("aucun compte local n'est exigé ni créé ; l'identifiant PORTE son émetteur", async () => {
    const auth = build(
      { accessTokenVerifier: verifier("accept") },
      { subjectPolicy: "ephemeral" },
    );
    const token = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(token.isAuthenticated(), true);
    // Aucun compte n'est pris ici — mais l'identifiant sert quand même à
    // désigner l'appelant dans l'audit, les compteurs de limitation et les
    // canaux realtime privés. Nu, il confondrait deux agents homonymes venus
    // d'annuaires différents.
    assert.equal(token.getUser().identifier, EXT_ID);
    assert.deepEqual(token.getUser().roles, []);
    assert.deepEqual(token.getAttribute("scopes"), ["mcp:call"]);
  });

  it("🔴 sans rôle configuré, l'appelant n'est autorisé QUE par ses scopes", async () => {
    const auth = build(
      { accessTokenVerifier: verifier("accept") },
      { subjectPolicy: "ephemeral" },
    );
    const token = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(token.getUser().hasRole("ROLE_USER"), false);
    assert.equal(token.getUser().hasRole("ROLE_ADMIN"), false);
  });

  it("les rôles configurés sont accordés, et la liste n'est pas partagée entre requêtes", async () => {
    const auth = build(
      { accessTokenVerifier: verifier("accept") },
      { subjectPolicy: "ephemeral", ephemeralRoles: ["ROLE_AGENT"] },
    );
    const first = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(first.getUser().hasRole("ROLE_AGENT"), true);
    first.getUser().roles.push("ROLE_ADMIN");
    const second = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.deepEqual(
      second.getUser().roles,
      ["ROLE_AGENT"],
      "une identité éphémère ne doit rien emporter de la précédente",
    );
  });
});

describe("ExternalJwtAuthenticator — espace de noms du sujet", () => {
  /**
   * Le vecteur, en clair : beaucoup d'annuaires laissent l'utilisateur CHOISIR
   * son identifiant, et le mettent tel quel dans `sub`. Si le rattachement se
   * fait par égalité de chaîne avec l'espace local, il suffit de s'inscrire
   * sous le nom « admin » chez un émetteur reconnu pour recevoir le compte
   * « admin » de cette application — jeton parfaitement valide, signature
   * parfaitement bonne, et aucune trace d'anomalie.
   */
  it("🔴 un `sub` d'annuaire tiers ne peut PAS réclamer un compte local homonyme", async () => {
    const raw = jws({ iss: ISSUER, sub: "admin" });
    const auth = build({
      accessTokenVerifier: (): Promise<IAccessPrincipal> =>
        Promise.resolve({ issuer: ISSUER, subject: "admin", scopes: [] }),
      // Le compte local existe, il est actif, et son identifiant est
      // exactement le sujet présenté. C'est le décor de l'attaque.
      users: provider({ admin: user("admin") }),
    });
    await assert.rejects(
      auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
      (e: Error) => e instanceof AuthenticationError,
      "le compte local `admin` a été rattaché à un sujet étranger homonyme",
    );
  });

  it("deux émetteurs qui publient le MÊME `sub` donnent deux identités distinctes", async () => {
    const other = "https://autre-idp.example";
    const mk = (issuer: string) =>
      build(
        {
          accessTokenVerifier: (): Promise<IAccessPrincipal> =>
            Promise.resolve({ issuer, subject: "agent-7", scopes: [] }),
          users: provider({
            [`${ISSUER}#agent-7`]: user(`${ISSUER}#agent-7`),
            [`${other}#agent-7`]: user(`${other}#agent-7`),
          }),
        },
        { issuers: [ISSUER, other] },
      );
    const a = await mk(ISSUER).authenticate(
      await mk(ISSUER).createToken(
        httpContext(`Bearer ${jws({ iss: ISSUER, sub: "agent-7" })}`),
      ),
    );
    const b = await mk(other).authenticate(
      await mk(other).createToken(
        httpContext(`Bearer ${jws({ iss: other, sub: "agent-7" })}`),
      ),
    );
    assert.notEqual(a.getUser().identifier, b.getUser().identifier);
  });

  it("`subjectMapping: \"subject\"` rend l'ancien rattachement — mais il faut l'ÉCRIRE", async () => {
    // Le mode existe pour l'émetteur dont on maîtrise l'espace de noms — au
    // premier chef, l'application qui est son propre émetteur. Il n'est pas
    // interdit : il est explicite, donc relisible dans une revue.
    const raw = jws({ iss: ISSUER, sub: "agent-7" });
    const auth = build(
      {
        accessTokenVerifier: verifier("accept"),
        users: provider({ "agent-7": user("agent-7") }),
      },
      { subjectMapping: "subject" },
    );
    const token = await auth.authenticate(
      await auth.createToken(httpContext(`Bearer ${raw}`)),
    );
    assert.equal(token.getUser().identifier, "agent-7");
  });

  it("🔴 émetteur vérifié mais absent de la table de rattachement → 503, jamais un rattachement deviné", async () => {
    // Les deux listes viennent de la même configuration ; si elles divergent,
    // l'application ne sait pas dans quel espace lire ce sujet. Choisir pour
    // elle reviendrait à trancher entre « compte local » et « compte
    // étranger » — exactement la décision qui est en jeu.
    const raw = jws({ iss: ISSUER, sub: "agent-7" });
    const auth = build({
      accessTokenVerifier: (): Promise<IAccessPrincipal> =>
        Promise.resolve({
          issuer: "https://jamais-declare.example",
          subject: "agent-7",
          scopes: [],
        }),
      users: provider({ "agent-7": user("agent-7") }),
    });
    await assert.rejects(
      auth.authenticate(await auth.createToken(httpContext(`Bearer ${raw}`))),
      (e: Error) => e instanceof UnverifiableTokenError,
    );
  });
});
