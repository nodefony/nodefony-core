/// <reference types="node" />
/**
 * Arrêt du trafic (ADR-0027 D2) : `HttpKernel.drainTraffic` congédie les
 * connexions longues (étape `dismiss`), ATTEND la fin de ce congé, puis draine
 * les serveurs (étape `drain`). Les étapes d'un même temps tournent ensemble ;
 * un échec n'arrête pas les autres.
 */
import { describe, expect, it } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import HttpKernel from "../../service/http-kernel";

function makeKernel(): HttpKernel {
  const module = {
    container: new Container(),
    notificationsCenter: new Event(),
    options: {
      http: { responseTimeout: 1_000 },
      https: { responseTimeout: 1_000 },
      websocket: { closeTimeout: 1_000 },
      websocketSecure: { closeTimeout: 1_000 },
      rateLimit: { enabled: false, windowS: 60, max: 1, maxTracked: 10 },
    },
  } as unknown as Module;
  // Rate-limit désactivé et aucun `onReady` : aucun minuteur à arrêter.
  return new HttpKernel(module);
}

const tick = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe("HttpKernel.drainTraffic — ordre de l'arrêt du trafic", () => {
  it("le drain des serveurs ne commence qu'une fois le congé des WebSocket FINI", async () => {
    const k = makeKernel();
    const order: string[] = [];
    k.addShutdownStep("drain", () => {
      order.push("drain");
    });
    k.addShutdownStep("dismiss", async () => {
      order.push("1001:début");
      await tick(15);
      order.push("1001:fin");
    });
    await k.drainTraffic();
    expect(order).toEqual(["1001:début", "1001:fin", "drain"]);
  });

  it("les serveurs se drainent ensemble, pas l'un après l'autre", async () => {
    const k = makeKernel();
    const started: string[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    k.addShutdownStep("drain", async () => {
      started.push("http");
      await gate;
    });
    k.addShutdownStep("drain", async () => {
      started.push("https");
      await gate;
    });
    const done = k.drainTraffic();
    await tick(5);
    expect(started).toEqual(["http", "https"]);
    release();
    await done;
  });

  it("un congé qui échoue n'empêche ni les autres ni le drain", async () => {
    const k = makeKernel();
    const ran: string[] = [];
    k.addShutdownStep("dismiss", () => {
      throw new Error("ws");
    });
    k.addShutdownStep("dismiss", () => {
      ran.push("wss");
    });
    k.addShutdownStep("drain", () => Promise.reject(new Error("http")));
    k.addShutdownStep("drain", () => {
      ran.push("https");
    });
    await expect(k.drainTraffic()).resolves.toBeUndefined();
    expect(ran).toEqual(["wss", "https"]);
  });

  it("les flux longs reçoivent leur fin AVANT le drain, et le drain attend cette fin (ADR-0026 D8)", async () => {
    const k = makeKernel();
    const order: string[] = [];
    k.shutdownStreams = (): Promise<void> => {
      order.push("flux:début");
      return tick(15).then(() => {
        order.push("flux:fin");
      });
    };
    k.addShutdownStep("drain", () => {
      order.push("drain");
    });
    await k.drainTraffic();
    expect(order).toEqual(["flux:début", "flux:fin", "drain"]);
  });

  it("sans serveur inscrit (commande console), l'arrêt du trafic ne fait rien", async () => {
    const k = makeKernel();
    await expect(k.drainTraffic()).resolves.toBeUndefined();
  });
});
