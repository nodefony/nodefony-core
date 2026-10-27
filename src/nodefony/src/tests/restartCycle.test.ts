/*
 *   Cycle de rechargement du superviseur de développement (`RestartCycle`).
 *
 *   Deux défauts ont motivé l'extraction de ce cycle hors de `DevSupervisor` :
 *   - une sauvegarde tombée pendant un build EN ÉCHEC n'était jamais rejouée —
 *     le développeur venait de sauver sa correction, et le message lui disait
 *     « corrige puis sauvegarde » ; le cycle suivant relançait ensuite le
 *     serveur pour rien ;
 *   - une sauvegarde tombée pendant l'ARRÊT de l'ancien serveur lançait un
 *     second cycle concurrent : deux serveurs relancés sur les mêmes ports, le
 *     premier devenu orphelin.
 *   Les étapes (build, remplacement) sont simulées : on éprouve l'ordonnancement,
 *   pas turbo ni les process.
 */

import assert from "node:assert";
import { afterEach, beforeEach, vi } from "vitest";
import { RestartCycle, type IRestartSteps } from "../service/dev/restartCycle";

const DEBOUNCE = 250;
const RECHECK = 1000;

interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Étapes simulées : chaque build et chaque remplacement attend qu'on le libère. */
function fakeSteps() {
  const builds: Array<{ files: string[]; done: IDeferred<boolean> }> = [];
  const swaps: Array<IDeferred<void>> = [];
  let swapsInFlight = 0;
  let maxSwapsInFlight = 0;
  let buildsInFlight = 0;
  let overlap = false;
  const state = { stopping: false, suspended: false, replays: 0 };
  const steps: IRestartSteps = {
    isStopping: () => state.stopping,
    isSuspended: () => state.suspended,
    build(files) {
      if (buildsInFlight > 0 || swapsInFlight > 0) overlap = true;
      buildsInFlight++;
      const done = deferred<boolean>();
      builds.push({ files: [...files].sort(), done });
      return done.promise.finally(() => {
        buildsInFlight--;
      });
    },
    swap() {
      swapsInFlight++;
      maxSwapsInFlight = Math.max(maxSwapsInFlight, swapsInFlight);
      const done = deferred<void>();
      swaps.push(done);
      return done.promise.finally(() => {
        swapsInFlight--;
      });
    },
    onReplay() {
      state.replays++;
    },
  };
  return {
    steps,
    state,
    builds,
    swaps,
    get maxSwapsInFlight() {
      return maxSwapsInFlight;
    },
    get overlap() {
      return overlap;
    },
  };
}

describe("RestartCycle — cycle de rechargement du superviseur", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("regroupe une rafale de sauvegardes en UN cycle qui porte tous les fichiers", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    cycle.mark("a.ts");
    await vi.advanceTimersByTimeAsync(100);
    cycle.mark("b.ts");
    await vi.advanceTimersByTimeAsync(100);
    cycle.mark("a.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    assert.strictEqual(fake.builds.length, 1);
    assert.deepStrictEqual(fake.builds[0]?.files, ["a.ts", "b.ts"]);
  });

  it("une sauvegarde pendant l'ARRÊT du serveur ne lance pas un second cycle concurrent", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    cycle.mark("a.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.builds[0]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    assert.strictEqual(fake.swaps.length, 1, "le remplacement a commencé");
    assert.ok(cycle.busy, "le cycle reste occupé pendant le remplacement");

    // Sauvegarde pendant l'arrêt de l'ancien serveur.
    cycle.mark("b.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4);
    assert.strictEqual(fake.builds.length, 1, "aucun build concurrent");

    fake.swaps[0]?.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    assert.strictEqual(fake.builds.length, 2, "la sauvegarde est rejouée");
    assert.deepStrictEqual(fake.builds[1]?.files, ["b.ts"]);
    fake.builds[1]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    fake.swaps[1]?.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4);

    assert.strictEqual(fake.maxSwapsInFlight, 1);
    assert.strictEqual(fake.overlap, false);
    assert.strictEqual(fake.state.replays, 1);
  });

  it("une sauvegarde pendant un build EN ÉCHEC est rejouée sans qu'on resauvegarde", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    cycle.mark("erreur.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    // La correction arrive pendant le build qui va échouer.
    cycle.mark("correction.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.builds[0]?.done.resolve(false);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    assert.strictEqual(
      fake.swaps.length,
      0,
      "build en échec : serveur conservé",
    );
    assert.strictEqual(fake.builds.length, 2, "la correction part d'elle-même");
    assert.deepStrictEqual(fake.builds[1]?.files, ["correction.ts"]);
    fake.builds[1]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    assert.strictEqual(fake.swaps.length, 1);
  });

  it("ne relance jamais le serveur pour rien après un rejeu", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    cycle.mark("erreur.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    cycle.mark("correction.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.builds[0]?.done.resolve(false);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.builds[1]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    fake.swaps[0]?.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);
    // Une sauvegarde ordinaire ensuite : UN cycle, pas deux.
    cycle.mark("suite.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.builds[2]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    fake.swaps[1]?.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);
    assert.strictEqual(fake.builds.length, 3);
    assert.strictEqual(fake.swaps.length, 2);
  });

  it("diffère le cycle tant que le serveur écrit dans les sources, sans perdre un fichier", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    fake.state.suspended = true;
    cycle.mark("genere.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + RECHECK * 3);
    assert.strictEqual(fake.builds.length, 0);
    fake.state.suspended = false;
    await vi.advanceTimersByTimeAsync(RECHECK);
    assert.strictEqual(fake.builds.length, 1);
    assert.deepStrictEqual(fake.builds[0]?.files, ["genere.ts"]);
  });

  it("un arrêt demandé : plus aucun cycle, et cancel() efface l'anti-rebond", async () => {
    const fake = fakeSteps();
    const cycle = new RestartCycle(fake.steps, {
      debounceMs: DEBOUNCE,
      recheckMs: RECHECK,
    });
    cycle.mark("a.ts");
    cycle.cancel();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4);
    assert.strictEqual(fake.builds.length, 0);

    // Arrêt demandé PENDANT le build : pas de remplacement, pas de rejeu.
    cycle.mark("b.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    cycle.mark("c.ts");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.state.stopping = true;
    fake.builds[0]?.done.resolve(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4);
    assert.strictEqual(fake.swaps.length, 0);
    assert.strictEqual(fake.builds.length, 1);
  });
});
