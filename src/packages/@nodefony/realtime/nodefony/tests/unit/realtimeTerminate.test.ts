import { afterEach, describe, expect, it, vi } from "vitest";
import { CliKernel, Kernel, PLATFORM_BUS_CHANNELS } from "nodefony";
import { Realtime } from "../../../index";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { registerBackplaneDriver } from "../../src/backplane/backplaneRegistry";
import type { IBackplane } from "../../interfaces/IBackplane";
import { presenceClient } from "../helpers/presenceClient";

/**
 * #760 lot D3 — l'arrêt du NOYAU fait partir la preuve de vie finale de la
 * présence répartie (ADR-0025 P5) : c'est le module qui branche
 * `hub.endPresence()` sur `onTerminate`. Vrai `Kernel`, vrai module, bus en
 * mémoire qui relève ce qui part.
 */
describe("#760 lot D3 — arrêt du noyau", () => {
  afterEach(() => {
    getRealtimeHub().clear();
    vi.restoreAllMocks();
  });

  it("🔴 `terminate()` du noyau : le dernier lot puis la preuve de vie FINALE partent sur le bus, rien après", async () => {
    // `terminate()` finit par `CliKernel.quit` → `process.exit` : neutralisé.
    vi.spyOn(CliKernel, "quit").mockImplementation(() => {});
    const sent: { channel: string; payload: unknown }[] = [];
    const bus: IBackplane = {
      originId: "pod-a",
      start: () => {},
      stop: () => {},
      publish: (channel, payload) => {
        sent.push({ channel, payload });
      },
      onMessage: () => {},
      describe: () => ({
        driver: "test",
        kind: "memory",
        originId: "pod-a",
        crossPod: true,
      }),
    };
    const hub = getRealtimeHub();
    hub.clear();
    hub.declareChannelPolicy("room:*", { presence: true }, null);
    hub.markBroadcastChannel("room:");
    // Bus posé AVANT le boot : la voie « instance fournie » du module.
    hub.setBackplane(bus);
    const kernel = new Kernel("development", null, { log: { active: false } });
    const module = new Realtime(kernel);
    await module.onKernelRegister();
    await module.onKernelBoot();
    presenceClient(hub, "room:1", "alice");

    await kernel.terminate(0);

    const ops = sent
      .filter(
        (m) =>
          m.channel === PLATFORM_BUS_CHANNELS.presence ||
          m.channel === PLATFORM_BUS_CHANNELS.presenceAlive,
      )
      .map((m) =>
        m.channel === PLATFORM_BUS_CHANNELS.presenceAlive
          ? (m.payload as { final?: boolean }).final === true
            ? "final"
            : "alive"
          : (m.payload as { op: string }).op,
      );
    // Le lot d'Alice part avec l'arrêt, puis la fin — en dernier.
    expect(ops).toContain("batch");
    expect(ops.at(-1)).toBe("final");
    expect(ops.filter((o) => o === "final")).toHaveLength(1);
  });

  it("🔴 bus créé PAR le module : arrêté APRÈS la preuve de vie finale, et le noyau ne sort qu'une fois cet arrêt fini", async () => {
    const steps: string[] = [];
    vi.spyOn(CliKernel, "quit").mockImplementation(() => {
      steps.push("quit");
    });
    const owned: IBackplane = {
      originId: "pod-a",
      start: () => {},
      // Un bus réseau rend la main plus tard : ce qui est émis est encore en vol.
      stop: () =>
        new Promise<void>((resolve) => {
          steps.push("stop");
          setTimeout(() => {
            steps.push("stopped");
            resolve();
          }, 20);
        }),
      publish: (channel, payload) => {
        if (
          channel === PLATFORM_BUS_CHANNELS.presenceAlive &&
          (payload as { final?: boolean }).final === true
        )
          steps.push("final");
      },
      onMessage: () => {},
      describe: () => ({
        driver: "test-owned",
        kind: "memory",
        originId: "pod-a",
        crossPod: true,
      }),
    };
    registerBackplaneDriver("test-owned", () => owned);
    const hub = getRealtimeHub();
    hub.clear();
    hub.declareChannelPolicy("room:*", { presence: true }, null);
    hub.markBroadcastChannel("room:");
    const kernel = new Kernel("development", null, { log: { active: false } });
    const module = new Realtime(kernel);
    // Le pilote vient de la config du module : c'est LUI qui crée le bus.
    module.options = { ...module.options, backplane: { driver: "test-owned" } };
    await module.onKernelRegister();
    await module.onKernelBoot();
    expect(hub.backplane).toBe(owned);
    presenceClient(hub, "room:1", "alice");

    await kernel.terminate(0);

    expect(steps).toEqual(["final", "stop", "stopped", "quit"]);
  });
});
