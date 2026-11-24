/**
 * Le câblage des services portés dans le superviseur (ADR-0030 §D3) —
 * l'aiguillage des messages d'un serveur enfant, éprouvé sur de VRAIS
 * process : un faux serveur (`fixtures/held/server.mjs`) envoie son plan sur
 * le canal IPC, le registre réel lance l'hôte de fixture, l'acquittement
 * revient au serveur émetteur.
 */
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  routeServerMessages,
  type IServerMessageRoutes,
} from "../service/dev/DevSupervisor";
import {
  DEV_CHANNEL,
  listenToServer,
  sendToServer,
  type DevChannelMessage,
  type IDevHeldPlan,
  type IDevHeldPlanAck,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import { HeldServiceRegistry } from "../service/dev/heldServices";
import { isPidAlive } from "../service/dev/devProcess";
import type { IHeldHostStatus } from "../service/dev/heldChannel";
import type {
  IStartupView,
  IStatusContext,
} from "../service/dev/startupScreen";

const HELD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
);
const HOST = path.join(HELD_DIR, "host.mjs");
const SERVER = path.join(HELD_DIR, "server.mjs");

const children: ChildProcess[] = [];
const registries: HeldServiceRegistry[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((r) => r.stopAll()));
});

let planId = 0;

/** Un plan s'acquitte en millisecondes ; au-delà, le câblage est rompu. */
const ACK_DEADLINE_MS = 8_000;

function plan(key: string, owner = "frontend"): IDevHeldPlan {
  const service: IHeldServiceDeclaration = {
    key,
    module: HOST,
    fingerprint: "f1",
    spec: { mode: "ok" },
    cwd: HELD_DIR,
    env: {},
    tuning: { startupTimeoutMs: 5_000, maxRestarts: 0 },
  };
  return {
    channel: DEV_CHANNEL,
    type: "held-plan",
    id: ++planId,
    owner,
    services: [service],
  };
}

/** Registre réel ; `seen` garde le dernier état publié de chaque clé. */
function makeRegistry(): {
  registry: HeldServiceRegistry;
  seen: Map<string, IHeldHostStatus>;
} {
  const seen = new Map<string, IHeldHostStatus>();
  const registry = new HeldServiceRegistry({
    baseEnv: process.env,
    onState: (_owner, status) => {
      seen.set(status.key, status);
    },
    onOutput: () => {},
  });
  registries.push(registry);
  return { registry, seen };
}

/** Lance un faux serveur qui enverra `heldPlan` ; collecte ses acquittements. */
function spawnServer(heldPlan: IDevHeldPlan): {
  child: ChildProcess;
  acks: IDevHeldPlanAck[];
  firstAck: Promise<IDevHeldPlanAck>;
} {
  const child = fork(SERVER, [JSON.stringify(heldPlan)], {
    stdio: ["ignore", "pipe", "inherit", "ipc"],
    execArgv: [],
  });
  children.push(child);
  const acks: IDevHeldPlanAck[] = [];
  let buffered = "";
  // Borné : un acquittement qui ne vient pas se NOMME, il n'attend pas le
  // délai global du test.
  const firstAck = new Promise<IDevHeldPlanAck>((resolve, reject) => {
    const deadline = setTimeout(
      () =>
        reject(
          new Error(
            `aucun acquittement du plan ${heldPlan.id} en ${ACK_DEADLINE_MS} ms`,
          ),
        ),
      ACK_DEADLINE_MS,
    );
    deadline.unref();
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let nl = buffered.indexOf("\n");
      while (nl >= 0) {
        const ack = JSON.parse(buffered.slice(0, nl)) as IDevHeldPlanAck;
        buffered = buffered.slice(nl + 1);
        acks.push(ack);
        clearTimeout(deadline);
        resolve(ack);
        nl = buffered.indexOf("\n");
      }
    });
  });
  // Un serveur remplacé n'est jamais acquitté, et nul ne l'attend : son
  // échéance ne doit pas devenir un rejet sans gestionnaire.
  firstAck.catch(() => {});
  return { child, acks, firstAck };
}

/** Résout au premier message du canal reçu de `child` — après son aiguillage. */
function nextMessage(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.once("message", () => resolve()));
}

/** Câble `child` comme le fait le superviseur, sans terminal sauf mention. */
function wire(
  child: ChildProcess,
  registry: HeldServiceRegistry,
  isCurrent: () => boolean,
  terminal: IServerMessageRoutes["terminal"] = null,
): void {
  listenToServer(
    child,
    routeServerMessages({
      isCurrent,
      applyHeldPlan: (p) => registry.apply(p),
      reply: (ack) => sendToServer(child, ack),
      terminal,
    }),
  );
}

describe("superviseur — câblage des services portés (vrais process)", () => {
  it("sans terminal (plain, json, --debug) : le plan est appliqué et acquitté au serveur émetteur", async () => {
    const { registry, seen } = makeRegistry();
    const heldPlan = plan("vite:a");
    const server = spawnServer(heldPlan);
    wire(server.child, registry, () => true, null);
    const ack = await server.firstAck;
    expect(ack).to.deep.equal({
      channel: DEV_CHANNEL,
      type: "held-plan-ack",
      id: heldPlan.id,
      owner: "frontend",
      accepted: true,
      reason: null,
    });
    expect(seen.has("vite:a")).to.equal(true);
  });

  it("le plan d'un serveur REMPLACÉ est ignoré : rien lancé, rien acquitté ; le successeur, lui, l'est", async () => {
    const { registry, seen } = makeRegistry();
    let current: ChildProcess | null = null;
    const old = spawnServer(plan("vite:old"));
    // L'ancien est déjà remplacé quand son plan arrive.
    wire(old.child, registry, () => current === old.child);
    const oldDelivered = nextMessage(old.child);
    const next = spawnServer(plan("vite:new"));
    current = next.child;
    wire(next.child, registry, () => current === next.child);
    await oldDelivered;
    // Témoin : le successeur est servi — l'ancien a eu le temps de l'être.
    const ack = await next.firstAck;
    expect(ack.accepted).to.equal(true);
    expect(seen.has("vite:old")).to.equal(false);
    expect(old.acks).to.deep.equal([]);
  });

  it("un plan refusé est QUAND MÊME acquitté, avec sa cause — le serveur n'attend pas pour rien", async () => {
    const { registry, seen } = makeRegistry();
    // La clé est déjà tenue par un autre propriétaire.
    registry.apply(plan("vite:shared", "ai"));
    const server = spawnServer(plan("vite:shared", "frontend"));
    wire(server.child, registry, () => true);
    const ack = await server.firstAck;
    expect(ack.accepted).to.equal(false);
    expect(ack.reason).to.be.a("string").and.not.equal("");
  });

  it("l'hôte lancé par le plan est VIVANT, puis mort après stopAll", async () => {
    const { registry, seen } = makeRegistry();
    const server = spawnServer(plan("vite:life"));
    wire(server.child, registry, () => true);
    await server.firstAck;
    const deadline = Date.now() + 8_000;
    let pid: number | null = null;
    while (pid === null && Date.now() < deadline) {
      const s = seen.get("vite:life");
      if (s?.state === "ready") pid = s.pid;
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(pid).to.be.a("number");
    expect(isPidAlive(pid as number)).to.equal(true);
    await registry.stopAll();
    expect(isPidAlive(pid as number)).to.equal(false);
  });
});

describe("superviseur — aiguillage des messages (unité)", () => {
  function recorder(): {
    calls: string[];
    terminal: NonNullable<IServerMessageRoutes["terminal"]>;
  } {
    const calls: string[] = [];
    return {
      calls,
      terminal: {
        setStatus: (_v, _c, phase) => calls.push(`status:${phase}`),
        setRuntime: (s) => calls.push(`runtime:${s.rssBytes}`),
        setActivity: (step, p) =>
          calls.push(`step:${step}:${p?.done}/${p?.total}`),
      },
    };
  }

  const bootStep: DevChannelMessage = {
    channel: DEV_CHANNEL,
    type: "boot-step",
    step: "onBoot",
    done: 2,
    total: 5,
  };
  const runtime: DevChannelMessage = {
    channel: DEV_CHANNEL,
    type: "runtime",
    rssBytes: 42,
    cpuPercent: 1,
    eluPercent: 2,
  };
  const statusView: DevChannelMessage = {
    channel: DEV_CHANNEL,
    type: "status-view",
    view: {} as IStartupView,
    context: {} as IStatusContext,
  };

  it("avec terminal : bilan, mesures et étapes nourrissent la barre ; le plan est acquitté aussi", () => {
    const { calls, terminal } = recorder();
    const replies: IDevHeldPlanAck[] = [];
    const route = routeServerMessages({
      isCurrent: () => true,
      applyHeldPlan: (p) => ({
        channel: DEV_CHANNEL,
        type: "held-plan-ack",
        id: p.id,
        owner: p.owner,
        accepted: true,
        reason: null,
      }),
      reply: (a) => replies.push(a),
      terminal,
    });
    route(statusView);
    route(runtime);
    route(bootStep);
    const p = plan("vite:t");
    route(p);
    expect(calls).to.deep.equal([
      "status:ready",
      "runtime:42",
      "step:onBoot:2/5",
    ]);
    expect(replies.map((r) => r.id)).to.deep.equal([p.id]);
  });

  it("sans terminal : les messages de barre sont ignorés sans faute", () => {
    const replies: unknown[] = [];
    const route = routeServerMessages({
      isCurrent: () => true,
      applyHeldPlan: () => {
        throw new Error("jamais appelé");
      },
      reply: (a) => replies.push(a),
      terminal: null,
    });
    expect(() => {
      route(statusView);
      route(runtime);
      route(bootStep);
    }).not.to.throw();
    expect(replies).to.deep.equal([]);
  });

  it("serveur remplacé : AUCUN message ne passe, barre comprise", () => {
    const { calls, terminal } = recorder();
    let applied = 0;
    const route = routeServerMessages({
      isCurrent: () => false,
      applyHeldPlan: (p) => {
        applied++;
        return {
          channel: DEV_CHANNEL,
          type: "held-plan-ack",
          id: p.id,
          owner: p.owner,
          accepted: true,
          reason: null,
        };
      },
      reply: () => {},
      terminal,
    });
    route(statusView);
    route(bootStep);
    route(plan("vite:x"));
    expect(calls).to.deep.equal([]);
    expect(applied).to.equal(0);
  });
});
