/**
 * Changement de mot de passe : la session volée doit tomber MÊME SI la
 * suppression des sessions échoue (#635).
 *
 * Ce que ce banc protège : la coupure des accès au changement de mot de passe
 * reposait sur une suppression best-effort (`destroyByUser`). Une base occupée
 * (`SQLITE_BUSY`), un store injoignable, ou une requête en vol sur un autre
 * processus qui réécrit la session qu'on vient d'effacer — et la session
 * survivait, pendant que l'opération affichait « révoqués ».
 *
 * La règle qui ferme le trou : le compte porte une version de ses identifiants,
 * incrémentée par le changement de mot de passe ; la session retient celle
 * qu'elle a lue à l'ouverture, et `isBoundToAccount` compare les deux à chaque
 * requête. La suppression redevient un nettoyage, plus une garantie.
 */
import assert from "node:assert/strict";
import type { ContextType } from "@nodefony/http";
import type { Container } from "nodefony";
import { InMemoryUserRepository, UserService } from "@nodefony/user";
import type { IPasswordEncoder, IUser } from "@nodefony/user";
import { SessionAuthenticator } from "../../nodefony/src/authenticator/SessionAuthenticator";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { registerUserRevocationCascade } from "../../nodefony/src/admin/userRevocationCascade";
import {
  ACCOUNT_ID_KEY,
  CREDENTIALS_VERSION_KEY,
  credentialsVersionOf,
  isBoundToAccount,
} from "../../nodefony/src/accountBinding";

const encoder: IPasswordEncoder = {
  supports: (hash) => hash.startsWith("h:"),
  hash: (plain) => Promise.resolve(`h:${plain}`),
  verify: (plain, hash) => Promise.resolve(hash === `h:${plain}`),
  needsRehash: () => false,
};

const account = (credentialsVersion?: number | null): IUser => ({
  id: "u1",
  identifier: "bob@x",
  roles: [],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
  ...(credentialsVersion === undefined ? {} : { credentialsVersion }),
});

describe("isBoundToAccount — version des identifiants (#635)", () => {
  it("absente des deux côtés → liée (compte et artefact antérieurs à la règle)", () => {
    assert.equal(isBoundToAccount(account(), "u1", undefined), true);
  });
  it("`null` sur le compte vaut 0", () => {
    assert.equal(isBoundToAccount(account(null), "u1", 0), true);
  });
  it("même version → liée", () => {
    assert.equal(isBoundToAccount(account(3), "u1", 3), true);
  });
  it("🔴 artefact à une version ANTÉRIEURE → refusé", () => {
    assert.equal(isBoundToAccount(account(3), "u1", 2), false);
  });
  it("🔴 artefact sans version, compte qui a changé de mot de passe → refusé", () => {
    assert.equal(isBoundToAccount(account(1), "u1", undefined), false);
  });
  it("🔴 version d'un autre type (« 1 ») → refusée, jamais convertie", () => {
    assert.equal(isBoundToAccount(account(1), "u1", "1"), false);
  });
  it("la liaison au compte reste exigée (#139)", () => {
    assert.equal(isBoundToAccount(account(1), "u-other", 1), false);
  });
});

/** Contexte minimal : une session reprise, son principal et son `metaBag`. */
function sessionContext(
  identifier: string,
  bag: Record<string, unknown>,
): ContextType {
  return {
    session: { user: identifier, getMetaBag: (key: string) => bag[key] },
  } as unknown as ContextType;
}

describe("SessionAuthenticator — changement de mot de passe, suppression EN ÉCHEC (#635)", () => {
  const PASSWORD = "correct-horse-battery-staple-1";
  const NEXT = "correct-horse-battery-staple-2";

  async function setup() {
    const users = new UserService(new InMemoryUserRepository(), encoder);
    let destroyAttempts = 0;
    // Les deux briques de la cascade lèvent : rien n'est supprimé.
    const container = {
      get: (name: string) => {
        if (name === "sessions") {
          return {
            destroyByUser: async () => {
              destroyAttempts += 1;
              throw new Error("SQLITE_BUSY: database is locked");
            },
          };
        }
        if (name === "tokenStore") {
          return {
            revokeAllForSubject: async () => {
              throw new Error("store down");
            },
          };
        }
        return undefined;
      },
    } as unknown as Container;
    // Service sans kernel : il émet sur son propre bus — l'abonnement s'y pose.
    registerUserRevocationCascade(users, container);
    const created = await users.createUser({
      identifier: "bob@x",
      plainPassword: PASSWORD,
    });
    const authenticator = new SessionAuthenticator(() => users);
    // Ce que pose `AuthFlow.#openSession` à la connexion.
    const opened = (user: IUser) => ({
      [ACCOUNT_ID_KEY]: user.id,
      [CREDENTIALS_VERSION_KEY]: credentialsVersionOf(user),
    });
    const present = async (bag: Record<string, unknown>) =>
      authenticator.authenticate(
        await authenticator.createToken(sessionContext("bob@x", bag)),
      );
    return {
      users,
      created,
      opened,
      present,
      destroyAttempts: () => destroyAttempts,
    };
  }

  it("🔴 session ouverte à N → 401 dès que le compte passe à N+1, suppression en échec", async () => {
    const { users, created, opened, present, destroyAttempts } = await setup();
    const stolen = opened(created);
    // Avant : la session ouvre le compte.
    const before = await present(stolen);
    assert.equal(before.getUser().identifier, "bob@x");

    // La création a déjà purgé (en échec) l'identifiant : on compte l'écart.
    const attemptsBefore = destroyAttempts();
    await users.changePassword(created.id, NEXT);
    assert.equal(
      destroyAttempts() - attemptsBefore,
      1,
      "la cascade a bien tenté — et échoué — de supprimer les sessions",
    );
    await assert.rejects(() => present(stolen), AuthenticationError);
  });

  it("une session ouverte APRÈS le changement passe", async () => {
    const { users, created, opened, present } = await setup();
    const updated = await users.changePassword(created.id, NEXT);
    assert.ok(updated);
    assert.equal(updated.credentialsVersion, 1);
    const fresh = await present(opened(updated));
    assert.equal(fresh.getUser().identifier, "bob@x");
  });

  it("🔴 hash écrit directement (`updateOne({ password })`) → même coupure", async () => {
    const { users, created, opened, present } = await setup();
    const stolen = opened(created);
    await users.updateOne({ id: created.id }, { password: "h:direct" });
    await assert.rejects(() => present(stolen), AuthenticationError);
  });

  it("session antérieure à la règle (sans version), compte jamais changé → passe", async () => {
    const { created, present } = await setup();
    const legacy = { [ACCOUNT_ID_KEY]: created.id };
    const t = await present(legacy);
    assert.equal(t.getUser().identifier, "bob@x");
  });
});
