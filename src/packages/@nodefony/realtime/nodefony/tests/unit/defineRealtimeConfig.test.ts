import { describe, it, expect } from "vitest";
import {
  defineRealtimeConfig,
  realtimeConfigJsonSchema,
  type IRealtimeConfig,
} from "../../config/defineModuleConfig.js";
import type {
  IBackplane,
  IBackplaneInfo,
  BackplaneHandler,
} from "../../interfaces/IBackplane.js";

class NoopBackplane implements IBackplane {
  readonly originId = "test";
  start(): void {}
  stop(): void {}
  publish(_c: string, _p: unknown): void {}
  onMessage(_h: BackplaneHandler): void {}

  /** Carte d'identité — backplane inerte (aucun pair) : `local`, jamais cross-pod. */
  describe(): IBackplaneInfo {
    return {
      driver: "noop",
      kind: "local",
      originId: this.originId,
      crossPod: false,
    };
  }
}

describe("defineRealtimeConfig — builder + Zod", () => {
  describe("validation + defaults", () => {
    it("retourne les défauts sûrs sans config", () => {
      const c = defineRealtimeConfig();
      expect(c.enabled).to.equal(true);
      expect(c.backplane.driver).to.equal("loopback");
      expect(c.cluster.probe.enabled).to.equal(true);
      expect(c.slowConsumer.bytes).to.equal(1 << 20);
      // Seam #4 — défauts sûrs CSRF (origin check désactivé pour rétrocompat)
      expect(c.csrf.checkOrigin.enabled).to.equal(false);
      expect(c.csrf.checkOrigin.allowList).to.deep.equal([]);
      expect(c.csrf.checkOrigin.allowMissingOrigin).to.equal(false);
    });

    it("merge les overrides partiels avec les défauts", () => {
      const c = defineRealtimeConfig({
        backplane: { driver: "redis" },
        slowConsumer: { bytes: 2048 },
      });
      expect(c.backplane.driver).to.equal("redis");
      expect(c.slowConsumer.bytes).to.equal(2048);
      // valeurs non fournies → défauts préservés
      expect(c.enabled).to.equal(true);
      expect(c.cluster.probe.enabled).to.equal(true);
    });

    it("backplane.namespace : optionnel (absent par défaut), accepté si conforme", () => {
      expect(defineRealtimeConfig().backplane.namespace).to.equal(undefined);
      const c = defineRealtimeConfig({
        backplane: { driver: "redis", namespace: "my-app.v2" },
      });
      expect(c.backplane.namespace).to.equal("my-app.v2");
    });

    it("backplane.namespace : rejette `:` et espaces (le `:` structure le canal)", () => {
      expect(() =>
        defineRealtimeConfig({
          backplane: { namespace: "bad:ns" },
        }),
      ).to.throw();
      expect(() =>
        defineRealtimeConfig({
          backplane: { namespace: "bad ns" },
        }),
      ).to.throw();
    });

    it("accepte un driver arbitraire (registre OUVERT — driver custom)", () => {
      // Le driver n'est plus un enum fermé : un nom custom (`nats`, `pulsar`…)
      // est valide à la config. La résolution réelle se fait dans le registre au
      // boot (warn fail-soft si inconnu) — pas de rejet Zod ici, par design.
      const cfg = defineRealtimeConfig({ backplane: { driver: "nats" } });
      expect(cfg.backplane.driver).to.equal("nats");
    });

    it("backplane.secret : absent par défaut, exige ≥ 32 caractères (F83)", () => {
      expect(defineRealtimeConfig().backplane.secret).to.equal(undefined);
      expect(() =>
        defineRealtimeConfig({ backplane: { secret: "trop-court" } }),
      ).to.throw();
      const ok = "x".repeat(32);
      expect(
        defineRealtimeConfig({ backplane: { secret: ok } }).backplane.secret,
      ).to.equal(ok);
    });

    it("backplane.secret : `NF_REALTIME_BACKPLANE_SECRET` a la précédence (déploiement)", () => {
      // Un secret n'a rien à faire dans un fichier de config versionné : l'env
      // (k8s Secret / Docker) est la voie normale, comme NF_REALTIME_DRIVER.
      const previous = process.env.NF_REALTIME_BACKPLANE_SECRET;
      process.env.NF_REALTIME_BACKPLANE_SECRET = "env-" + "y".repeat(32);
      try {
        const cfg = defineRealtimeConfig({
          backplane: { secret: "config-" + "z".repeat(32) },
        });
        expect(cfg.backplane.secret).to.equal("env-" + "y".repeat(32));
      } finally {
        if (previous === undefined)
          delete process.env.NF_REALTIME_BACKPLANE_SECRET;
        else process.env.NF_REALTIME_BACKPLANE_SECRET = previous;
      }
    });

    it("rejette un slowConsumer.bytes ≤ 0", () => {
      expect(() =>
        defineRealtimeConfig({ slowConsumer: { bytes: 0 } }),
      ).to.throw();
    });
  });

  describe("backplane instance custom (2ᵉ argument)", () => {
    it("rattache une instance IBackplane sans toucher au driver déclaré", () => {
      const bp = new NoopBackplane();
      const c = defineRealtimeConfig({}, { backplane: bp });
      expect(c.backplane.driver).to.equal("loopback");
      expect(c.backplane.instance).to.equal(bp);
    });

    it("instance custom + driver déclaré cohabitent (driver pour introspection)", () => {
      const bp = new NoopBackplane();
      const c = defineRealtimeConfig(
        { backplane: { driver: "kafka" } },
        { backplane: bp },
      );
      expect(c.backplane.driver).to.equal("kafka");
      expect(c.backplane.instance).to.equal(bp);
    });

    it("instance absente → backplane.instance vaut undefined", () => {
      const c = defineRealtimeConfig();
      expect(c.backplane.instance).to.equal(undefined);
    });
  });

  describe("output gelé", () => {
    it("freeze le niveau racine (mutation interdite)", () => {
      const c = defineRealtimeConfig();
      expect(Object.isFrozen(c)).to.equal(true);
      expect(() => {
        (c as { enabled: boolean }).enabled = false;
      }).to.throw();
    });
  });

  describe("realtimeConfigJsonSchema", () => {
    it("retourne un JSON Schema introspectable (Studio-friendly)", () => {
      const schema = realtimeConfigJsonSchema() as Record<string, unknown>;
      expect(schema).to.be.an("object");
      // descriptions des champs Zod surfacées (consommées par Studio pour les labels)
      const dump = JSON.stringify(schema);
      expect(dump).to.match(/backplane/i);
      expect(dump).to.match(/slowConsumer/i);
      // Seam #4 — la section CSRF est aussi exposée (formulaire Studio)
      expect(dump).to.match(/checkOrigin/);
      expect(dump).to.match(/allowList/);
    });

    it("n'expose PAS backplane.instance (non-sérialisable)", () => {
      // backplane.instance vit hors schéma — passé en 2ᵉ argument du builder,
      // exclu du JSON Schema destiné au formulaire d'édition Studio.
      const schema = JSON.stringify(realtimeConfigJsonSchema());
      expect(schema).to.not.match(/"instance"/);
    });
  });

  describe("types — z.input vs z.output", () => {
    it("IRealtimeConfig (output) = champs résolus + backplane.instance optionnel", () => {
      const c: IRealtimeConfig = defineRealtimeConfig();
      // Test de présence runtime — la couverture de types est validée par tsc.
      expect(typeof c.enabled).to.equal("boolean");
      expect(typeof c.backplane.driver).to.equal("string");
    });
  });
});
