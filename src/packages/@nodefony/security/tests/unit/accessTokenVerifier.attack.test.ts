import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, Event, ACCESS_TOKEN_VERIFIER } from "nodefony";
import type { IAccessPrincipal, IAccessTokenVerifier, Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import * as jose from "jose";
import { JwtAuthenticator } from "../../nodefony/src/authenticator/JwtAuthenticator";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { AccessTokenVerifierService } from "../../nodefony/service/accessTokenVerifier";
import type { IJwtRuntime } from "../../nodefony/src/token/jwtRuntime";

/**
 * RED-TEAM — un jeton signé par CETTE application, présenté à une RESSOURCE
 * protégée (porte MCP) par le vérificateur partagé `accessTokenVerifier`.
 *
 * La règle éprouvée : l'émetteur de l'application est TOUJOURS reconnu, dès que
 * sa capacité JWT est active — et seulement aux conditions de l'authentificateur
 * `jwt` (révocation, compte actif, `typ`), avec l'audience de la RESSOURCE.
 *
 * Le défaut qui a fait écrire ce banc : le vérificateur ne connaissait que les
 * émetteurs TIERS déclarés. Une application qui émettait un jeton pour sa propre
 * porte (`security:mcp:token --resource …`) le voyait refusé, jeton valide compris.
 * Le corriger en reconnaissant le seul jeu de clés publiques aurait ouvert un
 * second trou : un jeton RÉVOQUÉ, ou celui d'un compte désactivé, aurait ouvert
 * la porte jusqu'à son expiration. D'où la moitié de la matrice ci-dessous.
 *
 * Matrice écrite AVANT la lecture de la logique (threat-first) : RFC 8725
 * (JWT BCP), RFC 8707 (audience), RFC 9068 (`typ: at+jwt`), et les PONTS que
 * crée un vérificateur partagé entre la porte et la zone `external-jwt`.
 */

const ISSUER = "https://app.test";
const RESOURCE = "https://app.test/api/mcp";
/** Un émetteur TIERS « de confiance », injoignable : aucune clé ne s'y lit. */
const THIRD_PARTY = "https://127.0.0.1:1/realms/app";

const RT: IJwtRuntime = {
  issuer: ISSUER,
  audiences: [ISSUER, RESOURCE],
  accessTtlS: 900,
  refreshTtlS: 604800,
  rotateRefresh: true,
  alg: "EdDSA",
};

const user = (identifier: string, over: Partial<IUser> = {}): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
  ...over,
});

/**
 * Annuaire VRAI dans sa forme (`IUserProvider`) : `alice` active, `bob`
 * désactivé, `carol` verrouillée ; tout autre est inconnu. Chaque lecture est
 * comptée — un refus qui n'interroge pas l'annuaire se voit.
 */
let lookups: string[];
const users = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
    lookups.push(id);
    if (id === "alice") return user("alice");
    if (id === "bob") return user("bob", { isActive: () => false });
    if (id === "carol") return user("carol", { isLocked: () => true });
    throw new Error("inconnu");
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

let keystore: JwtKeystore;
let store: MemoryTokenStore;
let signing: { key: CryptoKey; kid: string };
/** Un jeton légitime, signé avant que le décor d'un test ne le casse. */
let tokenOk: string;

const nowS = (): number => Math.floor(Date.now() / 1000);

/** Claims d'un jeton légitime ; chaque vecteur en retire ou en fausse un. */
const legit = (): Record<string, unknown> => ({
  iss: ISSUER,
  aud: RESOURCE,
  sub: "alice",
  jti: `jti-${Math.random()}`,
  iat: nowS(),
  exp: nowS() + 900,
  scope: "mcp:batch",
});

async function sign(
  claims: Record<string, unknown> = {},
  header: { typ?: string; kid?: string } = {},
  key: CryptoKey = signing.key,
): Promise<string> {
  const body = { ...legit(), ...claims };
  // Liaison au compte (#139) : le compte porte l'id `u-<identifiant>`.
  if (!("uid" in claims)) body.uid = `u-${String(body.sub)}`;
  for (const [k, v] of Object.entries(body))
    if (v === undefined) delete body[k];
  const protectedHeader: jose.JWTHeaderParameters = {
    alg: "EdDSA",
    kid: header.kid ?? signing.kid,
  };
  if (header.typ !== "") protectedHeader.typ = header.typ ?? "at+jwt";
  return new jose.SignJWT(body).setProtectedHeader(protectedHeader).sign(key);
}

const b64 = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const services = (): Record<string, unknown> => ({
  jwtKeystore: keystore,
  tokenStore: store,
  users,
});

const authenticator = (s: Record<string, unknown> = services()) =>
  new JwtAuthenticator(
    { get: (n: string): unknown => s[n] } as unknown as Container,
    RT,
  );

/** Monte le service sur un conteneur réel, et joue `onBoot`. */
function boot(options: Record<string, unknown>): Container {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  for (const [name, service] of Object.entries(services()))
    container.set(name, service);
  new AccessTokenVerifierService({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  kernel.emit("onBoot");
  return container;
}

const LOCAL_ONLY = { jwt: { issuer: ISSUER, audiences: RT.audiences } };

function verifierOf(container: Container): IAccessTokenVerifier {
  const verify = container.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER);
  assert.equal(typeof verify, "function", "aucun vérificateur posé");
  return verify as IAccessTokenVerifier;
}

/**
 * Le verdict d'un vérificateur sous la forme que la porte lit : un principal,
 * `null` (refus → 401), ou une exception (invérifiable → 503). Jamais
 * « accepté » par défaut.
 */
async function outcome(
  verify: IAccessTokenVerifier,
  token: string,
  audience = RESOURCE,
): Promise<IAccessPrincipal | null | "throw"> {
  try {
    return await verify(token, audience);
  } catch {
    return "throw";
  }
}

beforeEach(async () => {
  keystore = new JwtKeystore({}, () => {});
  store = new MemoryTokenStore();
  signing = await keystore.getSigningKey();
  tokenOk = await sign();
  lookups = [];
});

describe("contrôles POSITIFS — sans eux, « tout refuser » serait vert", () => {
  it("jeton maison valide pour CETTE ressource → principal (émetteur, sujet, scopes, bornes)", async () => {
    const token = await sign({ jti: "j-ok" });
    const principal = await authenticator().verifyForResource(token, RESOURCE);
    assert.equal(principal?.issuer, ISSUER);
    assert.equal(principal?.subject, "alice");
    assert.deepEqual(principal?.scopes, ["mcp:batch"]);
    assert.equal(principal?.tokenId, "j-ok");
    assert.equal(typeof principal?.expiresAt, "number");
    // Le compte a bien été relu : c'est ce qui rend la désactivation effective.
    assert.deepEqual(lookups, ["alice"]);
  });

  it("par le SERVICE, sans aucun émetteur tiers déclaré → le jeton maison est lu", async () => {
    const principal = await outcome(verifierOf(boot(LOCAL_ONLY)), await sign());
    assert.notEqual(principal, "throw");
    assert.equal((principal as IAccessPrincipal | null)?.subject, "alice");
  });

  it("audience en TABLEAU qui contient la ressource → accepté (RFC 7519 §4.1.3)", async () => {
    const principal = await authenticator().verifyForResource(
      await sign({ aud: ["https://autre.test", RESOURCE] }),
      RESOURCE,
    );
    assert.equal(principal?.subject, "alice");
  });
});

describe("RFC 8725 — signature et algorithme", () => {
  it("V1 alg=none (jeton non signé, émetteur local) → refus", async () => {
    const token = `${b64({ alg: "none", typ: "at+jwt" })}.${b64(legit())}.`;
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V2 confusion d'algorithme : HS256 signé avec la clé PUBLIQUE → refus", async () => {
    const jwks = await keystore.getPublicJWKS();
    const secret = new TextEncoder().encode(JSON.stringify(jwks.keys[0]));
    const token = await new jose.SignJWT(legit())
      .setProtectedHeader({ alg: "HS256", kid: signing.kid, typ: "at+jwt" })
      .sign(secret);
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V3 clé de l'ATTAQUANT, même `kid` que la clé locale → refus", async () => {
    const { privateKey: attacker } = await jose.generateKeyPair("EdDSA");
    const token = await sign({}, {}, attacker);
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V4 `kid` inconnu → refus", async () => {
    const token = await sign({}, { kid: "kid-fantome" });
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V5 charge FALSIFIÉE après signature (scope élargi) → refus", async () => {
    const [h, , s] = (await sign()).split(".");
    const forged = `${h}.${b64({ ...legit(), scope: "admin:write" })}.${s}`;
    assert.equal(
      await authenticator().verifyForResource(forged, RESOURCE),
      null,
    );
  });
});

describe("RFC 8725 / 9068 / 8707 — revendications", () => {
  const refuses: Array<[string, Record<string, unknown>, { typ?: string }?]> = [
    ["V6 expiré", { exp: nowS() - 60, iat: nowS() - 1000 }],
    ["V7 pas encore valide (nbf futur)", { nbf: nowS() + 3600 }],
    ["V8 audience d'une AUTRE ressource", { aud: ISSUER }],
    [
      "V9 audience en tableau SANS la ressource",
      { aud: ["https://autre.test"] },
    ],
    ["V10 audience absente", { aud: undefined }],
    ["V11 `jti` absent (non révocable)", { jti: undefined }],
    ["V12 `sub` absent", { sub: undefined }],
    ["V13 jeton de RAFRAÎCHISSEMENT (typ rt+jwt)", {}, { typ: "rt+jwt" }],
    ["V14 `typ` absent", {}, { typ: "" }],
    // Passe 1 sans biais (relue SANS le code) — les variantes que la
    // première matrice n'avait pas écrites.
    ["V14b `typ: JWT` (jeton générique, pas d'accès)", {}, { typ: "JWT" }],
    ["V14c audience avec barre FINALE", { aud: `${RESOURCE}/` }],
    ["V14d audience en CASSE différente", { aud: RESOURCE.toUpperCase() }],
    ["V14e audience de type NOMBRE", { aud: 42 }],
    ["V14f audience de type OBJET", { aud: { resource: RESOURCE } }],
    ["V14g `jti` NUMÉRIQUE (non révocable par la liste)", { jti: 7 }],
    ["V14h `sub` NUMÉRIQUE", { sub: 1 }],
  ];
  for (const [label, claims, header] of refuses) {
    it(`${label} → refus`, async () => {
      const token = await sign(claims, header ?? {});
      assert.equal(
        await authenticator().verifyForResource(token, RESOURCE),
        null,
      );
    });
  }
});

describe("RFC 8725 — algorithme et clé choisis par l'en-tête (passe sans biais)", () => {
  it("V5b RS256, clé RSA de l'attaquant, émetteur local → refus (allowlist EdDSA)", async () => {
    const { privateKey } = await jose.generateKeyPair("RS256");
    const token = await new jose.SignJWT(legit())
      .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "at+jwt" })
      .sign(privateKey);
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V5c clé de l'attaquant EMBARQUÉE dans l'en-tête (`jwk`) → refus", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("EdDSA");
    const token = await new jose.SignJWT(legit())
      .setProtectedHeader({
        alg: "EdDSA",
        typ: "at+jwt",
        jwk: await jose.exportJWK(publicKey),
      })
      .sign(privateKey);
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V5d `kid` d'injection (`../`, `' OR 1=1`) → refus, sans exception", async () => {
    for (const kid of ["../../etc/passwd", "' OR 1=1 --"]) {
      const token = await sign({}, { kid });
      assert.equal(
        await authenticator().verifyForResource(token, RESOURCE),
        null,
      );
    }
  });

  it("V5e audience VIDE demandée par l'appelant → refus, jamais « toute audience »", async () => {
    assert.equal(
      await authenticator().verifyForResource(await sign(), ""),
      null,
    );
  });
});

describe("révocation et compte — ce que le seul jeu de clés publiques laissait passer", () => {
  it("V16b `iat` ABSENT face à une déconnexion globale → refus (jamais « pas de date = valide »)", async () => {
    const token = await sign({ iat: undefined });
    await store.revokeAllForSubject("alice", Date.now());
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V20b liste de révocation en PANNE → LÈVE (503), jamais un jeton servi", async () => {
    // Un store dont la lecture de la liste échoue — le reste délégué au vrai.
    const enPanne = {
      isJtiDenied: (): Promise<boolean> =>
        Promise.reject(new Error("base injoignable")),
      getInvalidBefore: (subject: string) => store.getInvalidBefore(subject),
    };
    await assert.rejects(() =>
      authenticator({ ...services(), tokenStore: enPanne }).verifyForResource(
        // Signé AVANT de poser le décor : seule la révocation est en panne.
        tokenOk,
        RESOURCE,
      ),
    );
  });

  it("V20c annuaire en PANNE → refus (401) : fail-CLOSED, jamais un jeton servi", async () => {
    // Limite assumée, héritée de l'authentificateur `jwt` : une lecture du
    // compte qui échoue se lit comme un compte absent. Le jeton n'est jamais
    // accepté ; la réponse est 401 et non 503.
    const enPanne = {
      ...users,
      loadUserByIdentifier: (): Promise<IUser> =>
        Promise.reject(new Error("base injoignable")),
    };
    assert.equal(
      await authenticator({ ...services(), users: enPanne }).verifyForResource(
        tokenOk,
        RESOURCE,
      ),
      null,
    );
  });

  it("V15 jeton RÉVOQUÉ (denylist `jti`) → refus avant son expiration", async () => {
    const token = await sign({ jti: "revoque" });
    await store.denyJti("revoque", Date.now() + 900_000);
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V16 déconnexion GLOBALE du porteur (invalidBefore) → refus des jetons antérieurs", async () => {
    const token = await sign({ iat: nowS() - 10 });
    await store.revokeAllForSubject("alice", Date.now());
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V17 compte DÉSACTIVÉ → refus", async () => {
    const token = await sign({ sub: "bob" });
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V18 compte VERROUILLÉ → refus", async () => {
    const token = await sign({ sub: "carol" });
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V19 sujet INCONNU de l'annuaire → refus, jamais une exception", async () => {
    const token = await sign({ sub: "mallory" });
    assert.equal(
      await authenticator().verifyForResource(token, RESOURCE),
      null,
    );
  });

  it("V20 révoqué → refus SANS interroger l'annuaire (le refus le moins cher d'abord)", async () => {
    const token = await sign({ jti: "revoque-tot" });
    await store.denyJti("revoque-tot", Date.now() + 900_000);
    await authenticator().verifyForResource(token, RESOURCE);
    assert.deepEqual(lookups, []);
  });
});

describe("PONTS — un vérificateur partagé entre la porte et la zone external-jwt", () => {
  it("V21 clé LOCALE + `iss` d'un émetteur TIERS de confiance → jamais accepté", async () => {
    // Le jeton se réclame de Keycloak mais porte la signature de l'application :
    // il doit être jugé avec les clés de Keycloak — ici injoignables, donc
    // invérifiable (503) — et JAMAIS avec les clés locales.
    const container = boot({
      ...LOCAL_ONLY,
      resourceServer: {
        issuers: [{ issuer: THIRD_PARTY, jwksUri: `${THIRD_PARTY}/keys` }],
        timeoutMs: 200,
      },
    });
    const verdict = await outcome(
      verifierOf(container),
      await sign({ iss: THIRD_PARTY }),
    );
    assert.ok(
      verdict === null || verdict === "throw",
      `accepté : ${JSON.stringify(verdict)}`,
    );
    assert.deepEqual(lookups, [], "le chemin LOCAL a été pris");
  });

  it("V21b émetteur TIERS en panne : un jeton de l'APPLICATION reste servi", async () => {
    // Une panne de Keycloak ne coupe pas l'accès que l'application accorde
    // elle-même : le chemin local ne touche pas au réseau.
    const container = boot({
      ...LOCAL_ONLY,
      resourceServer: {
        issuers: [{ issuer: THIRD_PARTY, jwksUri: `${THIRD_PARTY}/keys` }],
        timeoutMs: 200,
      },
    });
    const verdict = await outcome(verifierOf(container), await sign());
    assert.equal((verdict as IAccessPrincipal | null)?.subject, "alice");
  });

  it("V22 émetteur INCONNU → refus, sans requête sortante ni lecture d'annuaire", async () => {
    const verdict = await outcome(
      verifierOf(boot(LOCAL_ONLY)),
      await sign({ iss: "https://evil.example" }),
    );
    assert.equal(verdict, null);
    assert.deepEqual(lookups, []);
  });

  it("V23 émetteur local écrit AUTREMENT (barre finale) → refus : l'aiguillage est EXACT", async () => {
    const verdict = await outcome(
      verifierOf(boot(LOCAL_ONLY)),
      await sign({ iss: `${ISSUER}/` }),
    );
    assert.equal(verdict, null);
  });

  it("V24 émetteur local DÉCLARÉ aussi comme tiers : la révocation s'applique quand même", async () => {
    // Avant : déclaré dans `resourceServer.issuers`, l'émetteur local était lu
    // par son seul jeu de clés — un jeton révoqué passait.
    const container = boot({
      ...LOCAL_ONLY,
      resourceServer: { issuers: [{ issuer: ISSUER, algorithms: ["EdDSA"] }] },
    });
    const token = await sign({ jti: "revoque-declare" });
    await store.denyJti("revoque-declare", Date.now() + 900_000);
    assert.equal(await outcome(verifierOf(container), token), null);
  });

  it("V25 capacité JWT COUPÉE : un jeton à l'émetteur local n'est plus reconnu", async () => {
    const container = boot({
      jwt: { enabled: false, issuer: ISSUER },
      resourceServer: {
        issuers: [{ issuer: THIRD_PARTY, jwksUri: `${THIRD_PARTY}/keys` }],
        timeoutMs: 200,
      },
    });
    assert.equal(await outcome(verifierOf(container), await sign()), null);
  });

  it("V26 capacité JWT coupée et aucun émetteur tiers → rien n'est posé (la porte dit 503)", () => {
    const container = boot({ jwt: { enabled: false } });
    // Le conteneur rend `null` pour un nom absent.
    assert.equal(container.get(ACCESS_TOKEN_VERIFIER) ?? null, null);
  });

  it("V27 émetteurs tiers MAL configurés → AUCUN vérificateur, jetons locaux compris", () => {
    // Une configuration fausse ne se sert pas à moitié : fail-closed annoncé.
    const container = boot({
      ...LOCAL_ONLY,
      resourceServer: {
        issuers: [{ issuer: THIRD_PARTY }, { issuer: THIRD_PARTY }],
      },
    });
    assert.equal(container.get(ACCESS_TOKEN_VERIFIER) ?? null, null);
  });
});

describe("entrées HOSTILES — un refus, jamais une exception", () => {
  const garbage = [
    "",
    "abc",
    "a.b.c",
    "...",
    `${b64({ alg: "EdDSA" })}.${b64("pas-un-objet")}.x`,
    "x".repeat(100_000),
    // Un JWE (cinq segments) : jamais déchiffré ni pris pour un JWS.
    "a.b.c.d.e",
  ];
  for (const token of garbage) {
    it(`« ${token.slice(0, 24)}${token.length > 24 ? "…" : ""} » → null`, async () => {
      assert.equal(await outcome(verifierOf(boot(LOCAL_ONLY)), token), null);
    });
  }

  it("câblage absent (pas de keystore) → LÈVE : la porte répond 503, jamais « accepté »", async () => {
    await assert.rejects(() =>
      authenticator({ tokenStore: store, users }).verifyForResource(
        "a.b.c",
        RESOURCE,
      ),
    );
  });

  it("câblage absent (pas de liste de révocation) → LÈVE, même pour un jeton valide", async () => {
    const token = await sign();
    await assert.rejects(() =>
      authenticator({ jwtKeystore: keystore, users }).verifyForResource(
        token,
        RESOURCE,
      ),
    );
  });

  it("câblage absent (pas d'annuaire) → LÈVE, même pour un jeton valide", async () => {
    const token = await sign();
    await assert.rejects(() =>
      authenticator({
        jwtKeystore: keystore,
        tokenStore: store,
      }).verifyForResource(token, RESOURCE),
    );
  });

  it("configuration de sécurité INVALIDE → aucun vérificateur posé", () => {
    const container = boot({ jwt: { alg: "HS256" } });
    assert.equal(container.get(ACCESS_TOKEN_VERIFIER) ?? null, null);
  });
});

describe('émetteur PAR DÉFAUT — `"nodefony"`, qui n\'est pas une URL', () => {
  it("le jeton est lu, et le principal porte l'émetteur tel quel", async () => {
    const local = new JwtAuthenticator(
      {
        get: (n: string): unknown => services()[n],
      } as unknown as Container,
      { ...RT, issuer: "nodefony" },
    );
    const principal = await local.verifyForResource(
      await sign({ iss: "nodefony" }),
      RESOURCE,
    );
    assert.equal(principal?.issuer, "nodefony");
  });

  it("deux jetons de suite : le jeu de clés est relu UNE fois, le second est jugé pareil", async () => {
    const local = authenticator();
    assert.equal(
      (await local.verifyForResource(await sign(), RESOURCE))?.subject,
      "alice",
    );
    const revoked = await sign({ jti: "second" });
    await store.denyJti("second", Date.now() + 900_000);
    assert.equal(await local.verifyForResource(revoked, RESOURCE), null);
  });
});
