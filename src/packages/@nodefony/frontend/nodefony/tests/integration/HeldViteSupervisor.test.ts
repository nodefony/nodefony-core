/**
 * Vite PORTÉ par le superviseur de développement (ADR-0030), de bout en bout
 * sur une VRAIE Vite : l'adaptateur `HeldViteSupervisor` compose sa
 * déclaration, le client du cœur l'envoie, le VRAI registre du superviseur
 * (`HeldServiceRegistry`) lance l'hôte et pousse ses états. Seul l'IPC est
 * remplacé par un lien en mémoire — le câblage IPC du superviseur a ses
 * propres bancs dans le cœur (`devHeldWiring`, `devSupervisorHeld`).
 *
 * Ce que ces cas prouvent : la déclaration démarre réellement Vite ; un
 * « nouveau serveur » qui redéclare la même famille retrouve le MÊME hôte
 * (même PID) ; une empreinte changée le remplace ; un propriétaire absent de
 * la liste perd ses hôtes.
 */
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HeldServiceRegistry } from "../../../../../../nodefony/src/service/dev/heldServices";
import { HeldServicesClient } from "../../../../../../nodefony/src/kernel/heldServicesClient";
import { isPidAlive } from "../../../../../../nodefony/src/service/dev/devProcess";
import type { DevChannelMessage } from "../../../../../../nodefony/src/service/dev/devChannel";
import { HeldViteSupervisor } from "../../service/HeldViteSupervisor.js";
import type { ViteSupervisorOptions } from "../../service/viteFamily.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/minimal-frontend",
);

const silentLogger = { info: () => {}, error: () => {}, debug: () => {} };

function makeEntry(): IResolvedFrontendEntry {
  return {
    moduleName: "fixture",
    entryName: "fixture",
    type: "vanilla",
    root: FIXTURE_ROOT,
    entryFile: "src/main.ts",
    outDir: path.resolve(FIXTURE_ROOT, "dist"),
    publicPath: "/_assets/fixture/",
  };
}

async function freePort(): Promise<number> {
  const srv = net.createServer();
  return new Promise<number>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a ? a.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

function httpStatus(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/", timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function waitDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/**
 * Le superviseur, réduit à son registre RÉEL ; chaque « serveur » obtient un
 * lien en mémoire. Comme `DevSupervisor`, les états vont au serveur COURANT,
 * et l'acquittement au serveur émetteur.
 */
function supervisorDouble(): {
  registry: HeldServiceRegistry;
  newServer: () => HeldServicesClient;
} {
  let current: Set<(m: DevChannelMessage) => void> | null = null;
  const registry = new HeldServiceRegistry({
    baseEnv: process.env,
    onState: (owner, status) => {
      for (const h of current ?? []) {
        h({ channel: "nf-dev", type: "held-state", owner, status });
      }
    },
    onOutput: () => {},
  });
  registries.push(registry);
  return {
    registry,
    newServer: () => {
      const handlers = new Set<(m: DevChannelMessage) => void>();
      current = handlers;
      return new HeldServicesClient("frontend", {
        send: (message) => {
          // L'IPC livre au tick suivant : jamais de réponse synchrone.
          setImmediate(() => {
            if (message.type === "held-plan") {
              const ack = registry.apply(message);
              for (const h of handlers) h(ack);
            } else if (message.type === "held-owners") {
              registry.retainOwners(message.owners);
            }
          });
          return true;
        },
        listen: (handler) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      });
    },
  };
}

const registries: HeldServiceRegistry[] = [];
afterEach(async () => {
  await Promise.all(registries.splice(0).map((r) => r.stopAll()));
});

function options(
  port: number,
  extra: Partial<ViteSupervisorOptions> = {},
): ViteSupervisorOptions {
  return {
    devHost: "127.0.0.1",
    devPort: port,
    startupTimeoutMs: 20_000,
    pipeLogs: false,
    cwd: FIXTURE_ROOT,
    logger: silentLogger,
    healthCheckIntervalMs: 0,
    autoRestart: false,
    ...extra,
  };
}

/** Un démarrage de serveur : le client attend la famille, l'adaptateur la déclare. */
async function bootServer(
  newServer: () => HeldServicesClient,
  opts: ViteSupervisorOptions,
): Promise<HeldViteSupervisor> {
  const client = newServer();
  client.expect(["vite:default"]);
  const sup = new HeldViteSupervisor(opts, client);
  await sup.start([makeEntry()], {});
  return sup;
}

describe("HeldViteSupervisor — Vite porté par le superviseur (vraie Vite, vrai registre)", () => {
  it("la déclaration démarre Vite : prêt, port réel, Vite répond ; status() ne réalloue pas", async () => {
    const { newServer } = supervisorDouble();
    const port = await freePort();
    const sup = await bootServer(newServer, options(port));
    const status = sup.status();
    expect(status.state).to.equal("ready");
    expect(status.port).to.equal(port);
    expect(status.pid).to.be.a("number");
    expect(status.origin).to.equal(`http://127.0.0.1:${port}`);
    expect(await httpStatus(port)).to.be.greaterThan(0);
    expect(sup.status()).to.equal(status);
  });

  it("serveur relancé, même config : le NOUVEAU serveur retrouve le MÊME hôte (même PID), prêt sans relance", async () => {
    const { newServer } = supervisorDouble();
    const port = await freePort();
    const first = await bootServer(newServer, options(port));
    const pid = first.status().pid;
    // Le serveur s'arrête : son adaptateur cesse d'écouter, sans arrêter Vite.
    await first.stop();
    expect(isPidAlive(pid as number)).to.equal(true);
    const second = await bootServer(newServer, options(port));
    expect(second.status().state).to.equal("ready");
    expect(second.status().pid).to.equal(pid);
    expect(second.status().port).to.equal(port);
  });

  it("empreinte changée (réglage du teneur) : l'hôte est REMPLACÉ — PID neuf, l'ancien mort", async () => {
    const { newServer } = supervisorDouble();
    const port = await freePort();
    const first = await bootServer(newServer, options(port));
    const pid = first.status().pid as number;
    await first.stop();
    const second = await bootServer(
      newServer,
      options(port, { startupTimeoutMs: 21_000 }),
    );
    expect(second.status().pid).to.be.a("number").and.not.equal(pid);
    expect(await waitDead(pid)).to.equal(true);
  });

  it("propriétaire absent de held-owners : ses hôtes sont arrêtés", async () => {
    const { newServer, registry } = supervisorDouble();
    const port = await freePort();
    const sup = await bootServer(newServer, options(port));
    const pid = sup.status().pid as number;
    // Un serveur sans module front ne nomme aucun propriétaire.
    expect(registry.retainOwners([])).to.equal(1);
    expect(await waitDead(pid)).to.equal(true);
  });
});
