/// <reference types="node" />
/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Maintenance hors hot-path — GcScheduler (timer + jitter + anti-empilement)
 */

import { expect } from "chai";
import { GcScheduler } from "../runtime/GcScheduler";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("GcScheduler", () => {
  it("runNow() exécute la passe", async () => {
    let calls = 0;
    const gc = new GcScheduler({ intervalS: 1, run: () => void calls++ });
    await gc.runNow();
    expect(calls).to.equal(1);
  });

  it("runNow() anti-empilement — une seule passe concurrente", async () => {
    let active = 0;
    let maxConcurrent = 0;
    const gc = new GcScheduler({
      intervalS: 1,
      run: async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await tick(10);
        active--;
      },
    });
    await Promise.all([gc.runNow(), gc.runNow()]); // la 2e doit être ignorée
    expect(maxConcurrent).to.equal(1);
  });

  it("runNow() ne lève jamais — l'erreur va à onError", async () => {
    let captured: unknown = null;
    const gc = new GcScheduler({
      intervalS: 1,
      run: () => {
        throw new Error("store down");
      },
      onError: (e) => {
        captured = e;
      },
    });
    await gc.runNow(); // ne doit pas rejeter
    expect(captured).to.be.instanceOf(Error);
    expect((captured as Error).message).to.equal("store down");
  });

  it("start() désarmé si intervalS ≤ 0 (délégation cron / TTL natif)", () => {
    let calls = 0;
    const gc = new GcScheduler({ intervalS: 0, run: () => void calls++ });
    expect(gc.start()).to.equal(false);
    expect(gc.armed).to.equal(false);
    expect(calls).to.equal(0);
  });

  it("start() arme et déclenche la 1ʳᵉ passe, stop() désarme", async () => {
    let calls = 0;
    const gc = new GcScheduler({
      intervalS: 1,
      jitter: false,
      initialDelayMs: 0, // départ immédiat pour le test
      run: () => void calls++,
    });
    expect(gc.start()).to.equal(true);
    expect(gc.armed).to.equal(true);
    await tick(20); // laisse le setTimeout(0) tirer la 1ʳᵉ passe
    expect(calls).to.equal(1); // l'intervalle (1 s) ne re-tire pas dans la fenêtre
    gc.stop();
    expect(gc.armed).to.equal(false);
  });

  it("start() idempotent ; stop() idempotent", () => {
    const gc = new GcScheduler({
      intervalS: 1,
      initialDelayMs: 50_000, // ne tire pas pendant le test
      run: () => {},
    });
    expect(gc.start()).to.equal(true);
    expect(gc.start()).to.equal(true); // no-op, reste armé
    expect(gc.armed).to.equal(true);
    gc.stop();
    gc.stop(); // 2e appel = no-op
    expect(gc.armed).to.equal(false);
  });

  it("jitter:false → départ déterministe à initialDelayMs", async () => {
    let calls = 0;
    const gc = new GcScheduler({
      intervalS: 1,
      jitter: false,
      initialDelayMs: 5,
      run: () => void calls++,
    });
    gc.start();
    await tick(2);
    expect(calls).to.equal(0); // pas encore (départ à 5 ms)
    await tick(10);
    expect(calls).to.equal(1);
    gc.stop();
  });
});
