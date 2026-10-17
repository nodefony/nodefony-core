import assert from "node:assert/strict";
import cluster from "node:cluster";
import { afterEach, describe, it, vi } from "vitest";
import Kernel from "../kernel/Kernel";
import CliKernel from "../kernel/CliKernel";
import Module from "../kernel/Module";
import type { KernelEventsType } from "../kernel/Kernel";
import { CONSOLE_RUN_PROFILE, type IRunProfile } from "../kernel/runProfile";
import {
  KernelCluster,
  type IClusterHost,
  type IClusterProcess,
  type IClusterTopology,
} from "../kernel/kernelCluster";
import { CLUSTER_RT_KIND } from "../service/cluster/clusterMessage";
import { withFakeIpc, withoutIpc } from "./support/fakeIpc";

/**
 * Caractérisation de la famille CLUSTER du noyau (#488) : identité du
 * processus dans la topologie (`typeCluster`, `pid`, `workerId`, `worker`),
 * `clusterIsMaster`, la bannière `logEnv` — et sa mutation de `runProfile` —,
 * `initCluster` côté primaire (bannière, silence, vidage des `MODULE ADD`,
 * `onCluster`), et l'enveloppe IPC héritée `sendMessage`. Les blocs
 * « Kernel — … » ont été écrits et vus verts sur le code d'ORIGINE, avant tout
 * déplacement : ils ne passent que par l'API publique du Kernel.
 *
 * Le processus de test est TOUJOURS primaire : la branche worker se
 * caractérise sur la classe extraite, avec une topologie injectée.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function mkKernel(env: "development" | "production" = "development"): Kernel {
  return new Kernel(env, null, { log: { active: false } });
}

class TestModule extends Module {
  constructor(kernel: Kernel) {
    super("TestModule", kernel, "/tmp/test-module", {});
  }
}

const SERVER_PROFILE: IRunProfile = {
  servers: true,
  lifetime: "longrunning",
  interactive: false,
  externalServices: true,
};

describe("Kernel — identité dans la topologie", () => {
  it("typeCluster, pid, workerId, worker et clusterIsMaster suivent node:cluster", () => {
    const k = mkKernel();
    assert.strictEqual(k.typeCluster, cluster.isPrimary ? "master" : "worker");
    assert.strictEqual(k.pid, process.pid);
    assert.strictEqual(k.workerId, cluster.worker?.id);
    assert.strictEqual(k.worker, cluster.worker);
    assert.strictEqual(k.clusterIsMaster(), cluster.isPrimary);
  });

  it("pid, workerId et worker se lisent et s'écrivent comme des champs", () => {
    const k = mkKernel();
    k.pid = 4242;
    assert.strictEqual(k.pid, 4242);
    k.workerId = 7;
    assert.strictEqual(k.workerId, 7);
    k.typeCluster = "worker";
    assert.strictEqual(k.typeCluster, "worker");
  });

  it("piège conservé : `console` vaut false même pour un profil console", () => {
    const k = mkKernel();
    assert.strictEqual(k.isConsole(), true, "profil console par défaut");
    assert.strictEqual(
      k.console,
      false,
      "posé AVANT runProfile → figé à false",
    );
  });
});

describe("Kernel — logEnv", () => {
  it("nomme le profil, le rôle cluster, les deux environnements et le debug", () => {
    const k = mkKernel("development");
    k.appEnvironment.environment = "recette";
    k.debug = true;
    const txt = k.logEnv();
    assert.ok(txt.includes("console"), "profil console par défaut");
    assert.ok(txt.includes("Cluster"));
    assert.ok(txt.includes(k.typeCluster));
    assert.ok(txt.includes("Nodefony Environment"));
    assert.ok(txt.includes("development"));
    assert.ok(txt.includes("App Environment"));
    assert.ok(txt.includes("recette"));
    assert.ok(txt.includes("Debug"));
    assert.ok(txt.includes("true"));
    assert.ok(txt.endsWith("\n"));
  });

  it("sans CLI : runProfile n'est pas touché", () => {
    const k = mkKernel();
    const before = k.runProfile;
    k.logEnv();
    assert.strictEqual(k.runProfile, before);
  });

  it("piège conservé : avec une CLI, logEnv() RECOPIE cli.runProfile dans kernel.runProfile", () => {
    const k = mkKernel();
    const cli = new CliKernel("development");
    cli.runProfile = SERVER_PROFILE;
    // Attachée directement (pas par setCli) : seule logEnv() doit recopier.
    k.cli = cli;
    assert.strictEqual(k.runProfile.servers, false, "console avant l'appel");
    const txt = k.logEnv();
    assert.strictEqual(k.runProfile, SERVER_PROFILE, "même objet que la CLI");
    assert.ok(txt.includes("server"), "la bannière rend le profil recopié");
  });
});

describe("Kernel — initCluster (processus primaire)", () => {
  it("imprime la bannière logEnv, vide les MODULE ADD différés SOUS elle, fire onCluster MASTER", async () => {
    const k = mkKernel();
    const sequence: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      sequence.push(`console:${String(args[0])}`);
    });
    const log = vi.spyOn(k, "log");
    log.mockImplementation((pci: unknown) => {
      if (typeof pci === "string" && pci.startsWith("MODULE ADD")) {
        sequence.push(`log:${pci}`);
      }
      return undefined as never;
    });
    await k.addModule(TestModule);
    assert.strictEqual(
      sequence.length,
      0,
      "MODULE ADD différé tant que la bannière n'est pas passée",
    );

    let fired: unknown[] | null = null;
    k.once("onCluster", (...args: unknown[]) => {
      fired = args;
    });
    k.initCluster();

    assert.strictEqual(sequence.length, 2);
    assert.ok(sequence[0]!.startsWith("console:"), "la bannière d'abord");
    assert.ok(sequence[0]!.includes("Cluster"), "c'est logEnv()");
    assert.strictEqual(sequence[1], "log:MODULE ADD : TestModule");
    assert.ok(fired !== null, "onCluster a fire");
    const args = fired as unknown[];
    assert.strictEqual(args[0], "MASTER");
    assert.strictEqual(args[1], k);
    assert.strictEqual(args[2], process);
    assert.strictEqual(k.pid, process.pid);
    assert.strictEqual(k.workerId, undefined, "pas de worker dans le primaire");
  });

  it("une fois vidés, les MODULE ADD suivants sont journalisés immédiatement", async () => {
    const k = mkKernel();
    vi.spyOn(console, "log").mockImplementation(() => {});
    k.initCluster();
    const seen: string[] = [];
    vi.spyOn(k, "log").mockImplementation((pci: unknown) => {
      if (typeof pci === "string" && pci.startsWith("MODULE ADD"))
        seen.push(pci);
      return undefined as never;
    });
    await k.addModule(TestModule);
    assert.deepStrictEqual(seen, ["MODULE ADD : TestModule"]);
  });

  it("reporterOwnsHeader → pas de bannière, onCluster fire quand même", () => {
    const k = mkKernel();
    k.reporterOwnsHeader = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let fired = 0;
    k.once("onCluster", () => {
      fired += 1;
    });
    k.initCluster();
    assert.strictEqual(log.mock.calls.length, 0);
    assert.strictEqual(fired, 1);
  });

  it("cli.quietBoot → pas de bannière", () => {
    const k = mkKernel();
    const cli = new CliKernel("development");
    cli.quietBoot = true;
    k.cli = cli;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    k.initCluster();
    assert.strictEqual(log.mock.calls.length, 0);
  });

  it("piège conservé : --json ne fait PAS taire la bannière (la branche lit `console`, toujours false)", () => {
    const k = mkKernel();
    const cli = new CliKernel("development");
    cli.commander?.setOptionValue("json", true);
    k.cli = cli;
    assert.strictEqual(
      k.cli.commander?.opts().json,
      true,
      "décor : --json vu par commander",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    k.initCluster();
    assert.strictEqual(
      log.mock.calls.length,
      1,
      "bannière imprimée malgré --json",
    );
  });
});

describe("Kernel — sendMessage (enveloppe IPC héritée `process:msg`)", () => {
  it("enveloppe le message et relaie handle, options et callback à process.send", () => {
    const k = mkKernel();
    const callback = (): void => {};
    const options = { keepOpen: true };
    withFakeIpc((sent) => {
      const result = k.sendMessage(
        { hello: "primaire" },
        undefined,
        options,
        callback,
      );
      assert.strictEqual(result, true, "rend ce que rend process.send");
      assert.strictEqual(sent.length, 1);
      assert.deepStrictEqual(sent[0], [
        { type: "process:msg", data: { hello: "primaire" } },
        undefined,
        options,
        callback,
      ]);
    });
  });

  it("rend false quand process.send rend false", () => {
    const k = mkKernel();
    withFakeIpc((sent) => {
      assert.strictEqual(k.sendMessage("x"), false);
      assert.strictEqual(sent.length, 1);
    }, false);
  });

  it("sans canal IPC : lève « process.send not found »", () => {
    const k = mkKernel();
    withoutIpc(() => {
      assert.throws(() => k.sendMessage("x"), {
        message: "process.send not found ",
      });
    });
  });
});

// ─── La classe extraite, devant un hôte, une topologie et un processus fictifs ──

interface IFakeHost extends IClusterHost {
  readonly fired: unknown[][];
  readonly logged: unknown[][];
}

/** Hôte fictif : enregistre `fire` et `log`, chaque champ mutable. */
function mkHost(over: Partial<IClusterHost> = {}): IFakeHost {
  const fired: unknown[][] = [];
  const logged: unknown[][] = [];
  return {
    console: false,
    reporterOwnsHeader: false,
    cli: null,
    runProfile: { ...CONSOLE_RUN_PROFILE },
    environment: "development",
    appEnvironment: { environment: "recette" },
    debug: false,
    fire: (event: KernelEventsType, ...args: unknown[]): boolean => {
      fired.push([event, ...args]);
      return true;
    },
    log: (...args: unknown[]): void => {
      logged.push(args);
    },
    fired,
    logged,
    ...over,
  };
}

/** Processus fictif : pid imposé, écouteurs `message` capturés, envoi enregistré. */
function mkProc(
  pid = 4242,
  withSend = true,
): {
  proc: IClusterProcess;
  listeners: Array<(message: unknown) => void>;
  sent: unknown[][];
} {
  const listeners: Array<(message: unknown) => void> = [];
  const sent: unknown[][] = [];
  const base = {
    pid,
    on: (_event: "message", listener: (message: unknown) => void): void => {
      listeners.push(listener);
    },
  };
  const proc: IClusterProcess = withSend
    ? {
        ...base,
        send: (...args: unknown[]): boolean => {
          sent.push(args);
          return true;
        },
      }
    : base;
  return { proc, listeners, sent };
}

const PRIMARY: IClusterTopology = { isPrimary: true, isWorker: false };

function mkWorkerTopology(id: number): IClusterTopology {
  const worker = new cluster.Worker();
  worker.id = id;
  return { isPrimary: false, isWorker: true, worker };
}

describe("KernelCluster — identité", () => {
  it("primaire : master, pid du processus injecté, pas de worker", () => {
    const { proc } = mkProc(4242);
    const link = new KernelCluster(mkHost(), PRIMARY, proc);
    assert.strictEqual(link.typeCluster, "master");
    assert.strictEqual(link.pid, 4242);
    assert.strictEqual(link.workerId, undefined);
    assert.strictEqual(link.worker, undefined);
    assert.strictEqual(link.clusterIsMaster(), true);
  });

  it("worker : worker, identité adoptée depuis la topologie", () => {
    const topology = mkWorkerTopology(3);
    const link = new KernelCluster(mkHost(), topology, mkProc(77).proc);
    assert.strictEqual(link.typeCluster, "worker");
    assert.strictEqual(link.pid, 77);
    assert.strictEqual(link.workerId, 3);
    assert.strictEqual(link.worker, topology.worker);
    assert.strictEqual(link.clusterIsMaster(), false);
  });
});

describe("KernelCluster — logEnv", () => {
  it("rend profil, rôle, environnements et debug lus sur l'hôte à l'appel", () => {
    const host = mkHost({ debug: true });
    const link = new KernelCluster(host, PRIMARY, mkProc().proc);
    const txt = link.logEnv();
    for (const part of [
      "console",
      "Cluster",
      "master",
      "development",
      "recette",
      "Debug",
      "true",
    ]) {
      assert.ok(txt.includes(part), part);
    }
    (host as { appEnvironment: { environment: string } }).appEnvironment = {
      environment: "prod-eu",
    };
    assert.ok(
      link.logEnv().includes("prod-eu"),
      "appEnvironment relu à l'appel",
    );
    assert.strictEqual(
      host.runProfile.servers,
      false,
      "sans CLI, runProfile intact",
    );
  });

  it("piège conservé : avec une CLI, recopie cli.runProfile dans host.runProfile", () => {
    const cli = new CliKernel("development");
    cli.runProfile = SERVER_PROFILE;
    const host = mkHost({ cli });
    const link = new KernelCluster(host, PRIMARY, mkProc().proc);
    assert.ok(link.logEnv().includes("server"));
    assert.strictEqual(host.runProfile, SERVER_PROFILE);
  });
});

describe("KernelCluster — announceRole / join", () => {
  it("primaire : bannière, MASTER, pid rafraîchi ; join fire onCluster(MASTER, hôte, processus) sans écouteur", () => {
    const { proc, listeners } = mkProc(4242);
    const host = mkHost();
    const link = new KernelCluster(host, PRIMARY, proc);
    link.pid = 1;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const role = link.announceRole();
    assert.strictEqual(role, "MASTER");
    assert.strictEqual(link.pid, 4242, "pid rafraîchi");
    assert.strictEqual(log.mock.calls.length, 1);
    assert.ok(
      String(log.mock.calls[0]![0]).includes("Cluster"),
      "c'est logEnv()",
    );
    assert.deepStrictEqual(host.fired, [], "rien n'a fire avant join");
    link.join(role!);
    assert.deepStrictEqual(host.fired, [["onCluster", "MASTER", host, proc]]);
    assert.strictEqual(listeners.length, 0, "le primaire n'écoute pas l'IPC");
  });

  it("branche morte verrouillée : console vrai + --json → null, rien d'imprimé", () => {
    const cli = new CliKernel("development");
    cli.commander?.setOptionValue("json", true);
    const link = new KernelCluster(
      mkHost({ console: true, cli }),
      PRIMARY,
      mkProc().proc,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    assert.strictEqual(link.announceRole(), null);
    assert.strictEqual(log.mock.calls.length, 0);
  });

  it("reporterOwnsHeader ou cli.quietBoot → pas de bannière, rôle rendu quand même", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    assert.strictEqual(
      new KernelCluster(
        mkHost({ reporterOwnsHeader: true }),
        PRIMARY,
        mkProc().proc,
      ).announceRole(),
      "MASTER",
    );
    const cli = new CliKernel("development");
    cli.quietBoot = true;
    assert.strictEqual(
      new KernelCluster(mkHost({ cli }), PRIMARY, mkProc().proc).announceRole(),
      "MASTER",
    );
    assert.strictEqual(log.mock.calls.length, 0);
  });

  it("worker : WORKER, identité adoptée à join, onCluster(WORKER), UN écouteur de contrôle", () => {
    const { proc, listeners } = mkProc(77);
    const host = mkHost();
    const topology = mkWorkerTopology(5);
    const link = new KernelCluster(host, topology, proc);
    link.workerId = undefined;
    link.worker = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const role = link.announceRole();
    assert.strictEqual(role, "WORKER");
    link.join(role!);
    assert.strictEqual(link.workerId, 5, "identité adoptée");
    assert.strictEqual(link.worker, topology.worker);
    assert.deepStrictEqual(host.fired, [["onCluster", "WORKER", host, proc]]);
    assert.strictEqual(listeners.length, 1, "un seul écouteur, posé une fois");

    const deliver = listeners[0]!;
    deliver({ kind: CLUSTER_RT_KIND, payload: "fan-out" });
    deliver({ kind: "nf:probe:snap", snapshot: {} });
    assert.strictEqual(
      host.logged.length,
      0,
      "realtime et sonde : ni log ni re-fire",
    );
    assert.strictEqual(host.fired.length, 1);

    const control = { kind: "nf:probe:ctl", facet: "orm" };
    deliver(control);
    assert.deepStrictEqual(host.logged, [[control, "INFO", "IPC MESSAGE"]]);
    assert.deepStrictEqual(host.fired[1], ["onMessage", control]);
    deliver("texte brut");
    assert.deepStrictEqual(host.fired[2], ["onMessage", "texte brut"]);
  });
});

describe("KernelCluster — sendMessage (processus injecté)", () => {
  it("enveloppe process:msg, relaie handle/options/callback, rend ce que rend send", () => {
    const { proc, sent } = mkProc();
    const link = new KernelCluster(mkHost(), PRIMARY, proc);
    const callback = (): void => {};
    assert.strictEqual(
      link.sendMessage({ a: 1 }, undefined, { keepOpen: true }, callback),
      true,
    );
    assert.deepStrictEqual(sent, [
      [
        { type: "process:msg", data: { a: 1 } },
        undefined,
        { keepOpen: true },
        callback,
      ],
    ]);
  });

  it("sans send → lève « process.send not found »", () => {
    const link = new KernelCluster(mkHost(), PRIMARY, mkProc(1, false).proc);
    assert.throws(() => link.sendMessage("x"), {
      message: "process.send not found ",
    });
  });
});
