/**
 * Les services portés AUX LIMITES (ADR-0030 §D6, audit de #692) — ce qui ne
 * se voit qu'en poussant le teneur et le registre dans leurs coins : hôte
 * condamné qui tarde à sortir, arrêt qui croise un démarrage, rapports
 * forgés, déluge de sortie, descendants laissés derrière un plantage,
 * rafales de plans, superviseur tué net. Tout sur de VRAIS process.
 *
 * Règle de ces tests : une ABSENCE (pas de second hôte, pas de relance) se
 * constate par un TÉMOIN sur une seule horloge — l'état publié à l'instant
 * où la chose interdite aurait lieu —, jamais par une attente au jugé.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  DEV_CHANNEL,
  type IDevHeldPlan,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import {
  isPidAlive,
  terminateDevProcesses,
  type DevProcessInfo,
} from "../service/dev/devProcess";
import {
  HELD_CHANNEL,
  MAX_HELD_DATA_LENGTH,
  isHeldHostMessage,
  isHeldHostStatus,
  serveHeldService,
  type HeldHostMessage,
  type HeldJsonObject,
} from "../service/dev/heldChannel";
import {
  HostHolder,
  type IHostHolderOptions,
  type IHeldHostStatus,
} from "../service/dev/HostHolder";
import { HeldServiceRegistry } from "../service/dev/heldServices";
import { HELD_HOST_CWD } from "./fixtures/held/hostCwd";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
);
const HOST = path.join(FIXTURES, "host.mjs");
const ROGUE = path.join(FIXTURES, "rogue.mjs");
const HOLDER = path.join(FIXTURES, "holder.mjs");
const GRACEFUL_HOLDER = path.join(FIXTURES, "holder-graceful.mjs");
const TSX = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx/esm"),
).href;

const dir = mkdtempSync(path.join(os.tmpdir(), "nf-held-limits-"));
let markers = 0;
const marker = (): string => path.join(dir, `m${++markers}`);
/** PID à tuer en fin de test s'ils survivent (un échec ne doit rien laisser). */
const strays: number[] = [];

const hosts: HostHolder[] = [];
const registries: HeldServiceRegistry[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
  await Promise.all(registries.splice(0).map((r) => r.stopAll()));
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // déjà mort : c'est ce qu'on voulait
    }
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface IObserved {
  readonly host: HostHolder;
  readonly statuses: IHeldHostStatus[];
  readonly states: () => string[];
}

function makeHost(
  spec: HeldJsonObject,
  extra: Partial<IHostHolderOptions> = {},
  probe?: (status: IHeldHostStatus) => void,
): IObserved {
  const statuses: IHeldHostStatus[] = [];
  const host = new HostHolder({
    key: `limits:${typeof spec.mode === "string" ? spec.mode : "?"}`,
    module: HOST,
    spec,
    cwd: HELD_HOST_CWD,
    env: { ...process.env },
    startupTimeoutMs: 5_000,
    restartBackoffBaseMs: 10,
    restartBackoffMaxMs: 20,
    livenessIntervalMs: 0,
    onStatus: (s) => {
      statuses.push(s);
      probe?.(s);
    },
    ...extra,
  });
  hosts.push(host);
  return { host, statuses, states: () => statuses.map((s) => s.state) };
}

/** Sondage borné d'une condition — jamais une horloge à seuil. */
async function until<T>(
  read: () => T | undefined | false,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error("condition jamais atteinte");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe("L1 — un hôte condamné qui tarde à sortir (audit B1)", () => {
  it("le nouvel hôte ne naît qu'après la MORT de l'ancien : jamais deux sur le même port, jamais de faux plantage", async () => {
    const m = marker();
    // Témoin, sur une seule horloge : à l'instant où le second hôte reçoit
    // son PID, le premier vit-il encore ?
    let oldPid = 0;
    let oldAliveAtSpawn: boolean | null = null;
    const { host, states } = makeHost(
      { mode: "fail-once-slow-stop", marker: m },
      {},
      (s) => {
        if (oldPid !== 0 && s.pid !== null && s.pid !== oldPid) {
          oldAliveAtSpawn ??= isPidAlive(oldPid);
        }
      },
    );
    await expect(host.start()).rejects.toThrow("échec une fois (fixture)");
    oldPid = Number(readFileSync(m, "utf8"));
    strays.push(oldPid);
    const ready = await host.start();
    expect(oldAliveAtSpawn).toBe(false);
    expect(ready.pid).not.toBe(oldPid);
    // Au-delà de l'arrêt lent (1 s) de l'ancien : rien ne doit avoir bougé.
    await sleep(1_300);
    expect(host.status()).toMatchObject({
      state: "ready",
      pid: ready.pid,
      restartCount: 0,
    });
    expect(states()).not.toContain("crashed");
    expect(isPidAlive(ready.pid as number)).toBe(true);
  });
});

describe("L2 — un arrêt qui croise un démarrage ou une relance (audit I1)", () => {
  it("un `ready` arrivé PENDANT l'arrêt est refusé : start() rejeté, jamais `ready`, aucune relance", async () => {
    const statuses: IHeldHostStatus[] = [];
    const host = new HostHolder({
      key: "limits:rogue",
      module: ROGUE,
      spec: { mode: "ready-after-stop", readyMs: 250 },
      cwd: HELD_HOST_CWD,
      env: { ...process.env },
      startupTimeoutMs: 5_000,
      restartBackoffBaseMs: 10,
      livenessIntervalMs: 0,
      onStatus: (s) => statuses.push(s),
    });
    hosts.push(host);
    const started = host.start();
    const settled = started.then(
      () => "résolu",
      (e: unknown) => (e as Error).message,
    );
    await sleep(100);
    await host.stop();
    expect(await settled).toBe('held host "limits:rogue" stopped before ready');
    const states = statuses.map((s) => s.state);
    expect(states).not.toContain("ready");
    expect(states).not.toContain("crashed");
    expect(states).not.toContain("restarting");
    expect(host.status()).toMatchObject({ state: "stopped", pid: null });
  });

  it("côté hôte : un service prêt APRÈS un `stop` ne rapporte jamais `ready`", async () => {
    const sent: HeldHostMessage[] = [];
    const listeners: ((m: unknown) => void)[] = [];
    let release: (data: HeldJsonObject) => void = () => {};
    let exited = false;
    serveHeldService(
      {
        start: () =>
          new Promise<HeldJsonObject>((resolve) => {
            release = resolve;
          }),
        stop: () => Promise.resolve(),
      },
      {
        connected: true,
        send: (m) => {
          sent.push(m);
          return true;
        },
        on: (event: string, listener: (m: unknown) => void) => {
          if (event === "message") listeners.push(listener);
        },
        exit: () => {
          exited = true;
        },
      },
    );
    const deliver = (m: unknown): void => {
      for (const l of listeners) l(m);
    };
    deliver({ channel: HELD_CHANNEL, type: "start", key: "t:a", spec: {} });
    deliver({ channel: HELD_CHANNEL, type: "stop" });
    release({ port: 1 });
    await until(() => exited);
    expect(sent.filter((m) => m.type === "report")).toEqual([]);
  });

  it("stop() appelé trois fois d'affilée : une seule fin, l'hôte mort", async () => {
    const { host } = makeHost({ mode: "ok" });
    const { pid } = await host.start();
    const stops = [host.stop(), host.stop(), host.stop()];
    expect(stops[1]).toBe(stops[0]);
    await Promise.all(stops);
    expect(isPidAlive(pid as number)).toBe(false);
    expect(host.status()).toMatchObject({ state: "stopped", pid: null });
  });

  it("kill() pendant un arrêt, puis start() : l'arrêt passé ne déclare pas `stopped` le NOUVEL hôte (audit #692, M1)", async () => {
    const { host } = makeHost({ mode: "ignore-stop" }, { stopGraceMs: 10_000 });
    const first = await host.start();
    strays.push(first.pid as number);
    const stopping = host.stop();
    host.kill();
    const second = await host.start();
    strays.push(second.pid as number);
    expect(second.pid).not.toBe(first.pid);
    await stopping;
    expect(host.status()).toMatchObject({ state: "ready", pid: second.pid });
  });

  it("stop() pendant le recul d'une relance : la relance n'a jamais lieu", async () => {
    let afterStop = 0;
    let stopped = false;
    const { host } = makeHost(
      { mode: "crash-after-ready" },
      { restartBackoffBaseMs: 600, restartBackoffMaxMs: 600 },
      (s) => {
        if (stopped && s.state !== "stopped") afterStop++;
      },
    );
    await host.start();
    await until(() => host.status().state === "restarting");
    await host.stop();
    stopped = true;
    // Le recul (600 ms) est écoulé : sans la garde d'époque, un hôte serait né.
    await sleep(800);
    expect(afterStop).toBe(0);
    expect(host.status()).toMatchObject({ state: "stopped", pid: null });
  });
});

describe("L3 — un PID rendu au système n'est plus jamais visé (audit I2)", () => {
  it("après la sortie d'un hôte en échec, l'instantané ne porte plus son PID", async () => {
    const { host } = makeHost({ mode: "fail" });
    await expect(host.start()).rejects.toThrow("port occupé (fixture)");
    const s = await until(() => {
      const x = host.status();
      return x.pid === null ? x : undefined;
    });
    expect(s.state).toBe("errored");
  });

  it("kill() : synchrone, l'arbre vivant tué, plus aucune relance", async () => {
    const { host, states } = makeHost({ mode: "ok" });
    const { pid } = await host.start();
    host.kill();
    expect(host.status().state).toBe("stopped");
    await until(() => !isPidAlive(pid as number));
    await sleep(100);
    expect(
      states()
        .slice(-2)
        .every((s) => s === "stopped"),
    ).toBe(true);
    expect(host.status().pid).toBe(null);
  });
});

describe.skipIf(process.platform === "win32")(
  "L4 — les descendants d'un hôte planté (audit I3, POSIX)",
  () => {
    it("le petit-enfant laissé par un hôte planté est tué : il tiendrait le port de la relance", async () => {
      const m = marker();
      const { host } = makeHost(
        { mode: "grandchild-then-crash", marker: m },
        { maxRestarts: 3 },
      );
      await host.start();
      await until(() => {
        const s = host.status();
        return s.state === "ready" && s.restartCount === 1;
      });
      const grandchild = Number(readFileSync(m, "utf8"));
      strays.push(grandchild);
      await until(() => !isPidAlive(grandchild), 3_000);
    });
  },
);

describe("L5 — un hôte qui meurt avant `ready` dit pourquoi (audit M2)", () => {
  it("la fin de sa sortie d'erreur accompagne l'échec, même sans lecteur de sortie", async () => {
    const { host } = makeHost({ mode: "die-loudly" });
    await expect(host.start()).rejects.toThrow(
      /exited before ready \(code 1\): SyntaxError: fixture illisible/,
    );
  });
});

describe("L5b — la cause d'un hôte mort se lit à la fin des FLUX, pas à `exit` (audit #692, I2)", () => {
  it("teneur OCCUPÉ quand l'hôte écrit sa cause puis meurt : la dernière ligne est dans l'échec et au lecteur", async () => {
    // Le cas réel : le superviseur a sa boucle prise (rendu, build) au moment
    // où l'hôte écrit et sort. À son réveil, la sortie du process ET la fin du
    // tube sont prêtes ensemble, et `exit` peut passer AVANT les dernières
    // données. La donnée tient dans un tampon de tube : l'hôte sort sans
    // attendre qu'on le lise.
    const bytes = 16 * 1024;
    const last = "SyntaxError: fin du déluge";
    for (let i = 0; i < 1; i++) {
      let received = 0;
      let tailSeen = "";
      let blocked = false;
      const { host } = makeHost(
        { mode: "die-loudly-big", bytes },
        {
          onOutput: (stream, lines) => {
            if (stream !== "err") return;
            received += lines.length;
            tailSeen = lines.toString("utf8", Math.max(0, lines.length - 64));
          },
        },
        (s) => {
          // Juste après le `fork` (le `start` part dans le même tour) : la
          // boucle du teneur est prise le temps que l'hôte écrive et meure.
          if (s.pid === null || blocked) return;
          blocked = true;
          setImmediate(() => {
            const until = Date.now() + 1_500;
            while (Date.now() < until) {
              // boucle tenue : rien n'est lu pendant ce temps
            }
          });
        },
      );
      const message = await host.start().then(
        () => "résolu",
        (e: unknown) => (e as Error).message,
      );
      expect(message, `essai ${i}`).toMatch(
        /exited before ready \(code 1\): y+\nSyntaxError: fin du déluge$/,
      );
      // Tout ce que l'hôte a écrit est arrivé au lecteur, dernière ligne comprise.
      expect(received, `essai ${i}`).toBe(
        bytes + 1 + Buffer.byteLength(last) + 1,
      );
      expect(tailSeen.endsWith(`${last}\n`), `essai ${i}`).toBe(true);
    }
  });
});

describe("L6 — un déluge de sortie (rempart D6)", () => {
  it("une ligne de 10 Mo sans fin arrive ENTIÈRE, en morceaux bornés — la mémoire du teneur ne la retient pas", async () => {
    const bytes = 10 * 1024 * 1024;
    let total = 0;
    let largest = 0;
    let last = "";
    const { host } = makeHost(
      { mode: "flood-line", bytes },
      {
        onOutput: (stream, lines) => {
          if (stream !== "out") return;
          total += lines.length;
          largest = Math.max(largest, lines.length);
          last = lines.toString("latin1", lines.length - 1);
        },
      },
    );
    await host.start();
    await until(() => total === bytes + 1);
    expect(last).toBe("\n");
    // Borne : une ligne partielle plafonne à 64 Kio, plus un morceau de tube.
    expect(largest).toBeLessThanOrEqual(2 * 64 * 1024);
  });
});

describe("L7 — rapports forgés, démesurés, répétés (rempart D6)", () => {
  it("le teneur ne lit que le premier `ready` bien formé : un seul `ready` publié, le reste ignoré", async () => {
    const statuses: IHeldHostStatus[] = [];
    const host = new HostHolder({
      key: "limits:forged",
      module: ROGUE,
      spec: { mode: "forged", hugeSize: MAX_HELD_DATA_LENGTH + 1 },
      cwd: HELD_HOST_CWD,
      env: { ...process.env },
      startupTimeoutMs: 5_000,
      livenessIntervalMs: 0,
      onStatus: (s) => statuses.push(s),
    });
    hosts.push(host);
    const ready = await host.start();
    expect(ready.data).toEqual({ n: 1 });
    // Le `failed` tardif est le dernier message envoyé : passé lui, plus rien.
    await sleep(300);
    expect(statuses.filter((s) => s.state === "ready")).toHaveLength(1);
    expect(host.status()).toMatchObject({ state: "ready", data: { n: 1 } });
  });

  it("une donnée démesurée : l'hôte nomme la cause au lieu de se taire jusqu'au délai", async () => {
    const { host } = makeHost({
      mode: "huge-data",
      size: MAX_HELD_DATA_LENGTH + 1,
    });
    await expect(host.start()).rejects.toThrow(
      `ready data exceeds ${MAX_HELD_DATA_LENGTH} JSON characters`,
    );
  });

  it("la borne de la donnée vaut sur les DEUX canaux (nf-held et l'instantané de nf-dev)", () => {
    const huge = { blob: "x".repeat(MAX_HELD_DATA_LENGTH) };
    expect(
      isHeldHostMessage({
        channel: HELD_CHANNEL,
        type: "report",
        state: "ready",
        data: huge,
        reason: null,
      }),
    ).toBe(false);
    expect(
      isHeldHostStatus({
        key: "k",
        state: "ready",
        pid: 1,
        data: huge,
        lastError: null,
        restartCount: 0,
      }),
    ).toBe(false);
  });
});

describe("L9 — plantages en rafale (rempart D6, tempête de relances)", () => {
  it("errored après maxRestarts, et EXACTEMENT maxRestarts + 1 hôtes lancés — jamais un de plus", async () => {
    const { host, statuses } = makeHost(
      { mode: "crash-after-ready" },
      { maxRestarts: 3 },
    );
    await host.start();
    await until(() => host.status().state === "errored");
    // Le recul est de 20 ms au plus : laissé dix fois, rien ne doit plus naître.
    await sleep(200);
    const pids = new Set(
      statuses.map((s) => s.pid).filter((p): p is number => p !== null),
    );
    expect(pids.size).toBe(4);
    expect(host.status().state).toBe("errored");
  });
});

// --- Registre ---------------------------------------------------------------

function makeRegistry(): {
  registry: HeldServiceRegistry;
  events: IHeldHostStatus[];
} {
  const events: IHeldHostStatus[] = [];
  const registry = new HeldServiceRegistry({
    baseEnv: { ...process.env },
    onState: (_owner, status) => events.push(status),
    onOutput: () => {},
  });
  registries.push(registry);
  return { registry, events };
}

function declaration(
  key: string,
  fingerprint: string,
): IHeldServiceDeclaration {
  return {
    key,
    module: HOST,
    fingerprint,
    spec: { mode: "ok", tag: fingerprint },
    cwd: HELD_HOST_CWD,
    env: {},
    tuning: { startupTimeoutMs: 5_000, maxRestarts: 0 },
  };
}

let planId = 0;
function plan(services: IHeldServiceDeclaration[]): IDevHeldPlan {
  return {
    channel: DEV_CHANNEL,
    type: "held-plan",
    id: ++planId,
    owner: "frontend",
    services,
  };
}

/** Tous les PID d'hôtes rapportés prêts (la donnée porte le PID réel). */
function readyPids(events: IHeldHostStatus[]): Set<number> {
  const pids = new Set<number>();
  for (const e of events) {
    const pid = e.data?.pid;
    if (e.state === "ready" && typeof pid === "number") pids.add(pid);
  }
  return pids;
}

describe("L10 — 50 plans alternés en rafale sur une même clé", () => {
  it("à la fin : UN seul hôte vivant, celui du DERNIER plan, aucun orphelin", async () => {
    const { registry, events } = makeRegistry();
    for (let i = 0; i < 50; i++) {
      const ack = registry.apply(
        plan([declaration("vite:a", i % 2 === 0 ? "f-even" : "f-odd")]),
      );
      expect(ack.accepted).toBe(true);
    }
    // Le dernier plan (i = 49) déclare `f-odd`.
    const final = await until(() => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.state === "ready" && e.data?.tag === "f-odd") return e;
      }
      return undefined;
    }, 30_000);
    const finalPid = final.data?.pid as number;
    for (const pid of readyPids(events)) if (pid !== finalPid) strays.push(pid);
    await until(
      () =>
        [...readyPids(events)].every((p) => p === finalPid || !isPidAlive(p)),
      10_000,
    );
    expect(isPidAlive(finalPid)).toBe(true);
  });
});

describe("L10b — plans espacés : on remplace des instances en démarrage ET déjà prêtes", () => {
  it("chaque instance remplacée meurt — en démarrage comme prête —, il n'en reste qu'une", async () => {
    const { registry, events } = makeRegistry();
    // Piloté par les ÉTATS, jamais par l'horloge (sous charge, un démarrage
    // dure ce qu'il dure) : un remplacement sur deux tombe pendant le
    // démarrage de l'instance (PID connu, pas encore prête), l'autre une
    // fois qu'elle est prête.
    let fp = "";
    for (let i = 0; i < 10; i++) {
      fp = `f${i}`;
      const from = events.length;
      expect(registry.apply(plan([declaration("vite:a", fp)])).accepted).toBe(
        true,
      );
      const tag = fp;
      await until(() =>
        events
          .slice(from)
          .find((e) =>
            i % 2 === 0
              ? e.state === "starting" && e.pid !== null
              : e.state === "ready" && e.data?.tag === tag,
          ),
      );
    }
    const final = await until(() => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.state === "ready" && e.data?.tag === fp) return e;
      }
      return undefined;
    }, 30_000);
    const finalPid = final.pid as number;
    // TOUS les PID publiés : ceux des instances prêtes et ceux des démarrages en vol.
    const all = new Set(
      events.map((e) => e.pid).filter((p): p is number => p !== null),
    );
    expect(all.size).toBe(10);
    for (const pid of all) if (pid !== finalPid) strays.push(pid);
    // La mort des remplacées est PROUVÉE par l'ordre du registre : une
    // instance ne démarre qu'après l'`exit` constaté de la précédente (L1) —
    // la finale prête, les neuf autres sont mortes. La sonde par PID n'en est
    // qu'un témoin extérieur, et sous Windows elle ment : un PID libéré y est
    // réattribué aussitôt, et `isPidAlive` répond pour un autre process (vécu
    // sur la forge). Elle ne tourne donc que là où un PID ne se recycle pas
    // dans la seconde.
    if (process.platform !== "win32") {
      await until(
        () => [...all].every((p) => p === finalPid || !isPidAlive(p)),
        10_000,
      );
    }
    expect(isPidAlive(finalPid)).toBe(true);
  });
});

describe("L11 — 20 services à la fois, puis stopAll", () => {
  it("tous démarrent, puis tous meurent avant que stopAll rende la main", async () => {
    const { registry, events } = makeRegistry();
    const keys = Array.from({ length: 20 }, (_, i) => `svc:${i}`);
    registry.apply(plan(keys.map((k) => declaration(k, "f1"))));
    await until(() => readyPids(events).size === 20, 30_000);
    const pids = [...readyPids(events)];
    strays.push(...pids);
    await registry.stopAll();
    expect(pids.filter(isPidAlive)).toEqual([]);
  });

  it("killAll pendant un REMPLACEMENT : le successeur, qui attendait la mort de l'ancien, ne naît jamais (audit #692, M1)", async () => {
    const { registry, events } = makeRegistry();
    const deaf = {
      ...declaration("vite:a", "f1"),
      spec: { mode: "ignore-stop", tag: "f1" },
      tuning: { startupTimeoutMs: 5_000, maxRestarts: 0, stopGraceMs: 10_000 },
    };
    registry.apply(plan([deaf]));
    const first = await until(() =>
      events.find((e) => e.state === "ready" && e.data?.tag === "f1"),
    );
    strays.push(first.pid as number);
    // f2 attend la mort de f1, sourd à `stop` (10 s de grâce) : c'est
    // `killAll` qui l'abat — et qui doit aussi interdire f2.
    registry.apply(plan([declaration("vite:a", "f2")]));
    const from = events.length;
    registry.killAll();
    await until(() => !isPidAlive(first.pid as number), 3_000);
    // Témoin : au-delà de la mort de f1, f2 n'a reçu aucun PID.
    await sleep(500);
    const born = events
      .slice(from)
      .filter((e) => e.pid !== null && e.pid !== first.pid);
    for (const e of born) strays.push(e.pid as number);
    expect(born).toEqual([]);
  });

  it("killAll après la mort d'un hôte : aucun signal ne vise son ancien PID", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(
      plan([{ ...declaration("svc:fail", "f1"), spec: { mode: "fail" } }]),
    );
    // Errored ET sorti : l'instantané publié n'a plus de PID à viser.
    const s = await until(() =>
      events.find((e) => e.state === "errored" && e.pid === null),
    );
    expect(s.key).toBe("svc:fail");
    registry.killAll();
  });
});

describe("L12 — le teneur tué net (SIGKILL)", () => {
  it("l'hôte perd son canal et sort de lui-même : aucun orphelin", async () => {
    const holder = spawn(process.execPath, [HOLDER], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    strays.push(holder.pid as number);
    const hostPid = await new Promise<number>((resolve, reject) => {
      holder.stdout.once("data", (b: Buffer) =>
        resolve(Number(String(b).trim())),
      );
      holder.once("exit", () => reject(new Error("teneur sorti trop tôt")));
    });
    strays.push(hostPid);
    expect(isPidAlive(hostPid)).toBe(true);
    holder.kill("SIGKILL");
    await until(() => !isPidAlive(hostPid), 8_000);
  });
});

/** Une ligne du relevé `nodefony stop`, pour `terminateDevProcesses`. */
function devProcess(
  pid: number,
  ppid: number,
  role: DevProcessInfo["role"],
): DevProcessInfo {
  return {
    pid,
    ppid,
    mode: "dev",
    role,
    label: role,
    rssKb: 0,
    cpu: 0,
    uptimeSec: 0,
  };
}

describe.skipIf(process.platform === "win32")(
  "L13 — `nodefony stop` : l'hôte tenu n'est arrêté que par son teneur (audit #692, I3, POSIX)",
  () => {
    it("SIGTERM au teneur seul : son hôte n'est jamais vu planté ni relancé pendant l'arrêt, et rien ne survit", async () => {
      const holder = spawn(
        process.execPath,
        ["--import", TSX, GRACEFUL_HOLDER, HELD_HOST_CWD],
        { stdio: ["ignore", "pipe", "ignore"], detached: true },
      );
      strays.push(holder.pid as number);
      const states: string[] = [];
      let hostPid = 0;
      let buffered = "";
      holder.stdout.on("data", (b: Buffer) => {
        buffered += String(b);
        let nl = buffered.indexOf("\n");
        while (nl !== -1) {
          const line = JSON.parse(buffered.slice(0, nl)) as {
            state: string;
            pid: number | null;
          };
          buffered = buffered.slice(nl + 1);
          states.push(line.state);
          if (line.state === "ready" && line.pid !== null) hostPid = line.pid;
          nl = buffered.indexOf("\n");
        }
      });
      await until(() => hostPid !== 0, 15_000);
      strays.push(hostPid);
      const from = states.length;
      const alive = await terminateDevProcesses([
        devProcess(holder.pid as number, process.pid, "supervisor"),
        devProcess(hostPid, holder.pid as number, "held"),
      ]);
      expect(alive).toEqual([]);
      const during = states.slice(from);
      expect(during).not.toContain("crashed");
      expect(during).not.toContain("restarting");
      expect(during).toContain("stopped");
    });
  },
);
