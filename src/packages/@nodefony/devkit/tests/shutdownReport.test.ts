/**
 * Un outil MCP long (relevé de profil) rend son rapport partiel à l'arrêt :
 * pendant `onDrain`, quand les serveurs attendent encore la fin des réponses
 * en vol — jamais à `onTerminate`, où la connexion est déjà fermée (ADR-0027).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliKernel, Kernel } from "nodefony";
import type { Module } from "nodefony";
import DevkitService from "../nodefony/service/DevkitService";

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

describe("devkit — rapport partiel d'un outil MCP à l'arrêt", () => {
  it("part pendant le drain, avant toute libération de ressource", async () => {
    const kernel = new Kernel("development", null, { log: { active: false } });
    const devkit = new DevkitService({
      container: kernel.container,
      notificationsCenter: kernel.notificationsCenter,
      kernel,
      options: {},
    } as unknown as Module);
    const order: string[] = [];
    const onShutdown = devkit.mcpToolDeps().onShutdown;
    expect(onShutdown).toBeTypeOf("function");
    onShutdown?.(async () => {
      order.push("rapport");
    });
    // Une ressource inscrite APRÈS l'outil : à l'arrêt en ordre inverse, elle
    // passerait la première si le rapport était une libération.
    kernel.once("onTerminate", () => {
      order.push("libération");
    });
    await kernel.terminate(0);
    expect(order).toEqual(["rapport", "libération"]);
  });

  it("l'outil fini avant l'arrêt retire son écouteur", async () => {
    const kernel = new Kernel("development", null, { log: { active: false } });
    const devkit = new DevkitService({
      container: kernel.container,
      notificationsCenter: kernel.notificationsCenter,
      kernel,
      options: {},
    } as unknown as Module);
    let called = false;
    const off = devkit.mcpToolDeps().onShutdown?.(async () => {
      called = true;
    });
    off?.();
    await kernel.terminate(0);
    expect(called).toBe(false);
  });
});
