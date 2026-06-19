import assert from "node:assert/strict";
import type { Container } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser } from "@nodefony/user";
import { ApiKeyAuthenticator } from "../../nodefony/src/authenticator/ApiKeyAuthenticator";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { generateApiKey } from "../../nodefony/src/apikey/apiKeyFormat";
import type { IAccessTokenRecord } from "../../nodefony/contracts/ITokenStore";

/**
 * Vérification d'une clé API (PAT) — **matrice d'attaques**. Chaque rejet doit
 * être un `AuthenticationError` 401 au message UNIFORME (anti-énumération). Clés
 * minées contre un VRAI `MemoryTokenStore` (pas de stub). On prouve aussi
 * l'**anti-DoS** : une clé malformée n'atteint JAMAIS `findByHash`.
 */

const PREFIX = "nf";

const fakeUser = (
  identifier: string,
  opts: { active?: boolean; locked?: boolean } = {},
): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => opts.active ?? true,
  isLocked: () => opts.locked ?? false,
});

const provider = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
    if (id === "ghost") throw new Error("not found");
    if (id === "banned") return fakeUser("banned", { locked: true });
    if (id === "inactive") return fakeUser("inactive", { active: false });
    return fakeUser(id);
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

const fakeContainer = (s: Record<string, unknown>): Container =>
  ({
    get: <T>(n: string): T | undefined => s[n] as T | undefined,
  }) as unknown as Container;

function patRecord(
  secretHash: string,
  over: Partial<IAccessTokenRecord> = {},
): IAccessTokenRecord {
  const now = Date.now();
  return {
    id: `id-${Math.random()}`,
    kind: "pat",
    name: "test key",
    prefix: "nf_pub00000",
    subjectId: "alice",
    subjectType: "user",
    tenantId: null,
    scopes: ["orders:read"],
    audience: [],
    resources: null,
    secretHash,
    hashAlg: "sha256",
    clientId: null,
    cnf: null,
    family: null,
    replacedBy: null,
    createdAt: now,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
    ...over,
  };
}

let store: MemoryTokenStore;
let auth: ApiKeyAuthenticator;
let hashLookups: number;
let marks: number;

beforeEach(() => {
  store = new MemoryTokenStore();
  hashLookups = 0;
  marks = 0;
  const findByHash = store.findByHash.bind(store);
  store.findByHash = (h: string) => {
    hashLookups++;
    return findByHash(h);
  };
  const markUsed = store.markUsed.bind(store);
  store.markUsed = (id, usage) => {
    marks++;
    return markUsed(id, usage);
  };
  auth = new ApiKeyAuthenticator(
    fakeContainer({ tokenStore: store, users: provider }),
    { prefix: PREFIX, lastUsedThrottleS: 60 },
  );
});

/** Sème une clé PAT valide dans le store, renvoie son token clair. */
async function seedKey(
  over: Partial<IAccessTokenRecord> = {},
): Promise<string> {
  const gen = generateApiKey(PREFIX);
  await store.put(patRecord(gen.secretHash, over));
  return gen.token;
}

describe("ApiKeyAuthenticator — extraction", () => {
  const ctx = (a?: string): ContextType =>
    ({
      request: { headers: a ? { authorization: a } : {} },
    }) as unknown as ContextType;

  it("supports : Bearer nf_… oui ; JWT a.b.c non ; Basic non ; rien non", () => {
    assert.equal(auth.supports(ctx()), false);
    assert.equal(auth.supports(ctx("Basic xxx")), false);
    assert.equal(auth.supports(ctx("Bearer abc.def.ghi")), false);
    assert.equal(auth.supports(ctx("Bearer nf_abcdef")), true);
    assert.equal(auth.supports(ctx("bearer nf_abcdef")), true);
  });

  it("createToken : type apikey, credential brut, challenge Bearer", async () => {
    const t = await auth.createToken(ctx("Bearer nf_raw"));
    assert.equal(t.type, "apikey");
    assert.equal(t.getCredentials(), "nf_raw");
    assert.equal(auth.challenge(), "Bearer");
  });
});

describe("ApiKeyAuthenticator — clé valide", () => {
  it("promeut : user résolu, scopes posés, apiKeyId/tenantId en attribut", async () => {
    const token = await seedKey({ scopes: ["orders:read", "orders:write"] });
    const t = await auth.authenticate(new UserToken("apikey", token));
    assert.equal(t.isAuthenticated(), true);
    assert.equal(t.getUser().identifier, "alice");
    assert.deepEqual(t.getScopes(), ["orders:read", "orders:write"]);
    assert.equal(t.getAttribute<string>("apiKeyId")?.startsWith("id-"), true);
  });

  it("met à jour lastUsedAt (markUsed) au premier usage", async () => {
    const token = await seedKey();
    const before = (await store.findBySubject("alice"))[0]!;
    assert.equal(before.lastUsedAt, null);
    await auth.authenticate(new UserToken("apikey", token));
    const after = (await store.findBySubject("alice"))[0]!;
    assert.equal(typeof after.lastUsedAt, "number");
    assert.equal(marks, 1);
  });

  it("throttle : 2ᵉ usage dans la fenêtre → AUCUNE 2ᵉ écriture", async () => {
    const token = await seedKey({ lastUsedAt: Date.now() }); // déjà utilisée récemment
    await auth.authenticate(new UserToken("apikey", token));
    assert.equal(marks, 0); // fenêtre 60 s non dépassée
  });

  it("throttle = 0 → écrit à chaque usage", async () => {
    const noThrottle = new ApiKeyAuthenticator(
      fakeContainer({ tokenStore: store, users: provider }),
      { prefix: PREFIX, lastUsedThrottleS: 0 },
    );
    const token = await seedKey({ lastUsedAt: Date.now() });
    await noThrottle.authenticate(new UserToken("apikey", token));
    assert.equal(marks, 1);
  });
});

describe("ApiKeyAuthenticator — attaques de FORME (0 accès store)", () => {
  const reject = async (raw: string): Promise<void> => {
    await assert.rejects(
      () => auth.authenticate(new UserToken("apikey", raw)),
      (e: unknown) => {
        assert.ok(e instanceof AuthenticationError);
        assert.equal((e as AuthenticationError).code, 401);
        return true;
      },
    );
  };

  it("token vide → 401, store jamais interrogé", async () => {
    await reject("");
    assert.equal(hashLookups, 0);
  });

  it("préfixe absent → 401, 0 lookup", async () => {
    await reject("garbage-no-prefix");
    assert.equal(hashLookups, 0);
  });

  it("mauvais préfixe → 401, 0 lookup", async () => {
    const foreign = generateApiKey("acme").token;
    await reject(foreign);
    assert.equal(hashLookups, 0);
  });

  it("CRC altéré → 401, 0 lookup (anti-DoS prouvé)", async () => {
    const g = generateApiKey(PREFIX);
    const i = 30;
    const swap = g.token[i] === "A" ? "B" : "A";
    await reject(`${g.token.slice(0, i)}${swap}${g.token.slice(i + 1)}`);
    assert.equal(hashLookups, 0);
  });

  it("longueur invalide → 401, 0 lookup", async () => {
    await reject(`${generateApiKey(PREFIX).token}EXTRA`);
    assert.equal(hashLookups, 0);
  });
});

describe("ApiKeyAuthenticator — attaques sur l'ÉTAT (message uniforme)", () => {
  const expectInvalid = async (token: string): Promise<void> => {
    await assert.rejects(
      () => auth.authenticate(new UserToken("apikey", token)),
      (e: unknown) => {
        assert.ok(e instanceof AuthenticationError);
        assert.equal((e as AuthenticationError).code, 401);
        assert.equal((e as Error).message, "Invalid token"); // anti-énumération
        return true;
      },
    );
  };

  it("clé bien formée mais inconnue → 401 (1 lookup, rien trouvé)", async () => {
    await expectInvalid(generateApiKey(PREFIX).token);
    assert.equal(hashLookups, 1);
  });

  it("clé révoquée → 401", async () =>
    expectInvalid(await seedKey({ revokedAt: Date.now() })));

  it("clé expirée → 401", async () =>
    expectInvalid(await seedKey({ expiresAt: Date.now() - 1000 })));

  it("kind refresh (pas un PAT) → 401", async () =>
    expectInvalid(await seedKey({ kind: "refresh" })));

  it("porteur banni en masse (createdAt < invalidBefore) → 401", async () => {
    const token = await seedKey({ createdAt: Date.now() - 10_000 });
    await store.revokeAllForSubject("alice", Date.now());
    await expectInvalid(token);
  });

  it("sujet disparu → 401", async () =>
    expectInvalid(await seedKey({ subjectId: "ghost" })));
  it("sujet verrouillé → 401", async () =>
    expectInvalid(await seedKey({ subjectId: "banned" })));
  it("sujet inactif → 401", async () =>
    expectInvalid(await seedKey({ subjectId: "inactive" })));
});

describe("ApiKeyAuthenticator — câblage manquant = Error (pas 401 masqué)", () => {
  it("store absent → Error (firewall logge ERROR + 401 fail-closed)", async () => {
    const broken = new ApiKeyAuthenticator(fakeContainer({ users: provider }), {
      prefix: PREFIX,
      lastUsedThrottleS: 60,
    });
    await assert.rejects(
      () =>
        broken.authenticate(
          new UserToken("apikey", generateApiKey(PREFIX).token),
        ),
      (e: unknown) => !(e instanceof AuthenticationError),
    );
  });
});
