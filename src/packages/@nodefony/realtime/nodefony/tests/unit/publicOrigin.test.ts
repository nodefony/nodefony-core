/// <reference types="node" />
import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";

import { RealtimeService } from "../../src/service/RealtimeService.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { realtimeConnectSource } from "../../src/service/publicOrigin.js";
import { defineRealtimeConfig } from "../../config/defineModuleConfig.js";

type Fragment = Readonly<Record<string, readonly string[]>>;

/** Pare-feu réduit à ce que le module temps réel lui demande. */
class FirewallSpy {
  calls: Array<[string, Fragment]> = [];
  registerCspOrigins(moduleName: string, fragment: Fragment): void {
    this.calls.push([moduleName, fragment]);
  }
}

/** Décor : conteneur portant un noyau (émetteur) et, au choix, un pare-feu. */
function decor(
  config: Parameters<typeof defineRealtimeConfig>[0],
  withFirewall = true,
): { svc: RealtimeService; kernel: EventEmitter; firewall: FirewallSpy } {
  const container = new Container();
  const kernel = new EventEmitter();
  const firewall = new FirewallSpy();
  container.set("kernel", kernel);
  if (withFirewall) container.set("firewall", firewall);
  const moduleMock = {
    container,
    notificationsCenter: new Event({}, null, {}),
    options: {},
    config: defineRealtimeConfig(config),
  } as unknown as Module;
  return { svc: new RealtimeService(moduleMock), kernel, firewall };
}

describe("realtime.publicOrigin — la socket d'une autre origine se déclare dans connect-src (#699, ADR-0024 §C3)", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
  });

  it("déclare l'origine au pare-feu, une fois le noyau prêt", async () => {
    const { svc, kernel, firewall } = decor({
      publicOrigin: "wss://rt.example.com",
    });
    await svc.init(svc.module);
    // Le pare-feu compose sa politique à `onBoot` : rien avant `onReady`.
    expect(firewall.calls).toEqual([]);
    kernel.emit("onReady");
    expect(firewall.calls).toEqual([
      ["realtime", { "connect-src": ["wss://rt.example.com"] }],
    ]);
  });

  it("sans publicOrigin (socket sur l'origine de la page), ne déclare rien", async () => {
    const { svc, kernel, firewall } = decor({});
    await svc.init(svc.module);
    kernel.emit("onReady");
    expect(firewall.calls).toEqual([]);
  });

  it("module inerte (enabled:false) : ne déclare rien", async () => {
    const { svc, kernel, firewall } = decor({
      enabled: false,
      publicOrigin: "wss://rt.example.com",
    });
    await svc.init(svc.module);
    kernel.emit("onReady");
    expect(firewall.calls).toEqual([]);
  });

  it("sans pare-feu (application sans @nodefony/security), démarre sans rien déclarer", async () => {
    const { svc, kernel } = decor(
      { publicOrigin: "wss://rt.example.com" },
      false,
    );
    await svc.init(svc.module);
    expect(() => kernel.emit("onReady")).not.toThrow();
  });
});

describe("realtimeConnectSource — la source rendue couvre la socket", () => {
  it("garde ws/wss, convertit http → ws et https → wss", () => {
    expect(realtimeConnectSource("wss://rt.example.com")).toBe(
      "wss://rt.example.com",
    );
    expect(realtimeConnectSource("ws://127.0.0.1:5151")).toBe(
      "ws://127.0.0.1:5151",
    );
    // Une source `https://h` ne couvrirait PAS `wss://h` (CSP3, scheme-part match).
    expect(realtimeConnectSource("https://rt.example.com")).toBe(
      "wss://rt.example.com",
    );
    expect(realtimeConnectSource("http://rt.example.com:8080")).toBe(
      "ws://rt.example.com:8080",
    );
  });

  it("garde un port non standard, omet le port par défaut", () => {
    expect(realtimeConnectSource("https://rt.example.com:8443")).toBe(
      "wss://rt.example.com:8443",
    );
    expect(realtimeConnectSource("wss://rt.example.com:443")).toBe(
      "wss://rt.example.com",
    );
  });
});

describe("realtime.publicOrigin — le schéma refuse ce qui n'est pas une origine nue", () => {
  for (const bad of [
    "wss://rt.example.com/socket",
    "wss://*.example.com",
    "*",
    "rt.example.com",
    "ftp://rt.example.com",
    "wss://user:secret@rt.example.com",
  ]) {
    it(`refuse « ${bad} »`, () => {
      expect(() => defineRealtimeConfig({ publicOrigin: bad })).toThrow(
        /publicOrigin/,
      );
    });
  }
});
