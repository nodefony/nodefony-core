/// <reference types="node" />
/**
 * Unit — l'hôte Vite (ADR-0030 §D1) : spécification lue, format de journal,
 * logger donné à Vite, sonde de port, et le service servi au teneur — sur un
 * double de Vite, sans process ni réseau (sauf la sonde, éprouvée sur de vrais
 * ports). Le chemin réel (fork, vraie Vite) est celui des tests d'intégration
 * de `ViteProcessSupervisor`.
 */
import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import type { InlineConfig } from "vite";
import {
  createViteHostLogger,
  createViteHostService,
  formatViteHostLog,
  parseViteHostLine,
  probePort,
  readViteHostSpec,
  type IViteHostDeps,
  type IViteHostServer,
  type PortProbe,
  type ViteHostStream,
} from "../../service/viteHost";

const SPEC = {
  family: "default",
  configFile: "/app/front/vite.config.generated.mjs",
  host: "127.0.0.1",
  port: 5173,
  portRetryAttempts: 3,
  mode: "development",
  title: "nodefony-vite[app]",
};

describe("readViteHostSpec — la spécification se valide, elle ne se croit pas", () => {
  it("rend la spécification typée", () => {
    expect(readViteHostSpec(SPEC)).to.deep.equal(SPEC);
    expect(readViteHostSpec({ ...SPEC, mode: null }).mode).to.equal(null);
  });

  it.each([
    ["famille qui casserait le préfixe", { family: "a] b" }],
    ["famille vide", { family: "" }],
    ["port nul", { port: 0 }],
    ["port hors bornes", { port: 70_000 }],
    ["port non entier", { port: 51.5 }],
    ["replis négatifs", { portRetryAttempts: -1 }],
    ["mode vide", { mode: "" }],
    ["titre avec espace", { title: "nodefony vite" }],
    ["config absente", { configFile: 42 }],
  ])("refuse : %s", (_label, patch) => {
    expect(() => readViteHostSpec({ ...SPEC, ...patch })).to.throw(
      /spécification de l'hôte Vite/,
    );
  });
});

describe("format de journal — une écriture, une lecture", () => {
  it("chaque ligne porte préfixe et niveau ; aller-retour sans perte", () => {
    const text = formatViteHostLog("react", "warn", "ligne 1\r\n\nligne 2");
    expect(text).to.equal(
      "[vite:react] WARN ligne 1\n[vite:react] WARN ligne 2\n",
    );
    const lines = text.trimEnd().split("\n").map(parseViteHostLine);
    expect(lines).to.deep.equal([
      { level: "warn", text: "ligne 1" },
      { level: "warn", text: "ligne 2" },
    ]);
    expect(parseViteHostLine("[vite:react] ERROR boom")).to.deep.equal({
      level: "error",
      text: "boom",
    });
    expect(parseViteHostLine("[vite:react] prêt")).to.deep.equal({
      level: "info",
      text: "prêt",
    });
  });

  it("une ligne qui ne vient pas du logger de l'hôte n'est pas interprétée", () => {
    expect(parseViteHostLine("console.log d'un greffon")).to.equal(null);
    expect(parseViteHostLine("[vite:sans-fin")).to.equal(null);
  });

  it("un message vide ne produit rien", () => {
    expect(formatViteHostLog("react", "info", "  \n")).to.equal("");
  });
});

describe("createViteHostLogger — la sémantique de Vite, nos flux", () => {
  function capture() {
    const out: Array<[ViteHostStream, string]> = [];
    const logger = createViteHostLogger("vue", (s, t) => void out.push([s, t]));
    return { out, logger };
  }

  it("info → sortie standard ; warn et error → erreur, marqués", () => {
    const { out, logger } = capture();
    logger.info("prêt");
    logger.warn("attention");
    logger.error("panne");
    expect(out).to.deep.equal([
      ["out", "[vite:vue] prêt\n"],
      ["err", "[vite:vue] WARN attention\n"],
      ["err", "[vite:vue] ERROR panne\n"],
    ]);
  });

  it("warnOnce n'écrit qu'une fois ; hasWarned suit warn et error", () => {
    const { out, logger } = capture();
    expect(logger.hasWarned).to.equal(false);
    logger.warnOnce("une fois");
    logger.warnOnce("une fois");
    expect(out).to.have.length(1);
    expect(logger.hasWarned).to.equal(true);
  });

  it("hasErrorLogged reconnaît l'erreur journalisée — Vite s'en sert pour ne pas la redire", () => {
    const { logger } = capture();
    const err = new Error("x");
    expect(logger.hasErrorLogged(err)).to.equal(false);
    logger.error("x", { error: err });
    expect(logger.hasErrorLogged(err)).to.equal(true);
  });

  it("clearScreen n'écrit RIEN — l'écran n'est pas à Vite", () => {
    const { out, logger } = capture();
    logger.clearScreen("info");
    expect(out).to.deep.equal([]);
  });

  it("l'environnement ne précède que les messages horodatés, comme chez Vite", () => {
    const { out, logger } = capture();
    logger.info("hmr", { timestamp: true, environment: "(client)" });
    logger.info("brut", { environment: "(client)" });
    expect(out.map(([, t]) => t)).to.deep.equal([
      "[vite:vue] (client) hmr\n",
      "[vite:vue] brut\n",
    ]);
  });
});

describe("probePort — un port se CONSTATE", () => {
  const held: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      held.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
    );
  });

  it("libre puis pris, sur de vrais ports", async () => {
    const server = net.createServer();
    held.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(await probePort("127.0.0.1", port)).to.equal("taken");
    await new Promise<void>((r) => server.close(() => r()));
    held.length = 0;
    expect(await probePort("127.0.0.1", port)).to.equal("free");
  });

  it("une autre panne que « port pris » remonte — un autre port ne la réparerait pas", async () => {
    await expect(probePort("adresse.invalide.", 5173)).rejects.toThrow();
  });
});

/** Un double de Vite : ce que l'hôte lui demande, et ce qu'on lui fait répondre. */
function fakeWorld(opts: {
  taken?: ReadonlySet<number>;
  listenFailures?: Map<number, Error>;
  boundPort?: number;
}) {
  const calls = {
    configs: [] as InlineConfig[],
    listens: [] as number[],
    closes: 0,
    probes: [] as number[],
    titles: [] as string[],
  };
  const taken = new Set(opts.taken ?? []);
  const server: IViteHostServer = {
    listen: async (port) => {
      calls.listens.push(port ?? -1);
      const failure = opts.listenFailures?.get(port ?? -1);
      if (failure) {
        // Le port a été pris entre la sonde et l'écoute (course).
        taken.add(port ?? -1);
        throw failure;
      }
      return undefined;
    },
    close: async () => {
      calls.closes++;
    },
    httpServer: {
      address: () => ({
        address: "127.0.0.1",
        family: "IPv4",
        port: opts.boundPort ?? calls.listens.at(-1) ?? 0,
      }),
    },
  };
  const deps: IViteHostDeps = {
    loadVite: async () => ({
      createServer: async (config: InlineConfig) => {
        calls.configs.push(config);
        return server;
      },
    }),
    probePort: async (_host, port): Promise<PortProbe> => {
      calls.probes.push(port);
      return taken.has(port) ? "taken" : "free";
    },
    write: () => {},
    setTitle: (t) => void calls.titles.push(t),
  };
  return { calls, deps };
}

describe("createViteHostService — le service servi au teneur", () => {
  it("impose les remparts par la config inline, et rapporte le port de la socket", async () => {
    const { calls, deps } = fakeWorld({ boundPort: 5173 });
    const data = await createViteHostService(deps).start(SPEC);
    expect(data).to.deep.equal({ port: 5173, portRetries: 0 });
    expect(calls.titles).to.deep.equal(["nodefony-vite[app]"]);
    const [config] = calls.configs;
    expect(config?.configFile).to.equal(SPEC.configFile);
    expect(config?.mode).to.equal("development");
    expect(config?.clearScreen).to.equal(false);
    expect(config?.server?.forwardConsole).to.equal(false);
    expect(config?.server?.strictPort).to.equal(true);
    expect(config?.server?.host).to.equal("127.0.0.1");
    expect(config?.customLogger).to.be.an("object");
  });

  it("mode `null` → aucun `mode` inline : celui de la config s'applique", async () => {
    const { calls, deps } = fakeWorld({});
    await createViteHostService(deps).start({ ...SPEC, mode: null });
    expect(calls.configs[0]).to.not.have.property("mode");
  });

  it("port pris → le suivant, sondé AVANT de créer Vite (un seul createServer)", async () => {
    const { calls, deps } = fakeWorld({ taken: new Set([5173, 5174]) });
    const data = await createViteHostService(deps).start(SPEC);
    expect(data).to.deep.equal({ port: 5175, portRetries: 2 });
    expect(calls.configs).to.have.length(1);
    expect(calls.configs[0]?.server?.port).to.equal(5175);
    expect(calls.listens).to.deep.equal([5175]);
  });

  it("bloc entier pris → échec nommé, Vite jamais créé", async () => {
    const { calls, deps } = fakeWorld({
      taken: new Set([5173, 5174, 5175, 5176]),
    });
    await expect(createViteHostService(deps).start(SPEC)).rejects.toThrow(
      /ports 5173 à 5176 tous occupés/,
    );
    expect(calls.configs).to.have.length(0);
  });

  it("port pris ENTRE la sonde et l'écoute → même serveur, port suivant", async () => {
    const { calls, deps } = fakeWorld({
      listenFailures: new Map([
        [5173, new Error("Port 5173 is already in use")],
      ]),
    });
    const data = await createViteHostService(deps).start(SPEC);
    expect(data).to.deep.equal({ port: 5174, portRetries: 1 });
    expect(calls.configs).to.have.length(1);
    expect(calls.listens).to.deep.equal([5173, 5174]);
    expect(calls.closes).to.equal(0);
  });

  it("écoute en échec sur un port resté libre → Vite fermé, erreur d'origine levée", async () => {
    const boom = new Error("EPERM");
    const { calls, deps } = fakeWorld({
      listenFailures: new Map([[5173, boom]]),
    });
    // La sonde ne voit pas le port pris : ce n'est PAS une course.
    const blind: IViteHostDeps = { ...deps, probePort: async () => "free" };
    await expect(createViteHostService(blind).start(SPEC)).rejects.toBe(boom);
    expect(calls.closes).to.equal(1);
  });

  it("stop ferme Vite ; avant tout démarrage, il ne fait rien", async () => {
    const { calls, deps } = fakeWorld({});
    const service = createViteHostService(deps);
    await service.stop();
    expect(calls.closes).to.equal(0);
    await service.start(SPEC);
    await service.stop();
    await service.stop();
    expect(calls.closes).to.equal(1);
  });
});
