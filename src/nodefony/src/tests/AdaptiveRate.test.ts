import { expect } from "chai";
import "mocha";
import {
  AdaptiveRate,
  bindAdaptiveChannel,
  type AdaptiveScheduler,
} from "../client/realtime/AdaptiveRate";
import type {
  IRealtimeSocket,
  IRealtimeChannel,
  IChannelStats,
  RealtimeHandler,
} from "../realtime/IRealtimeSocket";

/**
 * AdaptiveRate — cadence adaptative client-driven (AIMD). On vérifie la machine à états
 * PURE (déterministe, sans timer) puis le câblage sur une socket MOCK (scheduler/horloge
 * injectés → 0 timer réel).
 */
describe("realtime / AdaptiveRate (cadence adaptative AIMD)", () => {
  describe("machine à états — noteFrame (AI/MD sur frames)", () => {
    it("démarre au bas de l'échelle (cadence désirée)", () => {
      const ar = new AdaptiveRate({ intervalMs: 1000, maxMs: 8000 });
      expect(ar.current()).to.equal(1000);
    });

    it("dérive une échelle géométrique ×2 jusqu'à maxMs", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        maxMs: 8000,
        starvationFactor: 1.8,
      });
      // Chaque cran demande 2 frames : la 1ʳᵉ ré-amorce la mesure (post-reset), la 2ᵉ
      // (gap énorme) déclenche la décrue. Échelle dérivée : [1000,2000,4000,8000].
      const starve = (from: number): number | null => {
        ar.noteFrame(from);
        return ar.noteFrame(from + 100000)?.intervalMs ?? null;
      };
      expect(starve(0)).to.equal(2000);
      expect(starve(1_000_000)).to.equal(4000);
      expect(starve(2_000_000)).to.equal(8000);
      expect(starve(3_000_000)).to.equal(null); // au plafond → pas plus grossier
      expect(ar.current()).to.equal(8000);
    });

    it("1ʳᵉ frame → pas de décision (pas de gap mesurable)", () => {
      const ar = new AdaptiveRate({ intervalMs: 1000 });
      expect(ar.noteFrame(0)).to.equal(null);
    });

    it("famine (gap > k×cadence) → Multiplicative Decrease immédiat", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        starvationFactor: 1.8,
      });
      ar.noteFrame(0);
      const d = ar.noteFrame(2000); // gap 2000 > 1800
      expect(d).to.deep.equal({ intervalMs: 2000, reason: "decrease" });
    });

    it("reprise (N échantillons sains) → Additive Increase, pas avant", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        starvationFactor: 1.8,
        healthyFactor: 1.25,
        recoveryWindow: 2,
      });
      ar.noteFrame(0);
      expect(ar.noteFrame(2000)?.reason).to.equal("decrease"); // → 2000ms, reset
      ar.noteFrame(10000); // post-reset, pas de gap
      expect(ar.noteFrame(12000)).to.equal(null); // sain #1 (<2500), pas encore
      const up = ar.noteFrame(14000); // sain #2 → AI
      expect(up).to.deep.equal({ intervalMs: 1000, reason: "increase" });
    });

    it("bande morte (entre sain et famine) → aucun changement", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        starvationFactor: 1.8,
        healthyFactor: 1.25,
      });
      ar.noteFrame(0);
      expect(ar.noteFrame(1500)).to.equal(null); // 1250 < 1500 < 1800
      expect(ar.current()).to.equal(1000);
    });

    it("au bas de l'échelle, impossible d'accélérer davantage", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000],
        recoveryWindow: 1,
      });
      ar.noteFrame(0);
      expect(ar.noteFrame(900)).to.equal(null); // sain mais déjà au plus fin
      expect(ar.current()).to.equal(1000);
    });
  });

  describe("limites / bornes", () => {
    it("échelle d'un seul cran → ni MD ni AI possibles", () => {
      const ar = new AdaptiveRate({ intervalMs: 1000, ladder: [1000] });
      ar.noteFrame(0);
      expect(ar.noteFrame(100000)).to.equal(null); // famine mais 1 seul cran
      expect(ar.current()).to.equal(1000);
    });

    it("maxMs < intervalMs → échelle = [intervalMs] (pas d'échelle inversée)", () => {
      const ar = new AdaptiveRate({ intervalMs: 2000, maxMs: 1000 });
      expect(ar.current()).to.equal(2000);
      ar.noteFrame(0);
      expect(ar.noteFrame(100000)).to.equal(null);
    });

    it("échelle fournie non triée → triée croissante", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [5000, 1000, 2000],
        starvationFactor: 1.8,
      });
      expect(ar.current()).to.equal(1000); // bas de l'échelle triée
      ar.noteFrame(0);
      expect(ar.noteFrame(100000)?.intervalMs).to.equal(2000);
    });

    it("seuils exacts : gap == k×cadence n'est PAS une famine (strict >)", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        starvationFactor: 1.8,
        healthyFactor: 1.25,
      });
      ar.noteFrame(0);
      expect(ar.noteFrame(1800)).to.equal(null); // == 1.8×1000 → bande morte, pas MD
      expect(ar.current()).to.equal(1000);
    });

    it("seuil sain exact : gap == healthyFactor×cadence compte comme sain", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        healthyFactor: 1.25,
        recoveryWindow: 1,
        starvationFactor: 1.8,
      });
      ar.noteFrame(0);
      ar.noteFrame(2000); // → decrease vers 2000 (reset)
      ar.noteFrame(10000); // ré-amorce
      const up = ar.noteFrame(12500); // gap 2500 == 1.25×2000 → sain → AI (window 1)
      expect(up).to.deep.equal({ intervalMs: 1000, reason: "increase" });
    });

    it("famine puis frame saine alternées ne descendent pas en escalier (asymétrie AIMD)", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000, 4000],
        starvationFactor: 1.8,
        healthyFactor: 1.25,
        recoveryWindow: 3,
      });
      ar.noteFrame(0);
      expect(ar.noteFrame(2000)?.intervalMs).to.equal(2000); // MD immédiat
      ar.noteFrame(10000);
      // une seule frame saine ne suffit pas (window 3) à remonter
      expect(ar.noteFrame(12000)).to.equal(null);
      expect(ar.current()).to.equal(2000);
    });
  });

  describe("machine à états — checkStarvation (watchdog famine totale)", () => {
    it("sans frame de référence → null", () => {
      const ar = new AdaptiveRate({ intervalMs: 1000, ladder: [1000, 2000] });
      expect(ar.checkStarvation(99999)).to.equal(null);
    });

    it("plus aucune frame depuis > k×cadence → decrease", () => {
      const ar = new AdaptiveRate({
        intervalMs: 1000,
        ladder: [1000, 2000],
        starvationFactor: 1.8,
      });
      ar.noteFrame(0);
      expect(ar.checkStarvation(1700)).to.equal(null); // < 1800
      const d = ar.checkStarvation(1900); // > 1800
      expect(d).to.deep.equal({ intervalMs: 2000, reason: "decrease" });
    });
  });

  describe("bindAdaptiveChannel — câblage socket (mock, sans timer)", () => {
    const noopScheduler: AdaptiveScheduler = {
      set: () => 0,
      clear: () => {},
    };

    it("ré-abonne à un canal plus grossier sous famine, livre les frames, nettoie", () => {
      const socket = new MockSocket();
      let t = 0;
      const received: unknown[] = [];
      const rates: Array<[number, string]> = [];

      const binding = bindAdaptiveChannel(
        socket,
        "metrics",
        (p) => received.push(p),
        {
          intervalMs: 1000,
          defaultMs: 1000,
          ladder: [1000, 2000],
          starvationFactor: 1.8,
          clock: () => t,
          scheduler: noopScheduler,
          onRate: (ms, reason) => rates.push([ms, reason]),
        },
      );

      // Initial : canal nu (cadence === défaut), badge "init".
      expect(binding.channel).to.equal("metrics");
      expect(socket.subscribed()).to.deep.equal(["metrics"]);
      expect(rates[0]).to.deep.equal([1000, "init"]);

      socket.emit("metrics", { v: 1 }); // t=0 : 1ʳᵉ frame
      t = 2000;
      socket.emit("metrics", { v: 2 }); // gap 2000 > 1800 → decrease

      // Bascule vers le canal cadencé grossier ; l'ancien est coupé.
      expect(binding.channel).to.equal("metrics:2000");
      expect(binding.intervalMs).to.equal(2000);
      expect(socket.subscribed()).to.deep.equal(["metrics:2000"]);
      expect(rates).to.deep.equal([
        [1000, "init"],
        [2000, "decrease"],
      ]);

      // Les frames continuent d'arriver sur le nouveau canal.
      t = 6000;
      socket.emit("metrics:2000", { v: 3 });
      expect(received).to.deep.equal([{ v: 1 }, { v: 2 }, { v: 3 }]);

      binding.dispose();
      expect(socket.subscribed()).to.deep.equal([]); // unsubscribe + off
      socket.emit("metrics:2000", { v: 4 }); // après dispose → ignoré
      expect(received).to.have.length(3);
    });

    it("enabled:false → mode fixe : aucune adaptation, cadence figée", () => {
      const socket = new MockSocket();
      let t = 0;
      const received: unknown[] = [];

      const binding = bindAdaptiveChannel(
        socket,
        "metrics",
        (p) => received.push(p),
        {
          intervalMs: 2000,
          defaultMs: 1000, // ≠ désirée → canal cadencé "metrics:2000"
          enabled: false,
          clock: () => t,
          scheduler: noopScheduler,
        },
      );

      expect(binding.channel).to.equal("metrics:2000");
      expect(socket.subscribed()).to.deep.equal(["metrics:2000"]);

      socket.emit("metrics:2000", { v: 1 });
      t = 100000; // famine énorme : en fixe, on NE bascule PAS
      socket.emit("metrics:2000", { v: 2 });

      expect(binding.channel).to.equal("metrics:2000");
      expect(binding.intervalMs).to.equal(2000);
      expect(socket.subscribed()).to.deep.equal(["metrics:2000"]);
      expect(received).to.deep.equal([{ v: 1 }, { v: 2 }]);

      binding.dispose();
      expect(socket.subscribed()).to.deep.equal([]);
    });
  });
});

/** Socket MOCK minimale (pub/sub ref-compté + on/off + emit) pour tester la glue. */
class MockSocket implements IRealtimeSocket {
  private readonly subs = new Map<string, number>();
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();

  subscribe(channel: string): void {
    this.subs.set(channel, (this.subs.get(channel) ?? 0) + 1);
  }
  unsubscribe(channel: string): void {
    const n = this.subs.get(channel) ?? 0;
    if (n <= 1) this.subs.delete(channel);
    else this.subs.set(channel, n - 1);
  }
  on(channel: string, handler: RealtimeHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    return () => this.off(channel, handler);
  }
  off(channel: string, handler: RealtimeHandler): void {
    this.handlers.get(channel)?.delete(handler);
  }
  publish(): void {}
  async request<T = unknown>(): Promise<T> {
    throw new Error("not implemented");
  }
  channel(name: string): IRealtimeChannel {
    return {
      name,
      on: (h) => this.on(name, h),
      send: () => {},
      open: () => this.subscribe(name),
      close: () => this.unsubscribe(name),
    };
  }
  getStats(): IChannelStats[] {
    return [];
  }
  getChannelStats(): IChannelStats | undefined {
    return undefined;
  }
  get subscribedChannels(): string[] {
    return [...this.subs.keys()];
  }

  /** Helper de test : déclenche les handlers d'un canal. */
  emit(channel: string, payload: unknown): void {
    for (const h of this.handlers.get(channel) ?? []) h(payload);
  }
  /** Helper de test : canaux avec ≥ 1 abonnement (triés). */
  subscribed(): string[] {
    return [...this.subs.keys()].sort();
  }
}
