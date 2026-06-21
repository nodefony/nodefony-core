import assert from "node:assert/strict";
import { cascadeUserRevocation } from "../../nodefony/src/admin/userRevocationCascade";
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
