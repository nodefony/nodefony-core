/// <reference types="node" />
/**
 * `onRequest` du kernel : émis seulement si quelqu'un l'écoute, ou en debug.
 *
 * `Kernel.fire` journalise chaque émission en DEBUG AVANT d'émettre — une chaîne
 * formatée et un appel au journal, à chaque requête, pour un événement que
 * personne n'écoute. En debug, la trace reste : c'est elle qu'on vient y lire.
 */
import { expect } from "chai";
import { vi } from "vitest";
import HttpContext from "../../src/context/http/HttpContext.js";

function make(kernel: Record<string, unknown>) {
  const ctx = Object.create(HttpContext.prototype) as Record<string, unknown>;
  ctx.setTimeout = () => undefined;
  ctx.isRedirect = false;
  ctx.fire = () => true;
  ctx.setMetaData = () => undefined;
  ctx.kernel = kernel;
  ctx.resolver = { resolve: true, callController: async () => ctx };
  return ctx as unknown as HttpContext;
}

describe("HttpContext.handle — onRequest du kernel", () => {
  it("personne n'écoute, pas de debug : aucune émission", async () => {
    const fire = vi.fn(() => true);
    await make({ debug: false, listenerCount: () => 0, fire }).handle();
    expect(fire.mock.calls.length).to.equal(0);
  });

  it("un écouteur : émis", async () => {
    const fire = vi.fn(() => true);
    await make({ debug: false, listenerCount: () => 1, fire }).handle();
    expect(fire.mock.calls.length).to.equal(1);
  });

  it("debug : émis (la trace DEBUG reste)", async () => {
    const fire = vi.fn(() => true);
    await make({ debug: true, listenerCount: () => 0, fire }).handle();
    expect(fire.mock.calls.length).to.equal(1);
  });
});
