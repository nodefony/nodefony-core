/// <reference types="node" />
/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Maintenance hors hot-path — GcScheduler (timer + jitter + anti-empilement)
 */

import { expect } from "chai";
import { afterEach, vi } from "vitest";
import { GcScheduler } from "../runtime/GcScheduler";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Avance l'horloge SIMULÉE, promesses comprises.
 *
 * Les tests de DÉLAI ne doivent rien devoir à l'horloge de la machine : mesurer
 * un départ « à 5 ms » avec 3 ms de marge, c'est mesurer la charge du runner —
 * et ce test est tombé en intégration continue sur un runner chargé, faisant
 * accuser un commit qui n'y était pour rien. Avec l'horloge simulée, le verdict
 * ne dépend plus de qui d'autre tourne sur la machine.
 *
 * Réservé aux tests de délai : celui de l'anti-empilement se sert du temps pour
 * fabriquer un CHEVAUCHEMENT, pas pour vérifier une échéance, et reste donc en
 * horloge réelle.
 *
 * @param ms - millisecondes à faire passer.
 */
const avancer = (ms: number) => vi.advanceTimersByTimeAsync(ms);

afterEach(() => {
  // Inconditionnel : un test qui échoue AVANT sa restauration laisserait
  // l'horloge simulée aux tests suivants, qui se figeraient sans rapport avec
  // ce qu'ils vérifient.
  vi.useRealTimers();
});

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
    vi.useFakeTimers();
    expect(gc.start()).to.equal(true);
    expect(gc.armed).to.equal(true);
    await avancer(1); // le setTimeout(0) tire la 1ʳᵉ passe
    expect(calls).to.equal(1);
    await avancer(900); // toujours dans l'intervalle (1 s) : aucune 2ᵉ passe
    expect(calls).to.equal(1);
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
    vi.useFakeTimers();
    gc.start();
    await avancer(4);
    expect(calls).to.equal(0, "rien avant l'échéance de 5 ms");
    await avancer(1);
    expect(calls).to.equal(1, "la passe tire À l'échéance, pas après");
    gc.stop();
  });

  it("l'intervalle re-tire à chaque période, sans empiler", async () => {
    let calls = 0;
    const gc = new GcScheduler({
      intervalS: 1,
      jitter: false,
      initialDelayMs: 0,
      run: () => void calls++,
    });
    // Ce que l'horloge réelle rendait intestable : trois périodes exigeraient
    // trois secondes d'attente par exécution de la suite.
    vi.useFakeTimers();
    gc.start();
    await avancer(1);
    expect(calls).to.equal(1);
    await avancer(3000);
    expect(calls).to.equal(4, "une passe par période, ni sautée ni doublée");
    gc.stop();
    await avancer(3000);
    expect(calls).to.equal(4, "stop() désarme pour de bon");
  });
});
