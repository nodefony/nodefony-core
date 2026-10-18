/**
 * Compte supprimé HORS du framework, puis recréé sous le même identifiant (#139).
 *
 * Ce que ce banc protège : un `DELETE FROM "User"` écrit à la main (console de
 * base, purge RGPD, script de reprise) n'émet aucun événement — la cascade de
 * révocation ne joue pas, et les sessions et jetons de l'ancien titulaire
 * restent rangés sous son `identifier`. Tant que le compte est absent, ils sont
 * inertes : l'authentificateur recharge l'identité et échoue. Mais dès qu'un
 * compte RENAÎT sous cet identifiant, l'identité se recharge à nouveau, et le
 * jeton de l'ancien titulaire ouvrirait le compte du nouveau.
 *
 * La règle qui ferme le trou est exacte, sans date à comparer : un compte qui
 * vient de naître n'a encore rien émis, donc tout artefact d'accès déjà rangé
 * sous son identifiant appartient à quelqu'un d'autre.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Container } from "nodefony";
import type { IUser } from "@nodefony/user";
import { USER_CREATED_EVENT } from "@nodefony/user";
import * as jose from "jose";
import { JwtAuthenticator } from "../../nodefony/src/authenticator/JwtAuthenticator";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { registerUserRevocationCascade } from "../../nodefony/src/admin/userRevocationCascade";
import type { IJwtRuntime } from "../../nodefony/src/token/jwtRuntime";

const RT: IJwtRuntime = {
  issuer: "https://test.nf",
  audiences: ["nf-api"],
  accessTtlS: 900,
  refreshTtlS: 604800,
  rotateRefresh: true,
  alg: "EdDSA",
};

const nowS = (): number => Math.floor(Date.now() / 1000);

/** Annuaire : `bob` existe — c'est le compte RECRÉÉ, l'ancien a disparu en SQL. */
const provider = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
    return {
      id: `u-${id}-2`,
      identifier: id,
      roles: ["ROLE_USER"],
      hasRole: () => false,
      isActive: () => true,
      isLocked: () => false,
    };
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

/** Sessions rangées par identifiant — la vue que la cascade consomme. */
function sessionsStore() {
  const byUser = new Map<string, number>();
  return {
    byUser,
    async destroyByUser(identifier: string): Promise<number> {
      const n = byUser.get(identifier) ?? 0;
      byUser.delete(identifier);
      return n;
    },
  };
}

let keystore: JwtKeystore;
let store: MemoryTokenStore;
let auth: JwtAuthenticator;
let signing: { key: CryptoKey; kid: string };
let sessions: ReturnType<typeof sessionsStore>;
let kernel: EventEmitter;

async function mint(sub: string, iat: number, uid: string): Promise<string> {
  return new jose.SignJWT({
    uid,
    iss: RT.issuer,
    aud: RT.audiences[0]!,
    sub,
    jti: `jti-${Math.random()}`,
    iat,
    exp: iat + 900,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: signing.kid, typ: "at+jwt" })
    .sign(signing.key);
}

/** Émet comme `UserService.create` : chaque écouteur rend sa promesse, attendue. */
async function emitCreated(identifier: string): Promise<void> {
  await Promise.all(
    kernel
      .listeners(USER_CREATED_EVENT)
      .map((l) => Promise.resolve(l({ id: "u-bob-2", identifier }))),
  );
}

beforeEach(async () => {
  keystore = new JwtKeystore({}, () => {});
  store = new MemoryTokenStore();
  signing = await keystore.getSigningKey();
  sessions = sessionsStore();
  const services: Record<string, unknown> = {
    jwtKeystore: keystore,
    tokenStore: store,
    users: provider,
    sessions,
  };
  const container = {
    get: (n: string): unknown => services[n],
  } as unknown as Container;
  auth = new JwtAuthenticator(container, RT);
  kernel = new EventEmitter();
  registerUserRevocationCascade(kernel, container);
});

describe("compte supprimé en SQL puis recréé — l'ancien accès ne passe pas (#139)", () => {
  it("🔴 le jeton de l'ancien titulaire n'ouvre pas le compte recréé", async () => {
    // Émis à l'ancien `bob`, encore dans sa durée de vie.
    const stale = await mint("bob", nowS() - 60, "u-bob-1");
    // `DELETE FROM "User"` à la main : aucun événement. Puis le compte renaît.
    await emitCreated("bob");
    await assert.rejects(
      () => auth.authenticate(new UserToken("jwt", stale)),
      AuthenticationError,
    );
  });

  it("🔴 les sessions de l'ancien titulaire sont détruites à la recréation", async () => {
    sessions.byUser.set("bob", 2);
    await emitCreated("bob");
    assert.equal(sessions.byUser.has("bob"), false);
  });

  it("le jeton émis JUSTE après la création reste valide (`iat` est en secondes)", async () => {
    // La création et la première connexion tombent dans la même seconde : un
    // seuil posé à la milliseconde rejetterait le jeton légitime du nouveau
    // titulaire, dont l'`iat` est tronqué à la seconde.
    await emitCreated("bob");
    const fresh = await mint("bob", nowS(), "u-bob-2");
    const t = await auth.authenticate(new UserToken("jwt", fresh));
    assert.equal(t.getUser()?.identifier, "bob");
  });

  it("les artefacts d'un AUTRE identifiant ne sont pas touchés", async () => {
    sessions.byUser.set("alice", 1);
    const aliceToken = await mint("alice", nowS() - 60, "u-alice-2");
    await emitCreated("bob");
    assert.equal(sessions.byUser.get("alice"), 1);
    const t = await auth.authenticate(new UserToken("jwt", aliceToken));
    assert.equal(t.getUser()?.identifier, "alice");
  });
});
