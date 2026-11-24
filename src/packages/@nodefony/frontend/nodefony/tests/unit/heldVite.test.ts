/**
 * Vite porté par le superviseur (ADR-0030) — ce qui se décide sans lancer
 * Vite : l'empreinte (§D4), les échecs de l'adaptateur `HeldViteSupervisor`
 * (refus, préparation ratée, `errored`, arrêt), et le choix du mode par
 * `FrontendService` (porté sous superviseur, tenu par le serveur sinon).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Container,
  type IHeldHostStatus,
  type IHeldServiceDeclaration,
  type IHeldServicesClient,
} from "nodefony";
import FrontendService from "../../service/FrontendService";
import { HeldViteSupervisor } from "../../service/HeldViteSupervisor";
import ViteProcessSupervisor from "../../service/ViteProcessSupervisor";
import {
  heldViteFingerprint,
  heldViteVersions,
  installedVersion,
  packageNameOf,
} from "../../service/viteFingerprint";
import {
  VITE_HOST_MODULE,
  type ViteSupervisorOptions,
} from "../../service/viteFamily";
import { FrontendSupervisorStartError } from "../../src/errors/FrontendError";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";
import type { FrontPresetType } from "../../interfaces/IFrontPreset";

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nf-held-vite-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function entry(
  root: string,
  type: FrontPresetType = "vanilla",
): IResolvedFrontendEntry {
  return {
    moduleName: "fixture",
    entryName: "fixture",
    type,
    root,
    entryFile: "src/main.ts",
    outDir: path.join(root, "dist"),
    publicPath: "/_assets/fixture/",
  };
}

const silent = { info: () => {}, error: () => {}, debug: () => {} };

function opts(cwd: string): ViteSupervisorOptions {
  return {
    devHost: "127.0.0.1",
    devPort: 5173,
    startupTimeoutMs: 20_000,
    pipeLogs: false,
    cwd,
    logger: silent,
  };
}

function status(
  key: string,
  state: IHeldHostStatus["state"],
  extra: Partial<IHeldHostStatus> = {},
): IHeldHostStatus {
  return {
    key,
    state,
    pid: 4242,
    data: state === "ready" ? { port: 5173, portRetries: 0 } : null,
    lastError: null,
    restartCount: 0,
    missedPongs: 0,
    ...extra,
  };
}

/**
 * Faux client : enregistre chaque geste. `onSubmit` décide de la suite —
 * pousser un état, refuser le plan.
 */
function fakeClient(
  onSubmit: (
    d: IHeldServiceDeclaration,
    push: (s: IHeldHostStatus) => void,
  ) => Promise<void> = async (d, push) => push(status(d.key, "ready")),
): {
  client: IHeldServicesClient;
  calls: string[];
  declared: IHeldServiceDeclaration[];
} {
  const calls: string[] = [];
  const declared: IHeldServiceDeclaration[] = [];
  const watchers = new Map<string, (s: IHeldHostStatus) => void>();
  const push = (s: IHeldHostStatus): void => watchers.get(s.key)?.(s);
  return {
    calls,
    declared,
    client: {
      owner: "frontend",
      expect: (keys) => calls.push(`expect:${[...keys].join(",")}`),
      submit: (d) => {
        calls.push(`submit:${d.key}`);
        declared.push(d);
        return onSubmit(d, push);
      },
      withdraw: (key) => calls.push(`withdraw:${key}`),
      watch: (key, fn) => {
        calls.push(`watch:${key}`);
        watchers.set(key, fn);
        return () => {
          calls.push(`unwatch:${key}`);
          watchers.delete(key);
        };
      },
      close: () => calls.push("close"),
    },
  };
}

describe("empreinte d'un Vite porté (ADR-0030 §D4)", () => {
  const base = {
    module: VITE_HOST_MODULE,
    spec: {
      family: "default",
      configFile: "/a/vite.mjs",
      port: 5173,
      title: "nodefony-vite[a]",
    },
    cwd: "/a",
    env: { NODE_ENV: "development" },
    tuning: { startupTimeoutMs: 20_000 },
  };
  const versions = { vite: "8.3.8", "@vitejs/plugin-react": "5.0.0" };
  const fp = heldViteFingerprint(base, versions);

  it("le TITRE du process est hors empreinte : il suit les entrées, Vite se relance seul", () => {
    expect(
      heldViteFingerprint(
        { ...base, spec: { ...base.spec, title: "nodefony-vite[a+b]" } },
        versions,
      ),
    ).to.equal(fp);
  });

  it("change avec ce qui exige un process neuf : version de Vite ou d'un greffon, port, cwd, env, réglage", () => {
    const variants = [
      heldViteFingerprint(base, { ...versions, vite: "8.4.0" }),
      heldViteFingerprint(base, {
        ...versions,
        "@vitejs/plugin-react": "5.0.1",
      }),
      heldViteFingerprint(
        { ...base, spec: { ...base.spec, port: 5174 } },
        versions,
      ),
      heldViteFingerprint({ ...base, cwd: "/b" }, versions),
      heldViteFingerprint({ ...base, env: { NODE_ENV: "test" } }, versions),
      heldViteFingerprint(
        { ...base, tuning: { startupTimeoutMs: 1 } },
        versions,
      ),
    ];
    for (const v of variants) expect(v).to.not.equal(fp);
    expect(new Set(variants).size).to.equal(variants.length);
  });

  it("packageNameOf retire le sous-chemin, garde la portée", () => {
    expect(packageNameOf("@angular/build/vite")).to.equal("@angular/build");
    expect(packageNameOf("@vitejs/plugin-react")).to.equal(
      "@vitejs/plugin-react",
    );
    expect(packageNameOf("vite/client")).to.equal("vite");
  });

  it("installedVersion remonte les node_modules comme Node, et rend null si absent", async () => {
    const root = tmp();
    const pkg = path.join(root, "node_modules", "@scope", "plug");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), '{"version":"1.2.3"}');
    const deep = path.join(root, "a", "b");
    mkdirSync(deep, { recursive: true });
    expect(await installedVersion("@scope/plug", deep)).to.equal("1.2.3");
    expect(await installedVersion("absent-pkg-xyz", deep)).to.equal(null);
  });

  it("heldViteVersions : Vite (résolu depuis l'hôte) et chaque greffon de la famille", async () => {
    const v = await heldViteVersions([entry(tmp(), "react19")], tmp());
    expect(Object.keys(v)).to.deep.equal(["vite", "@vitejs/plugin-react"]);
    expect(v.vite).to.be.a("string");
  });
});

describe("HeldViteSupervisor — échecs et arrêt (faux client)", () => {
  it("écoute AVANT de déclarer, puis prêt dès l'état poussé", async () => {
    const { client, calls, declared } = fakeClient();
    const sup = new HeldViteSupervisor(opts(tmp()), client);
    const root = tmp();
    await sup.start([entry(root)], {});
    expect(calls).to.deep.equal(["watch:vite:default", "submit:vite:default"]);
    expect(sup.status().state).to.equal("ready");
    expect(sup.status().port).to.equal(5173);
    const [d] = declared;
    expect(d?.module).to.equal(VITE_HOST_MODULE);
    expect(d?.env).to.not.have.property("PATH");
    expect(d?.spec.configFile).to.equal(
      path.join(root, "vite.config.generated.mjs"),
    );
  });

  it("plan refusé : FrontendSupervisorStartError qui porte la cause du superviseur", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("supervisor refused the plan: supervisor is stopping");
    });
    const sup = new HeldViteSupervisor(opts(tmp()), client);
    const start = sup.start([entry(tmp())], {});
    await expect(start).rejects.toBeInstanceOf(FrontendSupervisorStartError);
    await expect(start).rejects.toThrow(/supervisor is stopping/);
  });

  it("config impossible à écrire : la clé est RETIRÉE du plan (il n'attend pas une famille qui ne viendra pas)", async () => {
    const { client, calls } = fakeClient();
    const sup = new HeldViteSupervisor(opts(tmp()), client);
    const missing = path.join(tmp(), "n-existe-pas", "encore-moins");
    await expect(sup.start([entry(missing)], {})).rejects.toBeInstanceOf(
      FrontendSupervisorStartError,
    );
    expect(calls).to.include("withdraw:vite:default");
    expect(calls).to.not.include("submit:vite:default");
  });

  it("hôte `errored` : le démarrage rejette avec sa dernière erreur", async () => {
    const { client } = fakeClient(async (d, push) =>
      push(status(d.key, "errored", { lastError: "Port 5173 is taken" })),
    );
    const sup = new HeldViteSupervisor(opts(tmp()), client);
    await expect(sup.start([entry(tmp())], {})).rejects.toThrow(
      /Port 5173 is taken/,
    );
  });

  it("stop : cesse d'écouter, sans rien demander au superviseur (l'hôte lui appartient)", async () => {
    const { client, calls } = fakeClient();
    const sup = new HeldViteSupervisor(opts(tmp()), client);
    await sup.start([entry(tmp())], {});
    calls.length = 0;
    await sup.stop();
    expect(calls).to.deep.equal(["unwatch:vite:default"]);
    expect(sup.status().state).to.equal("ready");
  });
});

describe("FrontendService — le mode se décide sur la présence du superviseur", () => {
  /** Service sur un faux noyau ; `held` = ce que rend `kernel.heldServices`. */
  async function bootService(held: IHeldServicesClient | null): Promise<{
    service: FrontendService;
    owners: string[];
    boot: () => Promise<void>;
  }> {
    const noop = (): undefined => undefined;
    const rappels = new Map<string, () => Promise<void>>();
    const owners: string[] = [];
    const container = new Container();
    container.set("kernel", {
      environment: "development",
      domain: "nodefony.com",
      once: (ev: string, cb: () => Promise<void>) => rappels.set(ev, cb),
      fire: noop,
      reportBootLine: noop,
      setBootLines: noop,
      reportBootNotice: noop,
      heldServices: (owner: string) => {
        owners.push(owner);
        return held;
      },
    });
    const module = {
      kernel: container.get("kernel"),
      container,
      notificationsCenter: { on: noop, fire: noop, removeListener: noop },
      options: {},
      log: noop,
    } as unknown as ConstructorParameters<typeof FrontendService>[0];
    const service = new FrontendService(module);
    (service as unknown as { log: unknown }).log = noop;
    await service.init();
    (service as unknown as { entries: IResolvedFrontendEntry[] }).entries.push(
      entry(tmp()),
    );
    const boot = rappels.get("onServersReady");
    if (boot === undefined) throw new Error("onServersReady non écouté");
    return { service, owners, boot };
  }

  it("sous superviseur : déclare le propriétaire `frontend`, attend toutes les familles, porte chacune", async () => {
    const { client, calls } = fakeClient();
    const booted = await bootService(client);
    await booted.boot();
    expect(booted.owners).to.deep.equal(["frontend"]);
    expect(calls.slice(0, 3)).to.deep.equal([
      "expect:vite:default",
      "watch:vite:default",
      "submit:vite:default",
    ]);
    const [first] = booted.service.statusAll();
    expect(first?.status.state).to.equal("ready");
    const sups = (
      booted.service as unknown as { supervisors: Map<string, unknown> }
    ).supervisors;
    expect(sups.get("default")).to.be.instanceOf(HeldViteSupervisor);
    await booted.service.stopDev();
    expect(calls.slice(-2)).to.deep.equal(["unwatch:vite:default", "close"]);
  });

  it("sous superviseur, une famille qui échoue AVANT sa déclaration est retirée du plan", async () => {
    const { client, calls } = fakeClient();
    const booted = await bootService(client);
    // Le builder lève avant que l'adaptateur ne soit lancé.
    (
      booted.service as unknown as {
        builder: { buildViteConfig: () => Promise<never> };
      }
    ).builder.buildViteConfig = () => Promise.reject(new Error("builder KO"));
    await booted.boot();
    expect(calls).to.include("withdraw:vite:default");
    expect(calls).to.not.include("submit:vite:default");
  });

  it("sans superviseur : le serveur tient Vite lui-même (ViteProcessSupervisor)", async () => {
    const booted = await bootService(null);
    const svc = booted.service as unknown as {
      supervisors: Map<string, unknown>;
      startFamily: (...a: unknown[]) => Promise<void>;
    };
    // Racine absente : la config ne s'écrit pas, AUCUN hôte n'est lancé — seul
    // le choix de l'adaptateur, posé avant le premier `await`, est observé.
    const started = svc.startFamily(
      "default",
      [entry(path.join(tmp(), "absente", "racine"))],
      5173,
      { nodeEnv: "development", extraEnv: {} },
    );
    expect(svc.supervisors.get("default")).to.be.instanceOf(
      ViteProcessSupervisor,
    );
    await expect(started).rejects.toBeInstanceOf(FrontendSupervisorStartError);
  });
});
