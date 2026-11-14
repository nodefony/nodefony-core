/// <reference types="node" />
/**
 * Phases de l'arrêt vues par @nodefony/http, sur un noyau RÉEL (ADR-0027) :
 * ce qui sert le trafic passe à `onDrain`, ce qui libère une ressource à
 * `onTerminate` — jamais l'inverse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliKernel, Kernel } from "nodefony";
import type { Module } from "nodefony";
import ReverseProxy from "../../service/reverse-proxy";

let origQuit: typeof CliKernel.quit;
beforeEach(() => {
  origQuit = CliKernel.quit;
  Object.defineProperty(CliKernel, "quit", {
    value: () => {},
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(CliKernel, "quit", {
    value: origQuit,
    configurable: true,
    writable: true,
  });
});

describe("arrêt — proxy inverse", () => {
  it("les pools vers l'amont survivent au drain : un relais en vol le finit sur son pool", async () => {
    const kernel = new Kernel("development", null, { log: { active: false } });
    const proxy = new ReverseProxy({
      container: kernel.container,
      options: { proxy: { mounts: {} } },
    } as unknown as Module);
    const closeAll = vi.spyOn(proxy, "closeAll");
    let closedDuringDrain: boolean | null = null;
    // Le drain des serveurs : les relais en vol s'y terminent.
    kernel.once("onDrain", async () => {
      await new Promise((r) => setTimeout(r, 5));
      closedDuringDrain = closeAll.mock.calls.length > 0;
    });
    await kernel.terminate(0);
    expect(closedDuringDrain).toBe(false);
    expect(closeAll).toHaveBeenCalledTimes(1);
  });
});
