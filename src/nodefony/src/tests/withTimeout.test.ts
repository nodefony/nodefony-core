/// <reference types="node" />
/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Résilience de boot — util withTimeout / TimeoutError
 */

import { expect } from "chai";
import { withTimeout, TimeoutError } from "../runtime/withTimeout";

describe("withTimeout", () => {
  it("résout avec la valeur si la promesse se règle avant le délai", async () => {
    const r = await withTimeout(Promise.resolve(42), 1000);
    expect(r).to.equal(42);
  });

  it("rejette TimeoutError si le délai est dépassé", async () => {
    const slow = new Promise<string>((res) =>
      setTimeout(() => res("tard"), 100),
    );
    let err: unknown;
    try {
      await withTimeout(slow, 10, "op");
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(TimeoutError);
    expect((err as TimeoutError).timeoutMs).to.equal(10);
    expect((err as Error).message).to.contain("op");
  });

  it("propage l'erreur d'origine si la promesse rejette avant le délai", async () => {
    const boom = Promise.reject(new Error("boom"));
    let err: unknown;
    try {
      await withTimeout(boom, 1000);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.equal("boom");
    expect(err).to.not.be.instanceOf(TimeoutError);
  });

  it("ms <= 0 → pas de garde, attend la promesse normalement", async () => {
    const r = await withTimeout(Promise.resolve("ok"), 0);
    expect(r).to.equal("ok");
  });

  it("un rejet APRÈS le timeout ne devient pas un unhandledRejection", async () => {
    let unhandled: unknown;
    const onUnhandled = (e: unknown) => {
      unhandled = e;
    };
    process.on("unhandledRejection", onUnhandled);
    const slowReject = new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error("late")), 30),
    );
    let err: unknown;
    try {
      await withTimeout(slowReject, 5);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(TimeoutError);
    // laisser le rejet tardif se produire puis vérifier qu'il a été avalé
    await new Promise((r) => setTimeout(r, 50));
    process.removeListener("unhandledRejection", onUnhandled);
    expect(unhandled).to.equal(undefined);
  });
});
