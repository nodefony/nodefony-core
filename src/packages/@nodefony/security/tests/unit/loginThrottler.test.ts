import assert from "node:assert/strict";
import type { IUser, IPasswordVerifier } from "@nodefony/user";
import { LoginThrottler } from "../../nodefony/src/throttle/LoginThrottler";
import { UserPasswordAuthenticator } from "../../nodefony/src/authenticator/UserPasswordAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { ThrottledError } from "../../nodefony/errors/ThrottledError";

/**
 * Throttling login (J2) — gates normatives NIST SP 800-63B §5.2.2 :
 * - backoff PROGRESSIF (exponentiel plafonné), JAMAIS de lockout dur ;
 * - clé = identifiant SAISI (existant ou non — zéro oracle d'énumération) ;
 * - reset au succès ; mémoire bornée (éviction).
 */

// Horloge contrôlée — tests déterministes sans attente réelle.
const clock = () => {
  let nowMs = 1_000_000;
  return {
    now: () => nowMs,
    advanceS: (s: number) => {
      nowMs += s * 1000;
    },
  };
};

describe("LoginThrottler — backoff NIST", () => {
  it("tolère freeAttempts échecs sans délai", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 3 }, c.now);
    for (let i = 0; i < 3; i++) {
      assert.equal(t.check("a@x.io"), 0);
      t.recordFailure("a@x.io");
    }
    assert.equal(t.check("a@x.io"), 0); // 3 échecs = encore autorisé
  });

  it("double le délai à chaque échec au-delà des essais libres", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 3, baseDelayS: 1 }, c.now);
    for (let i = 0; i < 4; i++) t.recordFailure("a@x.io");
    assert.equal(t.check("a@x.io"), 1); // 4e échec → 1 s
    c.advanceS(1);
    t.recordFailure("a@x.io");
    assert.equal(t.check("a@x.io"), 2); // 5e → 2 s
    c.advanceS(2);
    t.recordFailure("a@x.io");
    assert.equal(t.check("a@x.io"), 4); // 6e → 4 s
  });

  it("plafonne le délai à capDelayS (jamais de lockout infini)", () => {
    const c = clock();
    const t = new LoginThrottler(
      { freeAttempts: 1, baseDelayS: 1, capDelayS: 8 },
      c.now,
    );
    for (let i = 0; i < 20; i++) t.recordFailure("a@x.io");
    assert.equal(t.check("a@x.io"), 8);
  });

  it("le délai expire avec le temps (l'utilisateur légitime n'est jamais exclu)", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 1, baseDelayS: 5 }, c.now);
    t.recordFailure("a@x.io");
    t.recordFailure("a@x.io");
    assert.equal(t.check("a@x.io"), 5);
    c.advanceS(5);
    assert.equal(t.check("a@x.io"), 0);
  });

  it("recordSuccess remet le compteur à zéro", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 1, baseDelayS: 5 }, c.now);
    t.recordFailure("a@x.io");
    t.recordFailure("a@x.io");
    c.advanceS(5);
    t.recordSuccess("a@x.io");
    t.recordFailure("a@x.io"); // 1er échec d'une nouvelle série → libre
    assert.equal(t.check("a@x.io"), 0);
    assert.equal(t.trackedCount, 1);
  });

  it("les identifiants sont indépendants (clé = identifiant saisi)", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 1, baseDelayS: 5 }, c.now);
    t.recordFailure("victime@x.io");
    t.recordFailure("victime@x.io");
    assert.equal(t.check("victime@x.io"), 5);
    assert.equal(t.check("autre@x.io"), 0);
  });

  it("borne la mémoire : éviction des entrées inertes puis FIFO", () => {
    const c = clock();
    const t = new LoginThrottler({ freeAttempts: 3, maxTracked: 100 }, c.now);
    // Énumération de masse : 250 identifiants à 1 échec (jamais bloqués).
    for (let i = 0; i < 250; i++) t.recordFailure(`enum-${i}@x.io`);
    assert.ok(t.trackedCount <= 100, `tracked=${t.trackedCount} > 100`);
  });
});

// ─── Intégration authenticator : 429 + protection du coût de hash ────────────

const fakeUser = (identifier: string): IUser => ({
  id: "00000000-0000-4000-8000-000000000001",
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => true,
  isActive: () => true,
  isLocked: () => false,
});

const basicToken = (identifier: string, password: string): UserToken =>
  new UserToken("userpassword", { identifier, password });

describe("UserPasswordAuthenticator + LoginThrottler", () => {
  const make = (nowFn: () => number) => {
    let verifierCalls = 0;
    const verifier: IPasswordVerifier = {
      authenticate: (identifier: string, plain: string) => {
        verifierCalls += 1;
        return Promise.resolve(plain === "good" ? fakeUser(identifier) : null);
      },
    };
    const auth = new UserPasswordAuthenticator(
      () => verifier,
      new LoginThrottler({ freeAttempts: 2, baseDelayS: 10 }, nowFn),
    );
    return { auth, calls: () => verifierCalls };
  };

  it("throw ThrottledError(429) AVANT le verifier quand le backoff est actif", async () => {
    const c = clock();
    const { auth, calls } = make(c.now);
    // 3 échecs (freeAttempts=2 → le 3e arme un délai de 10 s).
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        auth.authenticate(basicToken("a@x.io", "bad")),
        AuthenticationError,
      );
    }
    const before = calls();
    await assert.rejects(
      auth.authenticate(basicToken("a@x.io", "good")),
      (e: unknown) =>
        e instanceof ThrottledError && e.code === 429 && e.retryAfterS > 0,
    );
    // Identifiant bloqué = AUCUN hash consommé (le throttle protège aussi du DoS argon2).
    assert.equal(calls(), before);
  });

  it("le succès après expiration remet le compteur à zéro", async () => {
    const c = clock();
    const { auth } = make(c.now);
    for (let i = 0; i < 3; i++) {
      await assert.rejects(auth.authenticate(basicToken("a@x.io", "bad")));
    }
    c.advanceS(10);
    const token = await auth.authenticate(basicToken("a@x.io", "good"));
    assert.equal(token.isAuthenticated(), true);
    // Nouvelle série d'échecs : repart des essais libres.
    await assert.rejects(
      auth.authenticate(basicToken("a@x.io", "bad")),
      AuthenticationError,
    );
  });

  it("un identifiant martelé ne bloque pas les autres", async () => {
    const c = clock();
    const { auth } = make(c.now);
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        auth.authenticate(basicToken("victime@x.io", "bad")),
      );
    }
    const token = await auth.authenticate(basicToken("autre@x.io", "good"));
    assert.equal(token.isAuthenticated(), true);
  });

  it("sans throttler (config disabled) : comportement J1 inchangé", async () => {
    const verifier: IPasswordVerifier = {
      authenticate: () => Promise.resolve(null),
    };
    const auth = new UserPasswordAuthenticator(() => verifier, null);
    for (let i = 0; i < 10; i++) {
      await assert.rejects(
        auth.authenticate(basicToken("a@x.io", "bad")),
        AuthenticationError,
      );
    }
  });
});
