/**
 * L'échantillonneur runtime du serveur de développement : deltas exacts sur
 * l'intervalle, premier échantillon après UN intervalle, arrêt idempotent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startRuntimeSampler } from "../service/dev/runtimeSampler";
import type { IRuntimeSample } from "../service/dev/startupScreen";

afterEach(() => {
  vi.useRealTimers();
});

describe("startRuntimeSampler", () => {
  it("CPU en % d'un cœur et boucle en %, mesurés sur l'intervalle — UNE lecture par source et par tick", () => {
    vi.useFakeTimers();
    let clock = 0;
    let cpuReads = 0;
    let eluReads = 0;
    const samples: IRuntimeSample[] = [];
    const stop = startRuntimeSampler((s) => samples.push(s), 1000, {
      rss: () => 100,
      // Relevés CUMULÉS : 500 ms de CPU (user + system) consommées sur 1 s
      // d'horloge, boucle active 250 ms sur 1000.
      cpuUsage: () =>
        cpuReads++ === 0
          ? { user: 0, system: 0 }
          : { user: 300_000, system: 200_000 },
      elu: () =>
        eluReads++ === 0
          ? { idle: 0, active: 0, utilization: 0 }
          : { idle: 750, active: 250, utilization: 0.25 },
      now: () => clock,
    });
    expect(samples).to.have.length(0); // un delta exige deux points
    clock = 1000;
    vi.advanceTimersByTime(1000);
    expect(samples).to.deep.equal([
      { rssBytes: 100, cpuPercent: 50, eluPercent: 25 },
    ]);
    // Un relevé au départ, un par tick : le précédent sert de référence.
    expect([cpuReads, eluReads]).to.deep.equal([2, 2]);
    stop();
    stop(); // idempotent
    vi.advanceTimersByTime(5000);
    expect(samples).to.have.length(1);
    expect(vi.getTimerCount()).to.equal(0);
  });
});

describe("startRuntimeSampler — sur les VRAIES sources de Node", () => {
  // Le test ci-dessus injecte ses sources : il ne voyait pas un appel faux à
  // `performance.eventLoopUtilization` (qui tuait le serveur au premier tick).
  it("le premier échantillon arrive, fini, sans exception", async () => {
    const samples: IRuntimeSample[] = [];
    const stop = startRuntimeSampler((s) => samples.push(s), 20);
    await new Promise((resolve) => setTimeout(resolve, 80));
    stop();
    expect(samples.length).to.be.greaterThan(0);
    const first = samples[0] as IRuntimeSample;
    expect(Number.isFinite(first.rssBytes) && first.rssBytes > 0).to.equal(
      true,
    );
    expect(Number.isFinite(first.cpuPercent)).to.equal(true);
    expect(first.eluPercent).to.be.within(0, 100);
  });

  it("une source qui lève arrête l'échantillonneur, jamais le processus", () => {
    vi.useFakeTimers();
    const stop = startRuntimeSampler(() => {}, 10, {
      rss: () => {
        throw new Error("rss indisponible");
      },
      cpuUsage: () => ({ user: 0, system: 0 }),
      elu: () => ({ idle: 0, active: 0, utilization: 0 }),
      now: () => 0,
    });
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(vi.getTimerCount()).to.equal(0);
    stop();
  });
});
