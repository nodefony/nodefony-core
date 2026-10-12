import assert from "node:assert/strict";
import {
  cascadeUserRevocation,
  registerUserRevocationCascade,
  usersEventBusNotice,
} from "../../nodefony/src/admin/userRevocationCascade";
import { EventEmitter } from "node:events";
import { USER_CREATED_EVENT, USER_REVOKED_EVENT } from "@nodefony/user";
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

describe("registerUserRevocationCascade — abonné UNE fois au bus du kernel (#589)", () => {
  // Le service `users` émet sur le kernel ; security s'y abonne au boot, avant
  // tout compte créé (ceux semés au démarrage compris).
  function onKernel() {
    const factors = factorsCtn();
    const kernel = new EventEmitter();
    registerUserRevocationCascade(kernel, factors.container);
    return { ...factors, kernel };
  }

  it("🔴 création sous un identifiant déjà porteur de facteurs → retirés", async () => {
    const { kernel, totpDisabled, passkeys } = onKernel();
    const [purge] = kernel.listeners(USER_CREATED_EVENT);
    // `listeners()` rend des `Function` : la promesse se reprend par `Promise.resolve`.
    await Promise.resolve(purge!({ id: "u2", identifier: "bob@x" }));
    assert.deepEqual(totpDisabled, ["bob@x"]);
    assert.deepEqual(
      [...passkeys.keys()],
      ["c3"],
      "les passkeys d'alice restent",
    );
  });

  it("un écouteur par événement, et chacun rend sa promesse (émetteur qui attend)", async () => {
    const { kernel } = onKernel();
    assert.equal(kernel.listenerCount(USER_CREATED_EVENT), 1);
    assert.equal(kernel.listenerCount(USER_REVOKED_EVENT), 1);
    const [revoke] = kernel.listeners(USER_REVOKED_EVENT);
    assert.ok(revoke!(evt("deleted")) instanceof Promise);
  });
});

describe("usersEventBusNotice — un service `users` qui n'atteint pas le kernel se SIGNALE", () => {
  const kernel = {};
  const lookup = (users: unknown) => ({
    get: (n: string) => (n === "users" ? users : undefined),
  });

  it("🔴 service construit sans container (kernel nul) → avis", () => {
    const notice = usersEventBusNotice(lookup({ kernel: null }), kernel);
    assert.equal(notice?.code, "USERS_SERVICE_WITHOUT_KERNEL");
    assert.equal(notice?.level, "warning");
  });

  it("service câblé sur CE kernel → rien", () => {
    assert.equal(usersEventBusNotice(lookup({ kernel }), kernel), null);
  });

  it("pas de service `users` → rien (une application peut s'en passer)", () => {
    assert.equal(usersEventBusNotice(lookup(undefined), kernel), null);
  });
});
