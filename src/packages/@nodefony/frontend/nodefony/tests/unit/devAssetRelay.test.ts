/// <reference types="node" />
/**
 * Unit — #526 : les assets d'un front en mode Vite s'affichent en développement.
 *
 * Le défaut : Vite fabrique ses URLs d'assets RELATIVES AU DOCUMENT (une image
 * importée devient `/src/logo.png`, un `url()` CSS aussi) ; le navigateur les
 * résout contre l'origine de la PAGE, servie par Nodefony, qui répondait 404.
 *
 * Le remède a deux moitiés, verrouillées ici sans lancer Vite :
 *  1. chaque instance Vite reçoit un chemin de base réservé `/_vite/<famille>/`
 *     — que TOUTES les balises émises doivent porter, sinon Vite les refuse ;
 *  2. Nodefony relaie ce préfixe vers Vite, avec une cible calculée par la MÊME
 *     règle que les balises (`derivableHost` → `devOrigin`) : un asset relayé
 *     atterrit sur l'origine qui a servi ses modules.
 * La preuve sur un vrai Vite vit dans `integration/devAssetBase.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { Container } from "nodefony";
import FrontendService from "../../service/FrontendService";
import TemplateHelper from "../../src/template/TemplateHelper.js";
import { devBasePath, DEV_BASE_ROOT } from "../../src/isolationGroups.js";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../../interfaces/IViteSupervisor.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

const entry: IResolvedFrontendEntry = {
  moduleName: "app",
  entryName: "app",
  type: "react19",
  root: "/abs/app/frontend",
  entryFile: "src/main.tsx",
  outDir: "/abs/app/public/dist",
  publicPath: "/_assets/app/",
  apiProxyPaths: [],
};

function supervisorWith(
  status: Partial<IViteSupervisorStatus>,
  withoutBase = false,
): IViteSupervisor {
  const all: IViteSupervisorStatus = {
    state: "ready",
    host: "127.0.0.1",
    origin: "https://127.0.0.1:5173",
    base: "/_vite/default/",
    port: 5173,
    pid: 42,
    lastError: null,
    entries: [entry],
    https: true,
    portRetries: 0,
    restartCount: 0,
    healthFailures: 0,
    ...status,
  };
  const { base: _base, ...rest } = all;
  const full: IViteSupervisorStatus = withoutBase ? rest : all;
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    status: () => full,
  };
}

describe("devBasePath — l'espace réservé aux serveurs Vite", () => {
  it("un préfixe PAR famille, sous /_vite/", () => {
    expect(devBasePath("default")).to.equal("/_vite/default/");
    expect(devBasePath("vue")).to.equal("/_vite/vue/");
    expect(devBasePath("angular")).to.equal("/_vite/angular/");
    expect(devBasePath("vue").startsWith(DEV_BASE_ROOT)).to.equal(true);
  });
});

describe("TemplateHelper — toutes les balises portent le chemin de base", () => {
  const tags = new TemplateHelper(supervisorWith({}), "development").renderTags(
    "app",
  );

  it("client Vite, entrée, préambule React, pont HMR, debug bar", () => {
    expect(tags).to.include(
      'src="https://127.0.0.1:5173/_vite/default/@vite/client"',
    );
    expect(tags).to.include(
      'src="https://127.0.0.1:5173/_vite/default/@fs/abs/app/frontend/src/main.tsx"',
    );
    expect(tags).to.include(
      'from "https://127.0.0.1:5173/_vite/default/@react-refresh"',
    );
    expect(tags).to.include(
      'import("https://127.0.0.1:5173/_vite/default/@vite/client")',
    );
  });

  it("aucune URL Vite SANS le préfixe — Vite la refuserait", () => {
    // Avec `base`, Vite ne sert rien hors de son chemin : une seule balise
    // oubliée et la page ne démarre plus.
    // (`viteOrigin` de la debug bar s'arrête sur `/_vite/default"` : base sans
    // `/` final, suffixée ensuite.)
    expect(tags).to.not.match(/127\.0\.0\.1:5173\/(?!_vite\/default[/"])/);
  });

  it("status sans `base` (double historique) : URLs à la racine, sans `//`", () => {
    const legacy = new TemplateHelper(
      supervisorWith({}, true),
      "development",
    ).renderTags("app");
    expect(legacy).to.include('src="https://127.0.0.1:5173/@vite/client"');
    expect(legacy).to.not.include("5173//");
  });
});

describe("TemplateHelper.devOrigin — cible du relais", () => {
  it("MÊME origine que les balises, pour chaque client", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    expect(helper.devOrigin()).to.equal("https://127.0.0.1:5173");
    // Boucle locale : recomposée avec le port RÉEL de Vite.
    expect(helper.devOrigin("localhost")).to.equal("https://localhost:5173");
    // Autre hôte (déjà filtré par l'appelant) : le nom seul change.
    expect(helper.devOrigin("host.docker.internal")).to.equal(
      "https://host.docker.internal:5173",
    );
    const tags = helper.renderTags("app", undefined, "host.docker.internal");
    expect(tags).to.include(
      "https://host.docker.internal:5173/_vite/default/@vite/client",
    );
  });

  it("Vite sans port résolu → rien à relayer", () => {
    const helper = new TemplateHelper(
      supervisorWith({ port: null, state: "starting" }),
      "development",
    );
    expect(helper.devOrigin()).to.equal(undefined);
  });

  it("sans superviseur (prod) → rien à relayer", () => {
    expect(new TemplateHelper(null, "production").devOrigin()).to.equal(
      undefined,
    );
  });
});

type Relay = (domain: string) => string | undefined;

/** Faux `server-static` : retient les relais déclarés, comme le vrai. */
function fakeStatic() {
  const relays = new Map<string, Relay>();
  return {
    relays,
    addRelay: (prefix: string, resolve: Relay) => relays.set(prefix, resolve),
    removeRelay: (prefix: string) => relays.delete(prefix),
  };
}

/** Faux `HttpKernel` : seuls ces noms passent la barrière `trustedHosts`. */
function httpKernel(trusted: string[]) {
  return {
    trustedHosts: trusted,
    isTrustedHostname: (h: string) =>
      ["127.0.0.1", "localhost", ...trusted].includes(h),
  };
}

function serviceWith(stat: ReturnType<typeof fakeStatic>, trusted: string[]) {
  const noop = () => undefined;
  const container = new Container();
  container.set("kernel", { environment: "development", domain: "app.test" });
  container.set("HttpKernel", httpKernel(trusted));
  container.set("server-static", stat);
  return new FrontendService({
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options: {},
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0]);
}

const register = (
  svc: FrontendService,
  devBase: string,
  helper: TemplateHelper,
): void =>
  (
    svc as unknown as {
      registerDevRelay(b: string, h: TemplateHelper): void;
    }
  ).registerDevRelay(devBase, helper);

describe("FrontendService — relais /_vite/<famille>/ (une seule politique d'hôte)", () => {
  it("déclare le préfixe de la famille auprès du serveur statique", () => {
    const stat = fakeStatic();
    const svc = serviceWith(stat, []);
    register(
      svc,
      devBasePath("default"),
      new TemplateHelper(supervisorWith({}), "development"),
    );
    expect([...stat.relays.keys()]).to.deep.equal(["/_vite/default/"]);
  });

  it("hôte de CONFIANCE → la cible suit le client (poste ET conteneur)", () => {
    const stat = fakeStatic();
    const svc = serviceWith(stat, ["host.docker.internal"]);
    register(
      svc,
      "/_vite/default/",
      new TemplateHelper(supervisorWith({}), "development"),
    );
    const resolve = stat.relays.get("/_vite/default/");
    expect(resolve?.("127.0.0.1")).to.equal("https://127.0.0.1:5173");
    expect(resolve?.("host.docker.internal")).to.equal(
      "https://host.docker.internal:5173",
    );
  });

  it("hôte HORS barrière → origine résolue, jamais l'hôte du client", () => {
    const stat = fakeStatic();
    const svc = serviceWith(stat, []);
    register(
      svc,
      "/_vite/default/",
      new TemplateHelper(supervisorWith({}), "development"),
    );
    expect(stat.relays.get("/_vite/default/")?.("attaquant.test")).to.equal(
      "https://127.0.0.1:5173",
    );
  });

  it("origine épinglée par CONFIG → la cible est l'origine écrite", () => {
    const stat = fakeStatic();
    const svc = serviceWith(stat, ["host.docker.internal"]);
    (svc as unknown as { originPinnedBy: string }).originPinnedBy = "config";
    register(
      svc,
      "/_vite/default/",
      new TemplateHelper(
        supervisorWith({ origin: "https://dev.example.com:8443" }),
        "development",
      ),
    );
    expect(stat.relays.get("/_vite/default/")?.("localhost")).to.equal(
      "https://dev.example.com:8443",
    );
  });

  it("serveur statique SANS relais → WARNING nommé, jamais un silence", () => {
    const logs: Array<[unknown, string | undefined]> = [];
    const noop = () => undefined;
    const container = new Container();
    container.set("kernel", { environment: "development", domain: "app.test" });
    container.set("server-static", { addMount: noop });
    const svc = new FrontendService({
      kernel: container.get("kernel"),
      container,
      notificationsCenter: { on: noop, fire: noop, removeListener: noop },
      options: {},
      log: noop,
    } as unknown as ConstructorParameters<typeof FrontendService>[0]);
    (svc as unknown as { log: (m: unknown, s?: string) => void }).log = (
      m,
      sev,
    ) => logs.push([m, sev]);
    register(
      svc,
      "/_vite/default/",
      new TemplateHelper(supervisorWith({}), "development"),
    );
    const warning = logs.find(([, sev]) => sev === "WARNING");
    expect(String(warning?.[0])).to.include("/_vite/default/");
    expect(String(warning?.[0])).to.include("@nodefony/http");
  });

  it("stopDev retire le relais de chaque famille", async () => {
    const stat = fakeStatic();
    const svc = serviceWith(stat, []);
    const supervisors = (
      svc as unknown as { supervisors: Map<string, IViteSupervisor> }
    ).supervisors;
    for (const family of ["default", "vue"]) {
      supervisors.set(family, supervisorWith({}));
      stat.addRelay(devBasePath(family), () => undefined);
    }
    await svc.stopDev();
    expect(stat.relays.size).to.equal(0);
  });
});
