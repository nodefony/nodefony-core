/**
 * Le teneur d'hôte de service (ADR-0030 §D2, §D6) — éprouvé sur de VRAIS
 * process : l'hôte de fixture (`fixtures/held/host.mjs`) joue chaque scénario.
 */
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  HeldHost,
  type IHeldHostOptions,
  type IHeldHostStatus,
} from "../service/dev/HeldHost";
import { isPidAlive } from "../service/dev/devProcess";
import {
  HELD_CHANNEL,
  MAX_HELD_REASON_LENGTH,
  isHeldHolderMessage,
  isHeldHostMessage,
} from "../service/dev/heldChannel";

const HOST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
  "host.mjs",
);

const hosts: HeldHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
});

function makeHost(
  mode: string,
  extra: Partial<IHeldHostOptions> = {},
): { host: HeldHost; states: string[] } {
  const states: string[] = [];
  const host = new HeldHost({
    key: `test:${mode}`,
    module: HOST,
    spec: { mode },
    cwd: path.dirname(HOST),
    env: { ...process.env, NF_DEV_CHILD: "1" },
    startupTimeoutMs: 5_000,
    restartBackoffBaseMs: 10,
    restartBackoffMaxMs: 20,
    onStatus: (s) => states.push(s.state),
    ...extra,
  });
  hosts.push(host);
  return { host, states };
}

/** Attend qu'un état soit atteint, sans horloge à seuil : sondage borné. */
async function until(
  host: HeldHost,
  predicate: (s: IHeldHostStatus) => boolean,
  timeoutMs = 8_000,
): Promise<IHeldHostStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = host.status();
    if (predicate(s)) return s;
    if (Date.now() > deadline)
      throw new Error(`état jamais atteint, dernier : ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("HeldHost — démarrer, rapporter, arrêter", () => {
  it("démarre l'hôte, reçoit sa donnée, puis l'arrête jusqu'à sa mort effective", async () => {
    const { host, states } = makeHost("ok");
    const ready = await host.start();
    expect(ready.state).to.equal("ready");
    expect(ready.data?.mode).to.equal("ok");
    const pid = ready.pid;
    expect(pid).to.be.a("number");
    expect(isPidAlive(pid as number)).to.equal(true);
    await host.stop();
    expect(host.status().state).to.equal("stopped");
    expect(isPidAlive(pid as number)).to.equal(false);
    expect(states).to.deep.equal([
      "starting",
      "starting",
      "ready",
      "stopping",
      "stopped",
    ]);
  });

  it("l'instantané se lit sans allocation : même objet entre deux changements, figé", async () => {
    const { host } = makeHost("ok");
    await host.start();
    const a = host.status();
    expect(host.status()).to.equal(a);
    expect(Object.isFrozen(a)).to.equal(true);
  });

  it("l'hôte ne reçoit jamais NF_DEV_CHILD — il se croirait le serveur enfant", async () => {
    const { host } = makeHost("ok");
    const ready = await host.start();
    expect(ready.data?.devChild).to.equal(null);
  });

  it("un échec rapporté rejette le démarrage avec sa raison, état errored, sans relance", async () => {
    const { host } = makeHost("fail");
    await expect(host.start()).rejects.toThrow("port occupé (fixture)");
    expect(host.status().state).to.equal("errored");
    expect(host.status().restartCount).to.equal(0);
  });

  it("un hôte muet au-delà du délai est tué, le démarrage rejeté", async () => {
    const { host } = makeHost("silent", { startupTimeoutMs: 300 });
    await expect(host.start()).rejects.toThrow("not ready after 300 ms");
    expect(host.status().state).to.equal("errored");
  });

  it("un hôte qui ignore `stop` est tué au-delà du délai de grâce", async () => {
    const { host } = makeHost("ignore-stop", { stopGraceMs: 200 });
    const { pid } = await host.start();
    await host.stop();
    expect(isPidAlive(pid as number)).to.equal(false);
  });
});

describe("HeldHost — plantages et preuve de vie", () => {
  it("un plantage après `ready` relance l'hôte avec recul", async () => {
    const { host, states } = makeHost("crash-after-ready", { maxRestarts: 5 });
    const first = await host.start();
    const again = await until(
      host,
      (s) => s.state === "ready" && s.restartCount >= 1,
    );
    expect(again.pid).not.to.equal(first.pid);
    expect(states).to.include.members(["crashed", "restarting"]);
  });

  it("au-delà du plafond de relances, l'hôte passe errored et n'est plus relancé", async () => {
    const { host } = makeHost("crash-after-ready", { maxRestarts: 1 });
    await host.start();
    const s = await until(host, (x) => x.state === "errored");
    expect(s.restartCount).to.equal(1);
    expect(s.lastError).to.contain("max restarts (1)");
  });

  it("une preuve de vie à l'heure après une relance rend le budget de relances", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nf-held-"));
    try {
      const { host } = makeHost("crash-once", {
        spec: { mode: "crash-once", marker: path.join(dir, "crashed") },
        livenessIntervalMs: 60,
        livenessTimeoutMs: 1_000,
        maxRestarts: 5,
      });
      await host.start();
      await until(host, (s) => s.state === "ready" && s.restartCount === 1);
      // Stable depuis : le compte ne doit plus porter le plantage passé.
      const rearmed = await until(
        host,
        (s) => s.state === "ready" && s.restartCount === 0,
      );
      expect(rearmed.lastError).to.match(/exited/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("une boucle d'évènements gelée est détectée par la preuve de vie, l'hôte tué et relancé", async () => {
    const { host } = makeHost("freeze-after-ready", {
      livenessIntervalMs: 60,
      livenessTimeoutMs: 50,
      livenessMissedLimit: 2,
      maxRestarts: 5,
    });
    const first = await host.start();
    const again = await until(
      host,
      (s) => s.restartCount >= 1 && s.state === "ready",
    );
    expect(again.pid).not.to.equal(first.pid);
    expect(isPidAlive(first.pid as number)).to.equal(false);
  });
});

describe("HeldHost — sortie de l'hôte par lignes complètes", () => {
  it("ne livre jamais une ligne coupée, même écrite en plusieurs morceaux", async () => {
    const got: { stream: string; text: string }[] = [];
    const { host } = makeHost("noisy", {
      onOutput: (stream, lines) =>
        got.push({ stream, text: lines.toString("utf8") }),
    });
    await host.start();
    await until(host, () => got.some((g) => g.stream === "err"));
    const out = got.filter((g) => g.stream === "out");
    for (const g of out) expect(g.text.endsWith("\n")).to.equal(true);
    expect(out.map((g) => g.text).join("")).to.equal("abc\ndef\n");
    expect(got.find((g) => g.stream === "err")?.text).to.equal("erreur\n");
  });
});

describe("hôte — jamais d'orphelin", () => {
  it("perdre le canal (teneur mort, même tué net) fait sortir l'hôte", async () => {
    const child = fork(HOST, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: [],
    });
    const ready = new Promise<void>((resolve) =>
      child.on("message", () => resolve()),
    );
    child.send({ channel: HELD_CHANNEL, type: "start", spec: { mode: "ok" } });
    await ready;
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", (code) => resolve(code)),
    );
    child.disconnect();
    expect(await exited).to.equal(0);
  });
});

describe("canal nf-held — gardes", () => {
  it("ignore tout ce qui n'est pas du canal, de type inconnu ou démesuré", () => {
    expect(
      isHeldHostMessage({ channel: "nf-dev", type: "pong", seq: 1 }),
    ).to.equal(false);
    expect(
      isHeldHostMessage({ channel: HELD_CHANNEL, type: "start", spec: {} }),
    ).to.equal(false);
    expect(
      isHeldHostMessage({ channel: HELD_CHANNEL, type: "pong", seq: -1 }),
    ).to.equal(false);
    expect(
      isHeldHostMessage({
        channel: HELD_CHANNEL,
        type: "report",
        state: "failed",
        data: null,
        reason: "x".repeat(MAX_HELD_REASON_LENGTH + 1),
      }),
    ).to.equal(false);
    expect(
      isHeldHostMessage({
        channel: HELD_CHANNEL,
        type: "report",
        state: "ready",
        data: [],
        reason: null,
      }),
    ).to.equal(false);
    expect(
      isHeldHolderMessage({
        channel: HELD_CHANNEL,
        type: "report",
        state: "ready",
      }),
    ).to.equal(false);
    expect(
      isHeldHolderMessage({ channel: HELD_CHANNEL, type: "start", spec: null }),
    ).to.equal(false);
  });

  it("accepte les formes valides", () => {
    expect(
      isHeldHostMessage({
        channel: HELD_CHANNEL,
        type: "report",
        state: "ready",
        data: { port: 1 },
        reason: null,
      }),
    ).to.equal(true);
    expect(
      isHeldHolderMessage({ channel: HELD_CHANNEL, type: "ping", seq: 0 }),
    ).to.equal(true);
  });
});
