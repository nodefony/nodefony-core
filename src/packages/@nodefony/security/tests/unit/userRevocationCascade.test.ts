import assert from "node:assert/strict";
import {
  bindUserCreatedPurge,
  cascadeUserRevocation,
} from "../../nodefony/src/admin/userRevocationCascade";
import { EventEmitter } from "node:events";
import { USER_CREATED_EVENT } from "@nodefony/user";
import type { IUserRevokedEvent } from "@nodefony/user";
import type { Container } from "nodefony";

function evt(
  reason: IUserRevokedEvent["reason"] = "deleted",
): IUserRevokedEvent {
  return { id: "u1", identifier: "bob@x", tenantId: null, reason };
}

function ctn(parts: {
  destroyByUser?: (id: string) => Promise<number>;
  revokeAllForSubject?: (sub: string, ts: number) => Promise<void>;
}): Container {
  const sessions = parts.destroyByUser
    ? { destroyByUser: parts.destroyByUser }
    : undefined;
  const tokenStore = parts.revokeAllForSubject
    ? { revokeAllForSubject: parts.revokeAllForSubject }
    : undefined;
  return {
    get: (n: string) =>
      n === "sessions" ? sessions : n === "tokenStore" ? tokenStore : undefined,
  } as unknown as Container;
}

describe("cascadeUserRevocation (user révoqué → sessions + tokens)", () => {
  it("éjecte sessions ET tokens du porteur (par identifier + horloge injectée)", async () => {
    const destroyed: string[] = [];
    const revoked: Array<[string, number]> = [];
    await cascadeUserRevocation(
      ctn({
        destroyByUser: async (id) => {
          destroyed.push(id);
          return 2;
        },
        revokeAllForSubject: async (sub, ts) => {
          revoked.push([sub, ts]);
        },
      }),
      evt(),
      1000,
    );
    assert.deepEqual(destroyed, ["bob@x"]);
    assert.deepEqual(revoked, [["bob@x", 1000]]);
  });

  it("best-effort : service sessions absent → révoque quand même les tokens", async () => {
    const revoked: string[] = [];
    await cascadeUserRevocation(
      ctn({
        revokeAllForSubject: async (sub) => {
          revoked.push(sub);
        },
      }),
      evt(),
      1000,
    );
    assert.deepEqual(revoked, ["bob@x"]);
  });

  it("best-effort : une brique qui throw n'empêche pas l'autre", async () => {
    const revoked: string[] = [];
    await cascadeUserRevocation(
      ctn({
        destroyByUser: async () => {
          throw new Error("sessions down");
        },
        revokeAllForSubject: async (sub) => {
          revoked.push(sub);
        },
      }),
      evt(),
      1000,
    );
    assert.deepEqual(revoked, ["bob@x"]);
  });
});

/** Container portant les facteurs d'un compte (TOTP + passkeys) sous son identifier. */
function factorsCtn() {
  const totpDisabled: string[] = [];
  const passkeys = new Map<string, string>([
    ["c1", "bob@x"],
    ["c2", "bob@x"],
    ["c3", "alice@x"],
  ]);
  const container = {
    get: (n: string) => {
      if (n === "totp") {
        return {
          isEnabled: () => true,
          disable: async (id: string) => {
            totpDisabled.push(id);
          },
        };
      }
      if (n === "webauthn") {
        return {
          isEnabled: () => true,
          listUserCredentials: async (id: string) =>
            [...passkeys].filter(([, u]) => u === id).map(([c]) => ({ id: c })),
          removeUserCredential: async (id: string, c: string) =>
            passkeys.get(c) === id && passkeys.delete(c),
        };
      }
      return undefined;
    },
  } as unknown as Container;
  return { container, totpDisabled, passkeys };
}

describe("cascadeUserRevocation — facteurs du compte (#589)", () => {
  it("compte SUPPRIMÉ → retire son secret TOTP et ses passkeys, pas celles d'autrui", async () => {
    // Un compte recréé sous le même identifier hériterait sinon du second
    // facteur de l'ancien titulaire.
    const { container, totpDisabled, passkeys } = factorsCtn();
    await cascadeUserRevocation(container, evt("deleted"), 1000);
    assert.deepEqual(totpDisabled, ["bob@x"]);
    assert.deepEqual([...passkeys.keys()], ["c3"]);
  });

  for (const reason of ["disabled", "locked", "password_changed"] as const) {
    it(`compte ${reason} → GARDE ses facteurs (il les retrouve à la réactivation)`, async () => {
      const { container, totpDisabled, passkeys } = factorsCtn();
      await cascadeUserRevocation(container, evt(reason), 1000);
      assert.deepEqual(totpDisabled, []);
      assert.equal(passkeys.size, 3);
    });
  }

  it("best-effort : un TOTP qui throw n'empêche pas le retrait des passkeys", async () => {
    const { container, passkeys } = factorsCtn();
    const get = container.get.bind(container);
    const broken = {
      get: (n: string) =>
        n === "totp"
          ? {
              disable: async () => {
                throw new Error("store down");
              },
            }
          : get(n),
    } as unknown as Container;
    await cascadeUserRevocation(broken, evt("deleted"), 1000);
    assert.deepEqual([...passkeys.keys()], ["c3"]);
  });
});

describe("bindUserCreatedPurge — un compte NEUF n'hérite d'aucun facteur (#589)", () => {
  // Un compte qui vient de naître n'a rien enrôlé : tout facteur rangé sous son
  // identifiant appartient à un ancien titulaire — orphelins d'avant le
  // correctif compris.
  function withUsers() {
    const factors = factorsCtn();
    const users = new EventEmitter();
    const container = {
      get: (n: string) => (n === "users" ? users : factors.container.get(n)),
    } as unknown as Container;
    return { ...factors, container, users };
  }

  it("🔴 création sous un identifiant déjà porteur de facteurs → retirés", async () => {
    const { container, users, totpDisabled, passkeys } = withUsers();
    assert.equal(bindUserCreatedPurge(container), true);
    const [purge] = users.listeners(USER_CREATED_EVENT);
    await purge!({ id: "u2", identifier: "bob@x" });
    assert.deepEqual(totpDisabled, ["bob@x"]);
    assert.deepEqual(
      [...passkeys.keys()],
      ["c3"],
      "les passkeys d'alice restent",
    );
  });

  it("idempotent : deux abonnements = UN écouteur (sinon double purge par création)", () => {
    const { container, users } = withUsers();
    bindUserCreatedPurge(container);
    bindUserCreatedPurge(container);
    assert.equal(users.listenerCount(USER_CREATED_EVENT), 1);
  });

  it("sans service `users` (pas encore posé) → rien, et le dit", () => {
    const { container } = factorsCtn();
    assert.equal(bindUserCreatedPurge(container), false);
  });
});
