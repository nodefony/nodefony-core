/**
 * Les services PORTÉS par le superviseur (ADR-0030 §D3-§D7) — le registre qui
 * réconcilie les plans du serveur, éprouvé sur de VRAIS process : l'hôte de
 * fixture (`fixtures/held/host.mjs`) rapporte son PID, si bien que « gardé »
 * et « remplacé » se constatent, ils ne se supposent pas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEV_CHANNEL,
  heldPlanProblem,
  isDevChannelMessage,
  sendToServer,
  sendToSupervisor,
  type IDevHeldPlan,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import { isPidAlive } from "../service/dev/devProcess";
import { HeldServiceRegistry } from "../service/dev/heldServices";
import type { IHeldHostStatus } from "../service/dev/HeldHost";
import type { ChildProcess } from "node:child_process";

const HOST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
  "host.mjs",
);

const registries: HeldServiceRegistry[] = [];

afterEach(async () => {
  await Promise.all(registries.splice(0).map((r) => r.stopAll()));
});

interface IStateEvent {
  readonly owner: string;
  readonly status: IHeldHostStatus;
}

function makeRegistry(probe?: (event: IStateEvent) => void): {
  registry: HeldServiceRegistry;
  events: IStateEvent[];
  output: string[];
} {
  const events: IStateEvent[] = [];
  const output: string[] = [];
  const registry = new HeldServiceRegistry({
    baseEnv: { ...process.env, NF_DEV_CHILD: "1" },
    onState: (owner, status) => {
      events.push({ owner, status });
      probe?.({ owner, status });
    },
    onOutput: (key, _stream, lines) =>
      output.push(`${key}|${lines.toString("utf8")}`),
  });
  registries.push(registry);
  return { registry, events, output };
}

function service(
  key: string,
  fingerprint: string,
  spec: Record<string, string> = { mode: "ok" },
): IHeldServiceDeclaration {
  return {
    key,
    module: HOST,
    fingerprint,
    spec,
    cwd: path.dirname(HOST),
    env: { NF_HELD_TEST: "1" },
    tuning: {
      startupTimeoutMs: 5_000,
      restartBackoffBaseMs: 10,
      restartBackoffMaxMs: 20,
      maxRestarts: 0,
    },
  };
}

let planId = 0;
function plan(
  services: IHeldServiceDeclaration[],
  owner = "frontend",
): IDevHeldPlan {
  return {
    channel: DEV_CHANNEL,
    type: "held-plan",
    id: ++planId,
    owner,
    services,
  };
}

/** Attend un état, sans horloge à seuil : sondage borné. */
async function until<T>(
  read: () => T | undefined,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("état jamais atteint");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Le dernier `ready` rapporté pour une clé, avec le PID de l'hôte. */
function readyPid(
  events: IStateEvent[],
  key: string,
  after = 0,
): number | undefined {
  for (let i = events.length - 1; i >= after; i--) {
    const { status } = events[i]!;
    if (status.key === key && status.state === "ready") {
      const pid = status.data?.pid;
      return typeof pid === "number" ? pid : undefined;
    }
  }
  return undefined;
}

describe("HeldServiceRegistry — réconciliation d'un plan", () => {
  it("clé neuve → démarrée ; son état part au propriétaire, l'hôte reçoit l'env ajouté", async () => {
    const { registry, events } = makeRegistry();
    const ack = registry.apply(plan([service("vite:a", "f1")]));
    expect(ack).toMatchObject({
      type: "held-plan-ack",
      accepted: true,
      reason: null,
    });
    const pid = await until(() => readyPid(events, "vite:a"));
    expect(isPidAlive(pid)).toBe(true);
    expect(events.every((e) => e.owner === "frontend")).toBe(true);
    const ready = events.find((e) => e.status.state === "ready")!;
    // NF_DEV_CHILD de la base n'atteint jamais l'hôte (ADR-0030 §D6).
    expect(ready.status.data?.devChild).toBeNull();
  });

  it("empreinte identique → l'hôte VIVANT est gardé, son état rejoué aussitôt", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(plan([service("vite:a", "f1")]));
    const pid = await until(() => readyPid(events, "vite:a"));
    const before = events.length;
    registry.apply(plan([service("vite:a", "f1")]));
    // Rejeu SYNCHRONE : un nouveau serveur apprend le port sans attendre.
    expect(events.length).toBe(before + 1);
    expect(events[before]!.status.state).toBe("ready");
    expect(readyPid(events, "vite:a", before)).toBe(pid);
    expect(isPidAlive(pid)).toBe(true);
  });

  it("empreinte changée → SEULE cette instance est remplacée, la nouvelle ne démarre qu'après la mort de l'ancienne", async () => {
    // L'ordre se constate À L'INSTANT où la nouvelle démarre, sur une seule
    // horloge — jamais par un sondage après coup, qui verrait l'ancienne morte
    // de toute façon.
    let pidA = 0;
    let oldAliveAtStart: boolean | null = null;
    const { registry, events } = makeRegistry(({ status }) => {
      if (
        pidA !== 0 &&
        status.key === "vite:a" &&
        status.state === "starting"
      ) {
        oldAliveAtStart ??= isPidAlive(pidA);
      }
    });
    registry.apply(plan([service("vite:a", "f1"), service("vite:b", "g1")]));
    pidA = await until(() => readyPid(events, "vite:a"));
    const pidB = await until(() => readyPid(events, "vite:b"));
    const before = events.length;
    registry.apply(plan([service("vite:a", "f2"), service("vite:b", "g1")]));
    await until(() => oldAliveAtStart ?? undefined);
    // Au premier signe de la nouvelle, l'ancienne n'existe plus : même port.
    expect(oldAliveAtStart).toBe(false);
    const newA = await until(() => readyPid(events, "vite:a", before));
    expect(newA).not.toBe(pidA);
    expect(isPidAlive(pidB)).toBe(true);
    // L'arrêt de l'instance remplacée ne parle pas au propriétaire.
    const replaced = events
      .slice(before)
      .filter((e) => e.status.key === "vite:a")
      .map((e) => e.status.state);
    expect(replaced).not.toContain("stopping");
    expect(replaced).not.toContain("stopped");
  });

  it("clé absente du plan → arrêtée jusqu'à sa mort ; un autre propriétaire n'est pas touché", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(plan([service("vite:a", "f1"), service("vite:b", "g1")]));
    registry.apply(plan([service("llm:x", "h1")], "ai"));
    const pidA = await until(() => readyPid(events, "vite:a"));
    const pidB = await until(() => readyPid(events, "vite:b"));
    const pidX = await until(() => readyPid(events, "llm:x"));
    registry.apply(plan([service("vite:a", "f1")]));
    await until(() => (isPidAlive(pidB) ? undefined : true));
    expect(isPidAlive(pidA)).toBe(true);
    expect(isPidAlive(pidX)).toBe(true);
  });

  it("relances épuisées (errored) → un plan identique lui redonne sa chance", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(plan([service("vite:a", "f1", { mode: "fail" })]));
    await until(() =>
      events.find((e) => e.status.state === "errored") ? true : undefined,
    );
    const before = events.length;
    registry.apply(plan([service("vite:a", "f1", { mode: "fail" })]));
    await until(() =>
      events.slice(before).find((e) => e.status.state === "starting"),
    );
  });

  it("stopAll → tous les hôtes morts, plus aucun plan accepté", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(plan([service("vite:a", "f1"), service("vite:b", "g1")]));
    const pids = [
      await until(() => readyPid(events, "vite:a")),
      await until(() => readyPid(events, "vite:b")),
    ];
    await registry.stopAll();
    expect(pids.map(isPidAlive)).toEqual([false, false]);
    const ack = registry.apply(plan([service("vite:a", "f1")]));
    expect(ack).toMatchObject({
      accepted: false,
      reason: "supervisor is stopping",
    });
  });

  it("la sortie de chaque hôte arrive avec sa clé", async () => {
    const { registry, events, output } = makeRegistry();
    registry.apply(plan([service("vite:a", "f1", { mode: "noisy" })]));
    await until(() => readyPid(events, "vite:a"));
    await until(() =>
      output.some((l) => l.includes("erreur")) ? true : undefined,
    );
    expect(output.every((l) => l.startsWith("vite:a|"))).toBe(true);
  });
});

describe("HeldServiceRegistry — refus nommés", () => {
  it.each([
    [
      "module relatif",
      [{ ...service("vite:a", "f1"), module: "host.mjs" }],
      'service "vite:a": module must be an absolute path',
    ],
    [
      "clé en double",
      [service("vite:a", "f1"), service("vite:a", "f2")],
      'service "vite:a" is declared twice',
    ],
    [
      "réglage inconnu",
      [{ ...service("vite:a", "f1"), tuning: { boom: 1 } }],
      'service "vite:a": unknown tuning "boom"',
    ],
    [
      "réglage hors bornes",
      [{ ...service("vite:a", "f1"), tuning: { maxRestarts: -1 } }],
      'service "vite:a": tuning "maxRestarts" must be an integer in [0, 1000]',
    ],
    [
      "empreinte vide",
      [{ ...service("vite:a", "f1"), fingerprint: "" }],
      'service "vite:a": invalid fingerprint',
    ],
    [
      "variable non textuelle",
      [{ ...service("vite:a", "f1"), env: { PORT: 1 } }],
      'service "vite:a": invalid env entry "PORT"',
    ],
  ])("%s → refusé, cause nommée, rien de lancé", (_label, services, reason) => {
    const { registry, events } = makeRegistry();
    const p = { ...plan([]), services } as unknown as IDevHeldPlan;
    expect(heldPlanProblem(p)).toBe(reason);
    expect(registry.apply(p)).toMatchObject({ accepted: false, reason });
    expect(events).toEqual([]);
  });

  it("une clé tenue par un autre propriétaire → refusée", async () => {
    const { registry, events } = makeRegistry();
    registry.apply(plan([service("shared:x", "f1")], "ai"));
    await until(() => readyPid(events, "shared:x"));
    const ack = registry.apply(plan([service("shared:x", "f1")]));
    expect(ack).toMatchObject({
      accepted: false,
      reason: 'service "shared:x" is held by owner "ai"',
    });
  });
});

describe("canal nf-dev — messages held-*", () => {
  const status: IHeldHostStatus = {
    key: "vite:a",
    state: "ready",
    pid: 42,
    data: { port: 5173 },
    lastError: null,
    restartCount: 0,
    missedPongs: 0,
  };

  it("accepte les formes valides", () => {
    expect(isDevChannelMessage(plan([service("vite:a", "f1")]))).toBe(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "held-plan-ack",
        id: 1,
        owner: "frontend",
        accepted: false,
        reason: "nope",
      }),
    ).toBe(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "frontend",
        status,
      }),
    ).toBe(true);
  });

  it("ignore une enveloppe illisible — impossible même d'acquitter", () => {
    const bad: unknown[] = [
      { ...plan([]), id: -1 },
      { ...plan([]), id: 1.5 },
      { ...plan([]), owner: "../etc" },
      { ...plan([]), owner: "x".repeat(65) },
      { ...plan([]), services: {} },
      { ...plan([]), services: Array.from({ length: 33 }, () => ({})) },
      {
        channel: DEV_CHANNEL,
        type: "held-plan-ack",
        id: 1,
        owner: "f",
        accepted: "yes",
        reason: null,
      },
      {
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "f",
        status: { ...status, state: "zombie" },
      },
      {
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "f",
        status: { ...status, pid: 0 },
      },
      {
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "f",
        status: { ...status, lastError: "x".repeat(4097) },
      },
      {
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "f",
        status: { ...status, key: "" },
      },
      // Compte de preuves de vie : entier positif sûr, toujours présent.
      ...[-1, 1.5, "2", null, undefined].map((missedPongs) => ({
        channel: DEV_CHANNEL,
        type: "held-state",
        owner: "f",
        status: { ...status, missedPongs },
      })),
    ];
    for (const message of bad) expect(isDevChannelMessage(message)).toBe(false);
  });

  it("un envoi porte TOUJOURS un rappel — sans lui, un échec d'écriture émet 'error', fatal sans écouteur", () => {
    const callbacks: unknown[] = [];
    const endpoint = {
      connected: true,
      send: (_m: unknown, cb?: unknown) => {
        callbacks.push(cb);
        return true;
      },
      on: () => endpoint,
      removeListener: () => endpoint,
    };
    sendToSupervisor(
      { channel: DEV_CHANNEL, type: "held-state", owner: "f", status },
      endpoint,
    );
    sendToServer(endpoint as unknown as ChildProcess, plan([]));
    expect(callbacks).toHaveLength(2);
    for (const cb of callbacks) expect(typeof cb).toBe("function");
  });
});
