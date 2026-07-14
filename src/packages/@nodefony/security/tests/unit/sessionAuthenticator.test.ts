import assert from "node:assert/strict";
import type { IUser, IUserProvider } from "@nodefony/user";
import { UserNotFoundError } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import { SessionAuthenticator } from "../../nodefony/src/authenticator/SessionAuthenticator";
import type { IAuthenticator } from "../../nodefony/contracts/IAuthenticator";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";

/**
 * SessionAuthenticator (J3 — session BFF) — gates :
 * - supports() exige une session REPRISE porteuse d'un user (jamais il ne
 *   démarre une session lui-même).
 * - Re-fetch SYSTÉMATIQUE au provider : compte supprimé/verrouillé/désactivé
 *   entre deux requêtes → 401 au message UNIFORME (une session périmée ne
 *   révèle pas pourquoi).
 * - onSuccess pose l'identifiant (string) sur le contexte → le blob de session
 *   reste lié au principal courant (`saveSession`).
 */

const fakeUser = (
  identifier: string,
  {
    active = true,
    locked = false,
  }: { active?: boolean; locked?: boolean } = {},
): IUser => ({
  id: "00000000-0000-4000-8000-000000000002",
  identifier,
  roles: ["ROLE_USER"],
  hasRole: (r: string) => r === "ROLE_USER",
  isActive: () => active,
  isLocked: () => locked,
});

const providerOf = (users: Record<string, IUser>): IUserProvider =>
  ({
    loadUserByIdentifier: (identifier: string) => {
      const user = users[identifier];
      if (!user) {
        return Promise.reject(new UserNotFoundError(identifier));
      }
      return Promise.resolve(user);
    },
  }) as unknown as IUserProvider;

const sessionContext = (user?: string): ContextType =>
  ({
    session: user === undefined ? null : { user },
    user: null,
  }) as unknown as ContextType;

describe("SessionAuthenticator (P6 J3)", () => {
  it("supports : exige une session reprise AVEC user (string non vide)", () => {
    const auth = new SessionAuthenticator(() => providerOf({}));
    assert.equal(auth.name, "session");
    assert.equal(auth.supports(sessionContext()), false); // pas de session
    assert.equal(auth.supports(sessionContext("")), false); // session anonyme
    assert.equal(auth.supports(sessionContext("admin")), true);
  });

  it("authenticate : re-fetch au provider, token promu, credential effacé", async () => {
    const admin = fakeUser("admin");
    const auth = new SessionAuthenticator(() => providerOf({ admin }));
    const token = await auth.createToken(sessionContext("admin"));
    assert.equal(token.isAuthenticated(), false);
    const authenticated = await auth.authenticate(token);
    assert.equal(authenticated.isAuthenticated(), true);
    assert.equal(authenticated.getUser().identifier, "admin");
    assert.equal(authenticated.getCredentials(), null); // anti-fuite
  });

  it("session orpheline (compte supprimé) → 401 au message uniforme", async () => {
    const auth = new SessionAuthenticator(() => providerOf({}));
    const token = await auth.createToken(sessionContext("ghost"));
    await assert.rejects(auth.authenticate(token), (e: unknown) => {
      assert.ok(e instanceof AuthenticationError);
      assert.equal((e as AuthenticationError).message, "Invalid session");
      return true;
    });
  });

  it("compte verrouillé OU désactivé → même 401 uniforme (révocation immédiate)", async () => {
    for (const flags of [{ locked: true }, { active: false }]) {
      const user = fakeUser("admin", flags);
      const auth = new SessionAuthenticator(() => providerOf({ admin: user }));
      const token = await auth.createToken(sessionContext("admin"));
      await assert.rejects(auth.authenticate(token), (e: unknown) => {
        assert.equal((e as AuthenticationError).message, "Invalid session");
        return true;
      });
    }
  });

  it("onSuccess : pose l'identifiant (string) sur le contexte", async () => {
    const admin = fakeUser("admin");
    const auth = new SessionAuthenticator(() => providerOf({ admin }));
    const context = sessionContext("admin");
    const token = await auth.authenticate(await auth.createToken(context));
    await auth.onSuccess(context, token);
    assert.equal((context as { user?: unknown }).user, "admin");
  });

  it("pas de challenge déclaré : une session absente donne un 401 nu (pas de popup Basic)", () => {
    // Vu à travers le contrat (comme le firewall le voit) : `challenge?()` y est
    // un hook OPTIONNEL — on prouve que cet authenticator ne l'implémente pas.
    const auth: IAuthenticator = new SessionAuthenticator(() => providerOf({}));
    assert.equal(auth.challenge, undefined);
  });
});
