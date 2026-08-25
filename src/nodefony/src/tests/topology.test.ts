import { expect } from "chai";
import { resolveTopology } from "../service/cluster/topology";

/**
 * topology — résolution de LA topologie de lancement (combien de workers).
 * Source unique de vérité : CLI `--workers` > env `NF_WORKERS` > config app
 * `cluster.workers` > défaut 1. `resolveTopology` est pur (seams injectés) → testable
 * sans FS ni process réel. (Décision « 2 molettes » 2026-05-24.)
 */
describe("cluster / resolveTopology (priorité flag > env > config > défaut)", () => {
  // Neutralise l'env réel pour les cas « rien fourni ».
  const saved = process.env.NF_WORKERS;
  beforeAll(() => {
    delete process.env.NF_WORKERS;
  });
  afterAll(() => {
    if (saved === undefined) {
      delete process.env.NF_WORKERS;
    } else {
      process.env.NF_WORKERS = saved;
    }
  });

  describe("défaut", () => {
    it("rien fourni → 1 process, source `default`", () => {
      expect(resolveTopology({})).to.deep.equal({
        workers: 1,
        source: "default",
      });
    });
  });

  describe("config app (cluster.workers)", () => {
    it("config: 3 → 3 workers, source `config`", () => {
      expect(resolveTopology({ config: 3 })).to.deep.equal({
        workers: 3,
        source: "config",
      });
    });

    it("config: 1 → mono-process, source `config`", () => {
      expect(resolveTopology({ config: 1 })).to.deep.equal({
        workers: 1,
        source: "config",
      });
    });

    it('config: "auto" → workers >= 1, source `config`', () => {
      const t = resolveTopology({ config: "auto" });
      expect(t.source).to.equal("config");
      expect(t.workers).to.be.a("number").and.to.be.at.least(1);
    });
  });

  describe("env (NF_WORKERS)", () => {
    it("env `4` (sans flag) → 4 workers, source `env`", () => {
      expect(resolveTopology({ env: "4" })).to.deep.equal({
        workers: 4,
        source: "env",
      });
    });

    it("env bat config", () => {
      expect(resolveTopology({ env: "4", config: 2 })).to.deep.equal({
        workers: 4,
        source: "env",
      });
    });
  });

  describe("flag CLI (--workers)", () => {
    it("flag `2` → 2 workers, source `flag`", () => {
      expect(resolveTopology({ flag: "2" })).to.deep.equal({
        workers: 2,
        source: "flag",
      });
    });

    it("flag bat env ET config", () => {
      expect(resolveTopology({ flag: "2", env: "4", config: 8 })).to.deep.equal(
        {
          workers: 2,
          source: "flag",
        },
      );
    });

    it('flag "auto" → workers >= 1, source `flag`', () => {
      const t = resolveTopology({ flag: "auto" });
      expect(t.source).to.equal("flag");
      expect(t.workers).to.be.at.least(1);
    });
  });

  describe("valeurs invalides → source suivante", () => {
    it("flag vide → retombe sur config", () => {
      expect(resolveTopology({ flag: "", config: 3 })).to.deep.equal({
        workers: 3,
        source: "config",
      });
    });

    it("flag `0` (≤ 0) → retombe sur config", () => {
      expect(resolveTopology({ flag: "0", config: 3 })).to.deep.equal({
        workers: 3,
        source: "config",
      });
    });

    it("flag non numérique → retombe sur env puis défaut", () => {
      expect(resolveTopology({ flag: "abc" })).to.deep.equal({
        workers: 1,
        source: "default",
      });
    });

    it("tout invalide/absent → défaut 1", () => {
      expect(resolveTopology({ flag: "x", env: "", config: 0 })).to.deep.equal({
        workers: 1,
        source: "default",
      });
    });
  });
});
