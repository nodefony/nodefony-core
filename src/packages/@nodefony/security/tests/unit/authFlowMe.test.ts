import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { UserNotFoundError } from "@nodefony/user";
import { AuthFlow } from "../../nodefony/service/authFlow";

/**
 * `AuthFlow.me()` — la porte de `/me`, HORS zone : mêmes contrôles que le
 * `SessionAuthenticator`, donc même geste face à une session PÉRIMÉE. Elle
 * rend `null` (200 `{ user: null }`) ET détruit la session, cookie compris —
 * sinon le navigateur la renvoie à chaque requête. Une panne de la source
 * d'identité, elle, remonte et ne purge rien.
 */

function flowWith(loadUserByIdentifier: (id: string) => Promise<never>) {
  const container = new Container();
  container.set("kernel", { container, once() {} });
  container.set("users", { loadUserByIdentifier });
  return new AuthFlow({
    container,
    notificationsCenter: false,
    options: {},
  } as unknown as Module);
}

function sessionOf(user: string): {
  context: ContextType;
  destroyed: boolean[];
} {
  const destroyed: boolean[] = [];
  const context = {
    session: {
      user,
      getMetaBag: () => undefined,
      destroy: (cookieDelete?: boolean) => {
        destroyed.push(cookieDelete === true);
        return Promise.resolve(true);
      },
    },
  } as unknown as ContextType;
  return { context, destroyed };
}

describe("AuthFlow.me — session périmée", () => {
  it("🔴 compte disparu : rend null ET détruit la session, cookie compris", async () => {
    const flow = flowWith((id) => Promise.reject(new UserNotFoundError(id)));
    const { context, destroyed } = sessionOf("ghost");
    assert.equal(await flow.me(context), null);
    assert.deepEqual(destroyed, [true]);
  });

  it("🔴 une PANNE de la source d'identité remonte, et la session survit", async () => {
    const down = new Error("base injoignable");
    const flow = flowWith(() => Promise.reject(down));
    const { context, destroyed } = sessionOf("admin");
    await assert.rejects(
      () => flow.me(context),
      (e: unknown) => e === down,
    );
    assert.deepEqual(destroyed, []);
  });
});
