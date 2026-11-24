/**
 * Les services portés dans le superviseur RÉEL (ADR-0030 §D3, §D7) : un vrai
 * `DevSupervisor`, lancé dans un dossier jetable sur des ports libres, relance
 * le banc en faux serveur (`fixtures/held/supervisor.mjs`), reçoit son plan,
 * fait tourner l'hôte de fixture — puis s'arrête par ses vrais signaux.
 *
 * Sans danger pour un `nodefony development` en cours : le balayage du
 * superviseur ne touche que les process de SON dossier, et un process dont le
 * dossier est inconnu est classé étranger (`splitByProject`).
 *
 * L'hôte `ignore-stop` est le témoin : à la perte de son canal, il se fige
 * dans son `stop` et SURVIT. S'il est mort après la sortie du superviseur,
 * c'est que le superviseur l'a arrêté — personne d'autre ne l'aurait fait.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEV_CHANNEL,
  type IDevHeldPlan,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import { isPidAlive } from "../service/dev/devProcess";
import { DUPLICATE_SIGNAL_WINDOW_MS } from "../service/dev/shutdownSignals";
import { HELD_HOST_CWD } from "./fixtures/held/hostCwd";

const HELD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
);
const HOST = path.join(HELD_DIR, "host.mjs");
const BENCH = path.join(HELD_DIR, "supervisor.mjs");
const TSX = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx/esm"),
).href;

/** Les PID à abattre en fin de test, quoi qu'il arrive. */
const pids = new Set<number>();
const dirs: string[] = [];

afterEach(() => {
  // L'hôte a écrit son PID dans le projet jetable : abattu même si son état
  // n'est jamais parvenu au test — un `ignore-stop` orphelin tourne à 100 %.
  for (const d of dirs) {
    const file = path.join(d, "host.pid");
    if (existsSync(file)) pids.add(Number(readFileSync(file, "utf8")));
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* déjà mort */
    }
  }
  pids.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Deux ports libres, constatés par une écoute éphémère. */
async function freePorts(): Promise<number[]> {
  const one = (): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
  return [await one(), await one()];
}

/** Un projet autonome déjà construit : le superviseur ne lance aucun build. */
function makeProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nf-held-sup-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "dist"));
  writeFileSync(path.join(dir, "dist", "index.js"), "export {};\n");
  writeFileSync(path.join(dir, "dist", "index.js.map"), "{}\n");
  return dir;
}

function plan(
  stopGraceMs: number,
  pidFile: string,
  mode = "ignore-stop",
): IDevHeldPlan {
  const service: IHeldServiceDeclaration = {
    key: "vite:bench",
    module: HOST,
    fingerprint: "f1",
    spec: { mode, pidFile },
    cwd: HELD_HOST_CWD,
    env: {},
    tuning: { startupTimeoutMs: 10_000, maxRestarts: 0, stopGraceMs },
  };
  return {
    channel: DEV_CHANNEL,
    type: "held-plan",
    id: 1,
    owner: "frontend",
    services: [service],
  };
}

interface IBenchEvent {
  type: string;
  /** Le serveur (PID) qui a reçu ou émis l'évènement. */
  from: number;
  pid?: number;
  accepted?: boolean;
  status?: { key: string; state: string; pid: number | null };
}

interface IBench {
  supervisor: ChildProcess;
  events: IBenchEvent[];
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  waitFor: (
    predicate: (e: IBenchEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<IBenchEvent>;
}

async function launch(
  stopGraceMs: number,
  crashOnce = false,
  mode?: string,
): Promise<IBench> {
  const cwd = makeProject();
  const config = {
    cwd,
    ports: await freePorts(),
    plan: plan(stopGraceMs, path.join(cwd, "host.pid"), mode),
    ...(crashOnce ? { crashOnce: path.join(cwd, "crashed") } : {}),
  };
  const env: NodeJS.ProcessEnv = { ...process.env, NF_NO_TTY: "1" };
  delete env.NF_DEV_CHILD;
  const supervisor = spawn(
    process.execPath,
    ["--import", TSX, BENCH, JSON.stringify(config)],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (supervisor.pid !== undefined) pids.add(supervisor.pid);
  const events: IBenchEvent[] = [];
  const waiters = new Set<() => void>();
  let all = "";
  let pending = "";
  supervisor.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    all += text;
    pending += text;
    let nl = pending.indexOf("\n");
    while (nl >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      const at = line.indexOf("@@");
      if (at >= 0) {
        const event = JSON.parse(line.slice(at + 2)) as IBenchEvent;
        events.push(event);
        const pid = event.type === "server" ? event.pid : event.status?.pid;
        if (typeof pid === "number") pids.add(pid);
        for (const w of waiters) w();
      }
      nl = pending.indexOf("\n");
    }
  });
  supervisor.stderr?.on("data", (chunk: Buffer) => {
    all += chunk.toString("utf8");
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    supervisor.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const waitFor = (
    predicate: (e: IBenchEvent) => boolean,
    timeoutMs = 20_000,
  ): Promise<IBenchEvent> =>
    new Promise((resolve, reject) => {
      const check = (): boolean => {
        const hit = events.find(predicate);
        if (hit === undefined) return false;
        cleanup();
        resolve(hit);
        return true;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `évènement jamais reçu en ${timeoutMs} ms — sortie du banc :\n${all}`,
          ),
        );
      }, timeoutMs);
      const listener = (): void => void check();
      const cleanup = (): void => {
        clearTimeout(timer);
        waiters.delete(listener);
      };
      waiters.add(listener);
      check();
    });
  return { supervisor, events, output: () => all, exited, waitFor };
}

/** Attend la mort effective de `pid`, bornée : un témoin figé ne meurt jamais seul. */
async function deadWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isPidAlive(pid);
}

const readyHost = (e: IBenchEvent): boolean =>
  e.type === "held-state" &&
  e.status?.state === "ready" &&
  typeof e.status.pid === "number";

// Les 3 plateformes : c'est le seul arrêt que Windows connaisse pour un arbre
// (aucun arrêt gracieux, axiome 6) — `kill` y vaut TerminateProcess, comme une
// console fermée. L'hôte n'a que la perte de son canal pour savoir qu'il est
// seul. Hôte qui coopère (`ok`) : un hôte GELÉ (`ignore-stop`) dont le teneur
// meurt net ne peut sortir de lui-même — sa boucle ne tourne plus — et seul
// celui qui a tué le teneur peut encore abattre l'arbre.
describe("superviseur réel tué net — linux · macOS · Windows", () => {
  it("superviseur tué net : l'hôte porté perd son canal et sort de lui-même, aucun orphelin", async () => {
    const bench = await launch(300, false, "ok");
    const ready = await bench.waitFor(readyHost);
    const hostPid = ready.status?.pid as number;
    expect(isPidAlive(hostPid)).to.equal(true);
    bench.supervisor.kill("SIGKILL");
    await bench.exited;
    expect(await deadWithin(hostPid, 3_000), "hôte porté orphelin").to.equal(
      true,
    );
  }, 40_000);
});

describe.skipIf(process.platform === "win32")(
  "superviseur réel — services portés de bout en bout",
  () => {
    it("le plan du serveur est acquitté et l'état de l'hôte revient au serveur COURANT", async () => {
      const bench = await launch(300);
      const ack = await bench.waitFor((e) => e.type === "held-plan-ack");
      expect(ack.accepted).to.equal(true);
      const ready = await bench.waitFor(readyHost);
      expect(ready.status?.key).to.equal("vite:bench");
      expect(isPidAlive(ready.status?.pid as number)).to.equal(true);
      bench.supervisor.kill("SIGTERM");
      await bench.exited;
    }, 40_000);

    it("serveur tombé puis relancé : l'hôte porté SURVIT, et son état va au NOUVEAU serveur", async () => {
      const bench = await launch(300, true);
      const first = await bench.waitFor((e) => e.type === "server");
      const second = await bench.waitFor(
        (e) => e.type === "server" && e.pid !== first.pid,
      );
      const ready = await bench.waitFor(
        (e) => readyHost(e) && e.from === second.pid,
      );
      // Un seul hôte de bout en bout : le plan identique du successeur l'a
      // GARDÉ (ADR-0030 §D3), il n'a été ni tué ni relancé.
      const hostPids = new Set(
        bench.events
          .map((e) => e.status?.pid)
          .filter((pid): pid is number => typeof pid === "number"),
      );
      expect([...hostPids]).to.deep.equal([ready.status?.pid]);
      expect(isPidAlive(ready.status?.pid as number)).to.equal(true);
      expect(isPidAlive(first.pid as number)).to.equal(false);
      bench.supervisor.kill("SIGTERM");
      await bench.exited;
    }, 40_000);

    it("arrêt propre (un signal) : le superviseur ne sort qu'après la mort de l'hôte porté", async () => {
      const bench = await launch(300);
      const ready = await bench.waitFor(readyHost);
      const hostPid = ready.status?.pid as number;
      const server = await bench.waitFor((e) => e.type === "server");
      bench.supervisor.kill("SIGTERM");
      const { code } = await bench.exited;
      expect(code, bench.output()).to.equal(0);
      expect(await deadWithin(hostPid, 2_000), "hôte porté survivant").to.equal(
        true,
      );
      expect(await deadWithin(server.pid as number, 2_000)).to.equal(true);
    }, 40_000);

    it("arrêt forcé (signal insistant) : l'hôte figé est abattu, sortie 130", async () => {
      // Délai de grâce démesuré : l'arrêt propre reste bloqué sur l'hôte figé,
      // seul l'arrêt forcé peut en venir à bout.
      const bench = await launch(120_000);
      const ready = await bench.waitFor(readyHost);
      const hostPid = ready.status?.pid as number;
      bench.supervisor.kill("SIGTERM");
      // Un doublon dans la fenêtre est absorbé (`installShutdownSignals`) :
      // l'insistance se mesure APRÈS elle.
      await new Promise((r) => setTimeout(r, DUPLICATE_SIGNAL_WINDOW_MS + 300));
      expect(isPidAlive(hostPid), "l'arrêt propre aurait dû bloquer").to.equal(
        true,
      );
      bench.supervisor.kill("SIGTERM");
      const { code } = await bench.exited;
      expect(code, bench.output()).to.equal(130);
      expect(await deadWithin(hostPid, 2_000), "hôte porté survivant").to.equal(
        true,
      );
    }, 40_000);
  },
);
