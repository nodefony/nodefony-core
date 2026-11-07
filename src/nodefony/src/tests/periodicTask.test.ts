/**
 * Unit — `schedulePeriodic` / `runOnceAtStartup` / `isLeadWorker` : une tâche de
 * fond ne tourne que quand l'application sert, dans UN worker de la grappe, sans
 * se superposer.
 *
 * Vécu sur une application réelle : un `setInterval` posé dans `init()` tournait
 * aussi pendant `orm:migrate` et chaque commande CLI, et dans chaque worker
 * d'une grappe — l'application avait dû passer à `workers: 1`.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLeadWorker,
  runOnceAtStartup,
  schedulePeriodic,
  type IPeriodicHost,
} from "../kernel/periodicTask";
import Service from "../Service";

class FakeKernel extends EventEmitter {
  runProfile = { servers: true };
  postReady = false;
}

function host(kernel: FakeKernel | null): IPeriodicHost & { errors: string[] } {
  const errors: string[] = [];
  return {
    kernel,
    errors,
    log(message: string) {
      errors.push(message);
    },
  };
}

describe("isLeadWorker — qui porte les tâches uniques", () => {
  it("hors grappe (aucune place) : oui", () => {
    expect(isLeadWorker({})).toBe(true);
  });
  it("place 0 : oui · place 1 : non · valeur illisible : traitée comme hors grappe", () => {
    expect(isLeadWorker({ NF_WORKER_SLOT: "0" })).toBe(true);
    expect(isLeadWorker({ NF_WORKER_SLOT: "1" })).toBe(false);
    expect(isLeadWorker({ NF_WORKER_SLOT: "x" })).toBe(true);
  });
});

describe("schedulePeriodic", () => {
  const saved = process.env.NF_WORKER_SLOT;
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.NF_WORKER_SLOT;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env.NF_WORKER_SLOT;
    else process.env.NF_WORKER_SLOT = saved;
  });

  it("un vrai Service se passe tel quel (contrat structurel)", () => {
    const service = new Service("periodic-contract");
    // Aucun noyau : rien n'est planifié, et ce n'est pas une erreur.
    const stop = schedulePeriodic(service, 1000, () => undefined);
    expect(typeof stop).toBe("function");
  });

  it("attend la fin du démarrage, puis tourne à chaque période", () => {
    const kernel = new FakeKernel();
    const task = vi.fn();
    schedulePeriodic(host(kernel), 1000, task);
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
    kernel.postReady = true;
    kernel.emit("onPostReady");
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("commande CLI (aucun serveur) : ne tourne JAMAIS", () => {
    const kernel = new FakeKernel();
    kernel.runProfile = { servers: false };
    kernel.postReady = true;
    const task = vi.fn();
    schedulePeriodic(host(kernel), 1000, task);
    vi.advanceTimersByTime(10_000);
    expect(task).not.toHaveBeenCalled();
    expect(kernel.listenerCount("onTerminate")).toBe(0);
  });

  it("worker 1 d'une grappe : ne tourne pas — sauf allWorkers", () => {
    process.env.NF_WORKER_SLOT = "1";
    const kernel = new FakeKernel();
    kernel.postReady = true;
    const unique = vi.fn();
    const partout = vi.fn();
    schedulePeriodic(host(kernel), 1000, unique);
    schedulePeriodic(host(kernel), 1000, partout, { allWorkers: true });
    vi.advanceTimersByTime(2000);
    expect(unique).not.toHaveBeenCalled();
    expect(partout).toHaveBeenCalledTimes(2);
  });

  it("un passage asynchrone encore en cours fait SAUTER le suivant", async () => {
    const kernel = new FakeKernel();
    kernel.postReady = true;
    let release: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    schedulePeriodic(host(kernel), 1000, task);
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("une erreur est journalisée sur le service, et la tâche continue", () => {
    const kernel = new FakeKernel();
    kernel.postReady = true;
    const h = host(kernel);
    const task = vi.fn(() => {
      throw new Error("base injoignable");
    });
    schedulePeriodic(h, 1000, task);
    vi.advanceTimersByTime(2000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(h.errors[0]).toMatch(/base injoignable/u);
  });

  it("l'arrêt du noyau arrête la tâche et retire ses écouteurs", () => {
    const kernel = new FakeKernel();
    const task = vi.fn();
    schedulePeriodic(host(kernel), 1000, task);
    kernel.postReady = true;
    kernel.emit("onPostReady");
    kernel.emit("onTerminate");
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
    expect(kernel.listenerCount("onPostReady")).toBe(0);
    expect(kernel.listenerCount("onTerminate")).toBe(0);
  });

  it("une période qui n'est pas un entier ≥ 1 est refusée", () => {
    expect(() => schedulePeriodic(host(null), 0, () => undefined)).toThrow(
      RangeError,
    );
    expect(() => schedulePeriodic(host(null), 1.5, () => undefined)).toThrow(
      RangeError,
    );
  });
});

describe("runOnceAtStartup", () => {
  const saved = process.env.NF_WORKER_SLOT;
  beforeEach(() => {
    delete process.env.NF_WORKER_SLOT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NF_WORKER_SLOT;
    else process.env.NF_WORKER_SLOT = saved;
  });

  it("attend la fin du démarrage, tourne UNE fois, et ne laisse aucun écouteur", () => {
    const kernel = new FakeKernel();
    const task = vi.fn();
    runOnceAtStartup(host(kernel), task);
    expect(task).not.toHaveBeenCalled();
    kernel.postReady = true;
    kernel.emit("onPostReady");
    kernel.emit("onPostReady");
    expect(task).toHaveBeenCalledTimes(1);
    expect(kernel.listenerCount("onPostReady")).toBe(0);
    expect(kernel.listenerCount("onTerminate")).toBe(0);
  });

  it("démarrage déjà fini : tourne tout de suite", () => {
    const kernel = new FakeKernel();
    kernel.postReady = true;
    const task = vi.fn();
    runOnceAtStartup(host(kernel), task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(kernel.listenerCount("onTerminate")).toBe(0);
  });

  it("commande CLI (aucun serveur) : ne tourne JAMAIS", () => {
    const kernel = new FakeKernel();
    kernel.runProfile = { servers: false };
    kernel.postReady = true;
    const task = vi.fn();
    runOnceAtStartup(host(kernel), task);
    kernel.emit("onPostReady");
    expect(task).not.toHaveBeenCalled();
    expect(kernel.listenerCount("onPostReady")).toBe(0);
  });

  it("worker 1 d'une grappe : ne tourne pas · place 0 : tourne", () => {
    process.env.NF_WORKER_SLOT = "1";
    const kernel = new FakeKernel();
    kernel.postReady = true;
    const task = vi.fn();
    runOnceAtStartup(host(kernel), task);
    expect(task).not.toHaveBeenCalled();
    process.env.NF_WORKER_SLOT = "0";
    runOnceAtStartup(host(kernel), task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("une erreur, synchrone ou asynchrone, est journalisée sur le service", async () => {
    const kernel = new FakeKernel();
    kernel.postReady = true;
    const h = host(kernel);
    runOnceAtStartup(h, () => {
      throw new Error("disque plein");
    });
    runOnceAtStartup(h, () => Promise.reject(new Error("tiers injoignable")));
    await Promise.resolve();
    expect(h.errors).toHaveLength(2);
    expect(h.errors[0]).toMatch(/disque plein/u);
    expect(h.errors[1]).toMatch(/tiers injoignable/u);
  });

  it("un arrêt avant la fin du démarrage l'annule et retire ses écouteurs", () => {
    const kernel = new FakeKernel();
    const task = vi.fn();
    runOnceAtStartup(host(kernel), task);
    kernel.emit("onTerminate");
    kernel.emit("onPostReady");
    expect(task).not.toHaveBeenCalled();
    expect(kernel.listenerCount("onPostReady")).toBe(0);
    expect(kernel.listenerCount("onTerminate")).toBe(0);
  });
});
