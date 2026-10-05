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
  it("CPU en % d'un cœur et boucle en %, mesurés sur l'intervalle", () => {
    vi.useFakeTimers();
    let clock = 0;
    const samples: IRuntimeSample[] = [];
    const stop = startRuntimeSampler((s) => samples.push(s), 1000, {
      rss: () => 100,
      // 500 ms de CPU (user + system) consommées sur 1 s d'horloge.
      cpuUsage: (previous) =>
        previous ? { user: 300_000, system: 200_000 } : { user: 0, system: 0 },
      elu: (_current, previous) => ({
        idle: 0,
        active: 0,
        utilization: previous ? 0.25 : 0,
      }),
      now: () => clock,
    });
    expect(samples).to.have.length(0); // un delta exige deux points
    clock = 1000;
    vi.advanceTimersByTime(1000);
    expect(samples).to.deep.equal([
      { rssBytes: 100, cpuPercent: 50, eluPercent: 25 },
    ]);
    stop();
    stop(); // idempotent
    vi.advanceTimersByTime(5000);
    expect(samples).to.have.length(1);
    expect(vi.getTimerCount()).to.equal(0);
  });
});
