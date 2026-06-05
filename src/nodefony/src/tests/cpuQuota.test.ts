import { expect } from "chai";
import {
  readCgroupCpuQuota,
  resolveWorkerCount,
  type FileReader,
} from "../service/cluster/cpuQuota";

/**
 * cpuQuota — résolution cgroup-aware du nombre de workers cluster. LE point de
 * correction du bug de l'ancien cluster JS (`os.cpus().length` ignore la limite
 * cgroup du conteneur → fork de N cœurs hôte throttlés). Lecteur de fichier injecté.
 */
describe("cluster / cpuQuota (cgroup-aware worker count)", () => {
  /** Fabrique un lecteur factice à partir d'une map path → contenu. */
  const reader = (files: Record<string, string>): FileReader => {
    return (path) => (path in files ? files[path] : null);
  };

  describe("readCgroupCpuQuota — cgroup v2 (cpu.max)", () => {
    it("`max <period>` → illimité → null", () => {
      const r = reader({ "/sys/fs/cgroup/cpu.max": "max 100000\n" });
      expect(readCgroupCpuQuota(r)).to.equal(null);
    });

    it("`100000 100000` → 1 cœur", () => {
      const r = reader({ "/sys/fs/cgroup/cpu.max": "100000 100000\n" });
      expect(readCgroupCpuQuota(r)).to.equal(1);
    });

    it("`250000 100000` → 2.5 cœurs (fractionnaire)", () => {
      const r = reader({ "/sys/fs/cgroup/cpu.max": "250000 100000" });
      expect(readCgroupCpuQuota(r)).to.equal(2.5);
    });

    it("`50000 100000` → 0.5 cœur", () => {
      const r = reader({ "/sys/fs/cgroup/cpu.max": "50000 100000" });
      expect(readCgroupCpuQuota(r)).to.equal(0.5);
    });

    it("contenu malformé → null", () => {
      const r = reader({ "/sys/fs/cgroup/cpu.max": "garbage" });
      expect(readCgroupCpuQuota(r)).to.equal(null);
    });
  });

  describe("readCgroupCpuQuota — cgroup v1 (cfs_quota/period)", () => {
    it("quota/period → cœurs (v1 utilisé si v2 absent)", () => {
      const r = reader({
        "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000",
        "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000",
      });
      expect(readCgroupCpuQuota(r)).to.equal(2);
    });

    it("quota = -1 → illimité → null", () => {
      const r = reader({
        "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1",
        "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000",
      });
      expect(readCgroupCpuQuota(r)).to.equal(null);
    });

    it("v2 prioritaire sur v1 quand les deux existent", () => {
      const r = reader({
        "/sys/fs/cgroup/cpu.max": "400000 100000",
        "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "100000",
        "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000",
      });
      expect(readCgroupCpuQuota(r)).to.equal(4);
    });
  });

  describe("readCgroupCpuQuota — hors conteneur", () => {
    it("aucun fichier cgroup → null", () => {
      expect(readCgroupCpuQuota(reader({}))).to.equal(null);
    });
  });

  describe("resolveWorkerCount — ordre de priorité", () => {
    it("`requested` explicite prioritaire, NON borné (harnais backplane)", () => {
      // 8 workers demandés sur une machine à 2 cœurs → honoré tel quel.
      expect(
        resolveWorkerCount({ requested: 8, availableParallelism: 2 }),
      ).to.equal(8);
    });

    it("`requested` fractionnaire → floor, min 1", () => {
      expect(resolveWorkerCount({ requested: 3.9 })).to.equal(3);
      expect(resolveWorkerCount({ requested: 0.5 })).to.equal(1);
    });

    it("`requested` <= 0 ou non fini → ignoré, fallback", () => {
      expect(resolveWorkerCount({ requested: 0, cgroupQuota: 2 })).to.equal(2);
      expect(
        resolveWorkerCount({
          requested: NaN,
          availableParallelism: 4,
          cgroupQuota: null,
        }),
      ).to.equal(4);
    });

    it("cgroup quota → arrondi, borné par le parallélisme schedulable", () => {
      expect(
        resolveWorkerCount({ cgroupQuota: 2.5, availableParallelism: 16 }),
      ).to.equal(3); // round(2.5) = 3
      expect(
        resolveWorkerCount({ cgroupQuota: 64, availableParallelism: 2 }),
      ).to.equal(2); // borné au schedulable
    });

    it("quota cgroup < 1 → min 1", () => {
      expect(
        resolveWorkerCount({ cgroupQuota: 0.3, availableParallelism: 8 }),
      ).to.equal(1);
    });

    it("pas de cgroup → availableParallelism", () => {
      expect(
        resolveWorkerCount({ cgroupQuota: null, availableParallelism: 6 }),
      ).to.equal(6);
    });

    it("toujours >= 1 même sans aucune info", () => {
      expect(
        resolveWorkerCount({ cgroupQuota: null, availableParallelism: 0 }),
      ).to.equal(1);
    });
  });
});
