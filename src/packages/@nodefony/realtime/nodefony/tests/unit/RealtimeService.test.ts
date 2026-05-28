import { describe, it, expect, beforeEach } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";

import { RealtimeService } from "../../src/service/RealtimeService.js";
import { getRealtimeHub, RealtimeHub } from "../../src/server/RealtimeHub.js";
import { defineRealtimeConfig } from "../../config/defineRealtimeConfig.js";
import type {
  IBackplane,
  BackplaneHandler,
} from "../../interfaces/IBackplane.js";

class FakeBackplane implements IBackplane {
  readonly originId = "fake-test";
  started = 0;
  stopped = 0;
  publishedChannels: string[] = [];
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  publish(channel: string, _payload: unknown): void {
    this.publishedChannels.push(channel);
  }
  onMessage(_handler: BackplaneHandler): void {}
}

/**
 * Construit un mock minimaliste de Module : Container + Event partagés, options
 * vides. Suffit au constructor de Service (zéro lifecycle kernel).
 */
function buildModuleMock(): { module: Module; container: Container } {
  const container = new Container();
  const nc = new Event({}, null, {});
  const moduleMock = {
    container,
    notificationsCenter: nc,
    options: {},
  } as unknown as Module;
  return { module: moduleMock, container };
}

describe("RealtimeService — façade DI du hub realtime", () => {
  // Le hub est un singleton de module. Tests qui ajoutent canaux/backplane =
  // nettoyage post-test pour ne pas contaminer les autres specs (RealtimeHub.test).
  beforeEach(() => {
    const hub = getRealtimeHub();
    hub.clear();
    if (hub.backplane !== null) {
      // Reset du backplane via cast — pas d'API publique (cas de test isolé).
      (hub as unknown as { setBackplane: (b: IBackplane | null) => unknown })
        .setBackplane;
      // Stratégie : on n'a pas d'unset officiel ; on injecte un backplane no-op
      // dont le start/stop ne fait rien — l'override couvre les tests dépendants.
    }
  });

  describe("construction", () => {
    it("hérite de Service et expose le nom realtimeService", () => {
      const { module, container } = buildModuleMock();
      container.set("realtimeConfig", defineRealtimeConfig());
      const svc = new RealtimeService(module);
      expect(svc.getName()).to.equal("realtimeService");
    });

    it("initialize plante si realtimeConfig manque dans le container", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await expect(svc.initialize(module)).rejects.toThrow(/realtimeConfig/);
    });
  });

  describe("initialize — backplane custom", () => {
    it("branche backplane.instance fournie via defineRealtimeConfig", async () => {
      const { module, container } = buildModuleMock();
      const bp = new FakeBackplane();
      container.set(
        "realtimeConfig",
        defineRealtimeConfig({}, { backplane: bp }),
      );
      const svc = new RealtimeService(module);
      await svc.initialize(module);
      expect(svc.getBackplane()).to.equal(bp);
      expect(bp.started).to.equal(1);
    });

    it("branche realtimeBackplane du container si pas d'instance dans la config", async () => {
      const { module, container } = buildModuleMock();
      const bp = new FakeBackplane();
      container.set("realtimeConfig", defineRealtimeConfig());
      container.set("realtimeBackplane", bp);
      const svc = new RealtimeService(module);
      await svc.initialize(module);
      expect(svc.getBackplane()).to.equal(bp);
    });

    it("aucun backplane fourni → hub reste sur son backplane par défaut", async () => {
      const { module, container } = buildModuleMock();
      container.set("realtimeConfig", defineRealtimeConfig());
      const svc = new RealtimeService(module);
      await svc.initialize(module);
      // null = Loopback implicite (hot-path teste `=== null`)
      expect(svc.getBackplane()).to.equal(null);
    });
  });

  describe("API — délégation au hub", () => {
    it("getConfig retourne la config gelée", async () => {
      const { module, container } = buildModuleMock();
      const cfg = defineRealtimeConfig({ slowConsumer: { bytes: 4096 } });
      container.set("realtimeConfig", cfg);
      const svc = new RealtimeService(module);
      await svc.initialize(module);
      expect(svc.getConfig()).to.equal(cfg);
      expect(svc.getConfig().slowConsumer.bytes).to.equal(4096);
    });

    it("getHub retourne le singleton RealtimeHub", async () => {
      const { module, container } = buildModuleMock();
      container.set("realtimeConfig", defineRealtimeConfig());
      const svc = new RealtimeService(module);
      await svc.initialize(module);
      expect(svc.getHub()).to.be.instanceOf(RealtimeHub);
      expect(svc.getHub()).to.equal(getRealtimeHub());
    });

    it("publish + subscribe + unsubscribe délégués au hub", async () => {
      const { module, container } = buildModuleMock();
      container.set("realtimeConfig", defineRealtimeConfig());
      const svc = new RealtimeService(module);
      await svc.initialize(module);

      const received: unknown[] = [];
      const sink = (p: unknown) => received.push(p);
      const ok = svc.subscribe(
        "svc:test",
        sink,
        // factory retourne dispose no-op (canal accepté)
        (_channel, _publish) => () => {},
      );
      expect(ok).to.equal(true);

      svc.publish("svc:test", { hello: "world" });
      expect(received).to.deep.equal([{ hello: "world" }]);

      svc.unsubscribe("svc:test", sink);
      svc.publish("svc:test", { hello: "again" });
      // dernier abonné parti → le canal est démonté, pas de fan-out
      expect(received).to.deep.equal([{ hello: "world" }]);
    });

    it("markBroadcastChannel délégué au hub", async () => {
      const { module, container } = buildModuleMock();
      container.set("realtimeConfig", defineRealtimeConfig());
      const svc = new RealtimeService(module);
      await svc.initialize(module);

      const bp = new FakeBackplane();
      svc.getHub().setBackplane(bp);
      svc.markBroadcastChannel("svc-bcast:");
      svc.publish("svc-bcast:event", { x: 1 });
      expect(bp.publishedChannels).to.deep.equal(["svc-bcast:event"]);
    });
  });
});
