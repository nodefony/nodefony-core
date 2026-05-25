/// <reference types="node" />
/**
 * Unit — providers temps réel Studio (`nodefony/realtime/providers.ts`).
 *
 * Cible le coalescing syslog (le fix du LAG Studio sous charge messages, commit
 * f82b3de) et le ticker de stats. Logique pure (node:os/v8/perf_hooks) → testable
 * sans serveur, en fake timers déterministes.
 *
 * Invariants verrouillés :
 *  - lazy (aucun publish/timer avant le 1er log),
 *  - 1 frame agrégée `{logs, dropped}` par fenêtre `flushMs`,
 *  - ring buffer borné `maxBatch` → écrase le + ancien + compte `dropped`,
 *  - dispose() détache le listener ET désarme le timer (zéro fuite — règle perf).
 */
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import {
  createSyslogBridge,
  createStatsTicker,
  CHANNELS,
  INSTANCE_ID,
  type Publish,
} from "../../realtime/providers";

/** Faux syslog EventEmitter-like (on/removeListener) + emit/count pour les assertions. */
function fakeSyslog() {
  const map = new Map<string, Set<(...a: unknown[]) => void>>();
  return {
    on(ev: string, fn: (...a: unknown[]) => void) {
      let set = map.get(ev);
      if (!set) map.set(ev, (set = new Set()));
      set.add(fn);
    },
    removeListener(ev: string, fn: (...a: unknown[]) => void) {
      map.get(ev)?.delete(fn);
    },
    emit(ev: string, ...args: unknown[]) {
      map.get(ev)?.forEach((fn) => fn(...args));
    },
    count(ev: string) {
      return map.get(ev)?.size ?? 0;
    },
  };
}

type Frame = { logs: unknown[]; dropped: number };

describe("realtime providers — CHANNELS / INSTANCE_ID", () => {
  it("canaux figés (contrat front + futur RealtimeService)", () => {
    expect(CHANNELS.syslog).to.equal("syslog:stream");
    expect(CHANNELS.supervision).to.equal("dashboard:supervision");
  });
  it("INSTANCE_ID = string non vide (défaut = pid)", () => {
    expect(INSTANCE_ID).to.be.a("string");
    expect(INSTANCE_ID.length).to.be.above(0);
  });
});

describe("createSyslogBridge — coalescing (fix lag Studio)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("attache le listener onLog ; lazy : aucun publish/timer avant le 1er log", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, { flushMs: 200 });
    expect(syslog.count("onLog"), "1 listener attaché").to.equal(1);
    vi.advanceTimersByTime(1000);
    expect(publish.mock.calls.length, "lazy : aucun publish sans log").to.equal(
      0,
    );
    dispose();
  });

  it("agrège N logs en 1 frame après flushMs, ordre préservé", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, {
      flushMs: 200,
      maxBatch: 500,
    });

    syslog.emit("onLog", "a");
    syslog.emit("onLog", "b");
    syslog.emit("onLog", "c");
    expect(publish.mock.calls.length, "rien avant la fenêtre").to.equal(0);

    vi.advanceTimersByTime(200);
    expect(publish.mock.calls.length, "1 seule frame agrégée").to.equal(1);
    const [channel, payload] = publish.mock.calls[0] as [string, Frame];
    expect(channel).to.equal(CHANNELS.syslog);
    expect(payload.logs).to.deep.equal(["a", "b", "c"]);
    expect(payload.dropped).to.equal(0);
    dispose();
  });

  it("fenêtre suivante repart vide (reset après flush)", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, { flushMs: 100 });

    syslog.emit("onLog", "x");
    vi.advanceTimersByTime(100);
    syslog.emit("onLog", "y");
    syslog.emit("onLog", "z");
    vi.advanceTimersByTime(100);

    expect(publish.mock.calls.length).to.equal(2);
    expect((publish.mock.calls[0][1] as Frame).logs).to.deep.equal(["x"]);
    expect((publish.mock.calls[1][1] as Frame).logs).to.deep.equal(["y", "z"]);
    dispose();
  });

  it("ring buffer borné : écrase le + ancien au-delà de maxBatch et compte dropped", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, {
      flushMs: 50,
      maxBatch: 3,
    });

    // 5 logs, cap 3 → garde les 3 + récents (c,d,e), 2 omis.
    for (const l of ["a", "b", "c", "d", "e"]) syslog.emit("onLog", l);
    vi.advanceTimersByTime(50);

    const payload = publish.mock.calls[0][1] as Frame;
    expect(payload.logs).to.deep.equal(["c", "d", "e"]);
    expect(payload.dropped, "2 logs omis sous surcharge").to.equal(2);
    dispose();
  });

  it("idle après flush : timer désarmé, aucun publish fantôme", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, { flushMs: 100 });

    syslog.emit("onLog", "1");
    vi.advanceTimersByTime(100);
    expect(publish.mock.calls.length).to.equal(1);
    vi.advanceTimersByTime(1000); // silence
    expect(publish.mock.calls.length, "pas de flush sans log").to.equal(1);
    dispose();
  });

  it("dispose() détache le listener ET désarme un flush en attente (zéro fuite)", () => {
    const syslog = fakeSyslog();
    const publish = vi.fn();
    const dispose = createSyslogBridge(syslog, publish, { flushMs: 200 });

    syslog.emit("onLog", "pending"); // arme le timer
    dispose(); // avant la fenêtre
    expect(syslog.count("onLog"), "listener détaché").to.equal(0);
    vi.advanceTimersByTime(500);
    expect(
      publish.mock.calls.length,
      "le flush en attente est annulé",
    ).to.equal(0);
  });
});

describe("createStatsTicker — heartbeat dashboard:supervision", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publie sur dashboard:supervision à chaque intervalMs", () => {
    const publish = vi.fn();
    const dispose = createStatsTicker(publish, 1000);
    expect(publish.mock.calls.length, "rien avant le 1er tick").to.equal(0);
    vi.advanceTimersByTime(1000);
    expect(publish.mock.calls.length).to.equal(1);
    vi.advanceTimersByTime(1000);
    expect(publish.mock.calls.length).to.equal(2);
    expect(publish.mock.calls[0][0]).to.equal(CHANNELS.supervision);
    dispose();
  });

  it("payload : forme runtime attendue (per-instance, cloud-native)", () => {
    const publish = vi.fn();
    const dispose = createStatsTicker(publish, 1000);
    vi.advanceTimersByTime(1000);
    const p = publish.mock.calls[0][1] as Record<string, unknown>;
    expect(p.instanceId).to.equal(INSTANCE_ID);
    expect(p.pid).to.be.a("number");
    expect(p.uptime).to.be.a("number");
    expect(p.cpuPercent).to.be.a("number");
    expect(p.cpuPercent as number).to.be.within(0, 100);
    expect(p.cpuCount as number).to.be.at.least(1);
    expect(p.eventLoopMs).to.be.a("number");
    expect(p.loadavg).to.be.an("array").with.length(3);
    const mem = p.memory as Record<string, number>;
    for (const k of ["rss", "heapUsed", "heapTotal", "heapLimit", "external"]) {
      expect(mem[k], `memory.${k}`).to.be.a("number");
    }
    dispose();
  });

  it("dispose() arrête le ticker (plus aucun tick)", () => {
    const publish = vi.fn();
    const dispose = createStatsTicker(publish, 500);
    vi.advanceTimersByTime(500);
    expect(publish.mock.calls.length).to.equal(1);
    dispose();
    vi.advanceTimersByTime(5000);
    expect(publish.mock.calls.length, "0 tick après dispose").to.equal(1);
  });
});

// `Publish` est bien le type contractuel (compile-time guard).
const _typeGuard: Publish = (_c: string, _p: unknown) => {};
void _typeGuard;
