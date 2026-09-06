import { expect } from "chai";
import {
  ClusterManager,
  computeBackoff,
  type IClusterRuntime,
  type IClusterWorker,
  type ClusterScheduler,
} from "../service/cluster/ClusterManager";

/**
 * ClusterManager — superviseur du process master (fork, respawn backoff, graceful
 * shutdown). Toute la mécanique runtime (`node:cluster`, timers, `process.exit`) est
 * derrière des seams injectés : le state machine est prouvé SANS forker un process réel.
 */
describe("cluster / ClusterManager (supervisor state machine)", () => {
  class FakeWorker implements IClusterWorker {
    readonly id: number;
    dead = false;
    readonly signals: NodeJS.Signals[] = [];
    constructor(id: number) {
      this.id = id;
    }
    kill(signal: NodeJS.Signals = "SIGTERM"): void {
      this.signals.push(signal);
    }
    isDead(): boolean {
      return this.dead;
    }
  }

  class FakeRuntime implements IClusterRuntime {
    readonly isPrimary = true;
    readonly forked: FakeWorker[] = [];
    #nextId = 1;
    #exitCb:
      | ((
          w: IClusterWorker,
          code: number | null,
          signal: string | null,
        ) => void)
      | null = null;

    fork(): IClusterWorker {
      const w = new FakeWorker(this.#nextId++);
      this.forked.push(w);
      return w;
    }
    onExit(
      cb: (
        w: IClusterWorker,
        code: number | null,
        signal: string | null,
      ) => void,
    ): void {
      this.#exitCb = cb;
    }
    /** Simule la mort d'un worker. */
    crash(w: FakeWorker, signal: string | null = "SIGSEGV"): void {
      w.dead = true;
      this.#exitCb?.(w, null, signal);
    }
    exitClean(w: FakeWorker): void {
      w.dead = true;
      this.#exitCb?.(w, 0, null);
    }
  }

  interface Task {
    fn: () => void;
    ms: number;
    cleared: boolean;
  }
  class FakeScheduler implements ClusterScheduler {
    readonly tasks: Task[] = [];
    set(fn: () => void, ms: number): unknown {
      const t: Task = { fn, ms, cleared: false };
      this.tasks.push(t);
      return t;
    }
    clear(h: unknown): void {
      (h as Task).cleared = true;
    }
    fire(i: number): void {
      const t = this.tasks[i];
      if (t && !t.cleared) {
        t.fn();
      }
    }
    get lastMs(): number {
      return this.tasks[this.tasks.length - 1]?.ms;
    }
  }

  const build = (over: Partial<Parameters<typeof makeOpts>[0]> = {}) =>
    makeOpts(over);

  function makeOpts(over: {
    workers?: number;
    respawnBaseMs?: number;
    respawnMaxMs?: number;
    stableMs?: number;
    shutdownTimeoutMs?: number;
  }) {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    const exits: number[] = [];
    const mgr = new ClusterManager({
      workers: over.workers ?? 2,
      runtime,
      scheduler,
      exit: (code) => exits.push(code),
      respawnBaseMs: over.respawnBaseMs ?? 100,
      respawnMaxMs: over.respawnMaxMs ?? 10_000,
      stableMs: over.stableMs ?? 10_000,
      shutdownTimeoutMs: over.shutdownTimeoutMs ?? 5_000,
    });
    return { runtime, scheduler, exits, mgr };
  }

  describe("computeBackoff (pure)", () => {
    it("double à chaque crash, plafonné", () => {
      expect(computeBackoff(1, 100, 10_000)).to.equal(100);
      expect(computeBackoff(2, 100, 10_000)).to.equal(200);
      expect(computeBackoff(3, 100, 10_000)).to.equal(400);
      expect(computeBackoff(10, 100, 1_000)).to.equal(1_000); // capé
    });
    it("crashes < 1 → traité comme 1", () => {
      expect(computeBackoff(0, 100, 10_000)).to.equal(100);
    });
  });

  describe("start", () => {
    it("fork le nombre de workers demandé", () => {
      const { runtime, mgr } = build({ workers: 4 });
      mgr.start();
      expect(runtime.forked).to.have.lengthOf(4);
      expect(mgr.size).to.equal(4);
    });
    it("idempotent — second start no-op", () => {
      const { runtime, mgr } = build({ workers: 2 });
      mgr.start().start();
      expect(runtime.forked).to.have.lengthOf(2);
    });
  });

  describe("respawn backoff", () => {
    it("worker mort → respawn programmé puis re-forké", () => {
      const { runtime, scheduler, mgr } = build({ workers: 2 });
      mgr.start();
      runtime.crash(runtime.forked[0]);
      expect(mgr.size).to.equal(1);
      expect(scheduler.lastMs).to.equal(100); // base
      scheduler.fire(0);
      expect(mgr.size).to.equal(2);
      expect(runtime.forked).to.have.lengthOf(3);
    });

    it("crashs consécutifs → backoff exponentiel (stableMs jamais atteint)", () => {
      const { runtime, scheduler, mgr } = build({
        workers: 1,
        respawnBaseMs: 100,
        stableMs: 10_000,
      });
      mgr.start();
      runtime.crash(runtime.forked[0]); // crash #1
      expect(scheduler.lastMs).to.equal(100);
      scheduler.fire(0); // respawn → forked[1]
      runtime.crash(runtime.forked[1]); // crash #2
      expect(scheduler.lastMs).to.equal(200);
      scheduler.fire(1); // respawn → forked[2]
      runtime.crash(runtime.forked[2]); // crash #3
      expect(scheduler.lastMs).to.equal(400);
    });

    it("backoff plafonné par respawnMaxMs", () => {
      const { runtime, scheduler, mgr } = build({
        workers: 1,
        respawnBaseMs: 100,
        respawnMaxMs: 300,
        stableMs: 10_000,
      });
      mgr.start();
      runtime.crash(runtime.forked[0]);
      scheduler.fire(0);
      runtime.crash(runtime.forked[1]);
      scheduler.fire(1);
      runtime.crash(runtime.forked[2]);
      expect(scheduler.lastMs).to.equal(300); // 400 → capé à 300
    });

    it("worker stable (uptime >= stableMs) → backoff réinitialisé", () => {
      const { runtime, scheduler, mgr } = build({
        workers: 1,
        respawnBaseMs: 100,
        stableMs: 0, // tout worker compte comme stable → reset systématique
      });
      mgr.start();
      runtime.crash(runtime.forked[0]);
      expect(scheduler.lastMs).to.equal(100);
      scheduler.fire(0);
      runtime.crash(runtime.forked[1]);
      expect(scheduler.lastMs).to.equal(100); // pas 200 — réinitialisé
    });
  });

  describe("graceful shutdown", () => {
    it("SIGTERM à chaque worker vivant + timer armé", () => {
      const { runtime, scheduler, mgr } = build({ workers: 3 });
      mgr.start();
      mgr.shutdown("SIGTERM");
      expect(mgr.shuttingDown).to.equal(true);
      for (const w of runtime.forked) {
        expect(w.signals).to.deep.equal(["SIGTERM"]);
      }
      expect(scheduler.lastMs).to.equal(5_000); // shutdownTimeoutMs
    });

    it("tous les workers drainent avant le timeout → exit(0), timer annulé", () => {
      const { runtime, scheduler, exits, mgr } = build({ workers: 2 });
      mgr.start();
      mgr.shutdown();
      runtime.exitClean(runtime.forked[0]);
      runtime.exitClean(runtime.forked[1]);
      expect(mgr.size).to.equal(0);
      expect(exits).to.deep.equal([0]);
      expect(scheduler.tasks[scheduler.tasks.length - 1].cleared).to.equal(
        true,
      );
    });

    it("timeout dépassé → SIGKILL des survivants + exit(1)", () => {
      const { runtime, scheduler, exits, mgr } = build({ workers: 2 });
      mgr.start();
      mgr.shutdown();
      // aucun worker ne meurt → on déclenche le timer de timeout
      const timerIdx = scheduler.tasks.length - 1;
      scheduler.fire(timerIdx);
      for (const w of runtime.forked) {
        expect(w.signals).to.deep.equal(["SIGTERM", "SIGKILL"]);
      }
      expect(exits).to.deep.equal([1]);
    });

    it("aucun respawn pendant le shutdown", () => {
      const { runtime, mgr } = build({ workers: 2 });
      mgr.start();
      mgr.shutdown();
      const before = runtime.forked.length;
      runtime.crash(runtime.forked[0]); // mort pendant drain
      expect(runtime.forked.length).to.equal(before); // pas de re-fork
    });

    it("shutdown sans worker vivant → exit(0) immédiat", () => {
      const { exits, mgr } = build({ workers: 1 });
      // pas de start() → 0 worker
      mgr.shutdown();
      expect(exits).to.deep.equal([0]);
    });

    it("idempotent — second shutdown no-op", () => {
      const { runtime, exits, mgr } = build({ workers: 1 });
      mgr.start();
      mgr.shutdown();
      mgr.shutdown();
      runtime.exitClean(runtime.forked[0]);
      expect(exits).to.deep.equal([0]); // un seul exit
    });
  });

  /**
   * 🔴 Le défaut que ces cas ferment, et pourquoi il était MUET.
   *
   * `installSignalHandlers` commençait par `process.removeAllListeners(sig)`.
   * Un module tiers qui avait branché son propre arrêt propre sur `SIGTERM` ne
   * recevait donc plus rien dès que l'application passait en cluster — son code
   * était juste, ses tests passaient, et son nettoyage cessait simplement de
   * s'exécuter, au moment le plus coûteux : l'arrêt, en production.
   *
   * Ces cas touchent le VRAI `process`. Ils reposent donc leur décor à la main,
   * et le manager retire les siens : un listener oublié ici fuit dans toute la
   * suite qui suit.
   */
  describe("signaux — on n'arrache que ce qu'on a posé", () => {
    it("un gestionnaire TIERS survit à l'installation du cluster", () => {
      const { mgr } = build({ workers: 1 });
      let tiersAppele = 0;
      const tiers = (): void => {
        tiersAppele += 1;
      };
      process.on("SIGTERM", tiers);
      try {
        mgr.installSignalHandlers();
        // Le signal est ÉMIS, pas envoyé : `process.emit` déclenche les
        // listeners sans demander au système de tuer le process de test.
        process.emit("SIGTERM");
        expect(
          tiersAppele,
          "le gestionnaire tiers n'a pas été appelé — le cluster l'a arraché",
        ).to.equal(1);
      } finally {
        mgr.removeSignalHandlers();
        process.removeListener("SIGTERM", tiers);
      }
    });

    it("le manager retire les SIENS, et rend leur compte", () => {
      const { mgr } = build({ workers: 1 });
      const avant = process.listenerCount("SIGTERM");
      mgr.installSignalHandlers();
      expect(process.listenerCount("SIGTERM")).to.equal(avant + 1);
      expect(mgr.removeSignalHandlers()).to.equal(2); // SIGTERM + SIGINT
      expect(process.listenerCount("SIGTERM")).to.equal(avant);
      expect(mgr.removeSignalHandlers(), "idempotent").to.equal(0);
    });

    it("le signal reçu déclenche bien l'arrêt du master", () => {
      const { exits, mgr } = build({ workers: 1 });
      try {
        mgr.installSignalHandlers();
        process.emit("SIGTERM");
        // Aucun worker vivant (pas de `start()`) → arrêt immédiat.
        expect(exits).to.deep.equal([0]);
      } finally {
        mgr.removeSignalHandlers();
      }
    });
  });
});
