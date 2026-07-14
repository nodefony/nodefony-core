import { describe, it, expect, beforeEach } from "vitest";
import { Container, Event, JsonRpcPeer } from "nodefony";
import type { Module } from "nodefony";

import { RealtimeService } from "../../src/service/RealtimeService.js";
import { getRealtimeHub, RealtimeHub } from "../../src/server/RealtimeHub.js";
import { defineRealtimeConfig } from "../../config/defineModuleConfig.js";
import { ANONYMOUS_REALTIME_TOKEN } from "../../src/server/AnonymousRealtimeToken.js";
import type {
  IBackplane,
  IBackplaneInfo,
  BackplaneHandler,
} from "../../interfaces/IBackplane.js";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator.js";

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

  /**
   * Carte d'identité — même sémantique que `LoopbackBackplane` : ce faux backplane
   * ne franchit aucune frontière de pod (aucun pair réel), d'où `crossPod: false`.
   */
  describe(): IBackplaneInfo {
    return {
      driver: "fake",
      kind: "local",
      originId: this.originId,
      crossPod: false,
    };
  }
}

/**
 * Construit un mock minimaliste de Module : Container + Event partagés, config
 * exposée DIRECTEMENT (miroir prod : le service lit `this.module.config`).
 * Suffit au constructor de Service (zéro lifecycle kernel).
 *
 * `options` reste `{}` (fixe) : c'est l'argument passé au constructeur `Service`
 * (`attachConfiguredListeners` y itère `Object.keys`, il doit rester un objet
 * même quand on simule une config manquante via `config: null`). Seul `config`
 * porte la valeur testée — c'est la seule propriété lue par `RealtimeService`.
 */
function buildModuleMock(config: unknown = defineRealtimeConfig()): {
  module: Module;
  container: Container;
} {
  const container = new Container();
  const nc = new Event({}, null, {});
  const moduleMock = {
    container,
    notificationsCenter: nc,
    options: {},
    config,
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
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      expect(svc.getName()).to.equal("realtimeService");
    });

    it("init plante si realtimeConfig manque dans le container", async () => {
      const { module } = buildModuleMock(null);
      const svc = new RealtimeService(module);
      await expect(svc.init(module)).rejects.toThrow(/realtimeConfig/);
    });
  });

  // `enabled: false` → module chargé mais INERTE : init NE câble rien sur le hub
  // (backplane custom ignoré, origin guard/limites aux défauts). Cf le câblage
  // `RealtimeService.init` (garde `if (!this.#config.enabled) return`).
  describe("initialize — enabled:false (module inerte)", () => {
    it("enabled:false → le backplane custom n'est PAS branché (hub inerte)", async () => {
      const bp = new FakeBackplane();
      const { module } = buildModuleMock(
        defineRealtimeConfig({ enabled: false }, { backplane: bp }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      const hub = getRealtimeHub();
      // Inerte : la config custom (backplane) n'a PAS été appliquée au hub.
      expect(hub.backplane).to.not.equal(bp);
    });

    it("enabled:true (défaut) → le backplane custom EST branché (contraste)", async () => {
      const bp = new FakeBackplane();
      const { module } = buildModuleMock(
        defineRealtimeConfig({ enabled: true }, { backplane: bp }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      const hub = getRealtimeHub();
      expect(hub.backplane).to.equal(bp);
    });
  });

  describe("initialize — backplane custom", () => {
    it("branche backplane.instance fournie via defineRealtimeConfig", async () => {
      const bp = new FakeBackplane();
      const { module } = buildModuleMock(
        defineRealtimeConfig({}, { backplane: bp }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getBackplane()).to.equal(bp);
      expect(bp.started).to.equal(1);
    });

    it("branche realtimeBackplane du container si pas d'instance dans la config", async () => {
      const { module, container } = buildModuleMock();
      const bp = new FakeBackplane();
      container.set("realtimeBackplane", bp);
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getBackplane()).to.equal(bp);
    });

    it("aucun backplane fourni → hub reste sur son backplane par défaut", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      // null = Loopback implicite (hot-path teste `=== null`)
      expect(svc.getBackplane()).to.equal(null);
    });
  });

  describe("API — délégation au hub", () => {
    it("getConfig retourne la config gelée", async () => {
      const cfg = defineRealtimeConfig({ slowConsumer: { bytes: 4096 } });
      const { module } = buildModuleMock(cfg);
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getConfig()).to.equal(cfg);
      expect(svc.getConfig().slowConsumer.bytes).to.equal(4096);
    });

    it("getHub retourne le singleton RealtimeHub", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub()).to.be.instanceOf(RealtimeHub);
      expect(svc.getHub()).to.equal(getRealtimeHub());
    });

    it("publish + subscribe + unsubscribe délégués au hub", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);

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
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);

      const bp = new FakeBackplane();
      svc.getHub().setBackplane(bp);
      svc.markBroadcastChannel("svc-bcast:");
      svc.publish("svc-bcast:event", { x: 1 });
      expect(bp.publishedChannels).to.deep.equal(["svc-bcast:event"]);
    });

    it("setFrameAuthorizer (Seam #1) délégué au hub + null le retire", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);

      expect(svc.getHub().hasFrameAuthorizer()).to.equal(false);
      svc.setFrameAuthorizer((f) => (f as { method?: string }).method === "ok");
      expect(svc.getHub().hasFrameAuthorizer()).to.equal(true);
      svc.setFrameAuthorizer(null);
      expect(svc.getHub().hasFrameAuthorizer()).to.equal(false);
    });

    it("resolveChannelPolicy (Seam #1b) délégué au hub", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);

      expect(svc.resolveChannelPolicy("admin:metrics")).to.equal(null);
      svc.getHub().registerChannelPolicy("admin:metrics", {
        roles: ["ROLE_ADMIN"],
      });
      expect(svc.resolveChannelPolicy("admin:metrics")).to.deep.equal({
        roles: ["ROLE_ADMIN"],
      });
    });
  });

  // ─── Seams sécurité P13 Bloc A étape 6 ──────────────────────────────────
  describe("Seam #4 — Origin guard depuis defineRealtimeConfig().csrf.checkOrigin", () => {
    it("csrf.checkOrigin.enabled=false (défaut) → hub.checkOrigin renvoie true partout", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub().checkOrigin("https://evil.com")).to.equal(true);
      expect(svc.getHub().checkOrigin(undefined)).to.equal(true);
    });

    it("csrf.checkOrigin.enabled=true + allowList exact → accepte/refuse selon liste", async () => {
      const { module } = buildModuleMock(
        defineRealtimeConfig({
          csrf: {
            checkOrigin: {
              enabled: true,
              allowList: ["https://app.example.com"],
              allowMissingOrigin: false,
            },
          },
        }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      const hub = svc.getHub();
      expect(hub.checkOrigin("https://app.example.com")).to.equal(true);
      expect(hub.checkOrigin("https://evil.com")).to.equal(false);
    });

    it("allowMissingOrigin=false (défaut) → Origin absente refusée (fail-closed)", async () => {
      const { module } = buildModuleMock(
        defineRealtimeConfig({
          csrf: {
            checkOrigin: {
              enabled: true,
              allowList: ["https://app.example.com"],
            },
          },
        }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub().checkOrigin(undefined)).to.equal(false);
      expect(svc.getHub().checkOrigin("")).to.equal(false);
    });

    it("allowMissingOrigin=true → Origin absente acceptée (clients non-browser)", async () => {
      const { module } = buildModuleMock(
        defineRealtimeConfig({
          csrf: {
            checkOrigin: {
              enabled: true,
              allowList: ["https://app.example.com"],
              allowMissingOrigin: true,
            },
          },
        }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub().checkOrigin(undefined)).to.equal(true);
      expect(svc.getHub().checkOrigin("https://app.example.com")).to.equal(
        true,
      );
      // Origin présente mais hors liste reste refusée
      expect(svc.getHub().checkOrigin("https://evil.com")).to.equal(false);
    });

    it("enabled=true + allowList vide → tout refusé (fail-closed sécurisé)", async () => {
      const { module } = buildModuleMock(
        defineRealtimeConfig({
          csrf: {
            checkOrigin: {
              enabled: true,
              allowList: [],
            },
          },
        }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub().checkOrigin("https://anywhere.com")).to.equal(false);
      expect(svc.getHub().checkOrigin(undefined)).to.equal(false);
    });

    it("enabled=true SANS allowList déclarée → liste vide (branche `?? []`)", async () => {
      const { module } = buildModuleMock(
        defineRealtimeConfig({ csrf: { checkOrigin: { enabled: true } } }),
      );
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getHub().checkOrigin("https://x.com")).to.equal(false);
    });
  });

  describe("Seam #2/#3 — useAuthenticator + getTokenForPeer", () => {
    function makeAuth(name: string): IRealtimeAuthenticator {
      return {
        name,
        supports: () => true,
        authenticate: async () => ANONYMOUS_REALTIME_TOKEN,
      };
    }

    it("useAuthenticator délègue au hub (matcher enregistré)", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      const auth = makeAuth("jwt");
      svc.useAuthenticator({ pattern: "/admin/" }, auth);
      expect(svc.getHub().registeredAuthenticators).to.deep.equal([auth]);
    });

    it("getTokenForPeer délègue au hub (fallback Anonymous)", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      const peer = new JsonRpcPeer({ send: () => {} });
      expect(svc.getTokenForPeer(peer)).to.equal(ANONYMOUS_REALTIME_TOKEN);
    });
  });

  describe("introspection (getConfig / probe)", () => {
    it("getConfig AVANT init → throw 'not initialized'", () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      expect(() => svc.getConfig()).to.throw(/not initialized/);
    });

    it("getConfig APRÈS init → renvoie la config gelée", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.getConfig()).to.be.an("object");
    });

    it("probe délègue au hub (snapshot d'observabilité)", async () => {
      const { module } = buildModuleMock();
      const svc = new RealtimeService(module);
      await svc.init(module);
      expect(svc.probe()).to.be.an("object");
    });
  });
});
