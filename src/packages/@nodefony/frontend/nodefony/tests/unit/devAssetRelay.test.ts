/// <reference types="node" />
/**
 * Unit — #526 puis #528 : un front Vite se sert sur l'ORIGINE DE LA PAGE.
 *
 * #526 : Vite fabrique ses URLs d'assets relatives au document ; chaque
 * instance reçoit donc un chemin de base réservé `/_vite/<famille>/`, que
 * TOUTES les balises doivent porter (sinon Vite les refuse).
 * #528 : ce préfixe n'est plus redirigé vers Vite mais RELAYÉ par le proxy
 * inverse de `@nodefony/http`. Les balises deviennent relatives : la page,
 * ses scripts, ses images et le socket du rechargement à chaud partagent une
 * origine et un certificat — plus de contenu mixte depuis un autre hôte que
 * la boucle locale. Vite reste sur la boucle locale (`devTarget`).
 *
 * Verrouillé ici sans lancer Vite ; la preuve sur un vrai Vite derrière un vrai
 * Nodefony vit dans `integration/devAssetBase.test.ts` et l'intégration http.
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
    origin: "http://127.0.0.1:5173",
    base: "/_vite/default/",
    port: 5173,
    pid: 42,
    lastError: null,
    entries: [entry],
    https: false,
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

describe("TemplateHelper — balises RELATIVES, toutes sous le chemin de base", () => {
  const tags = new TemplateHelper(supervisorWith({}), "development").renderTags(
    "app",
  );

  it("client Vite, entrée, préambule React, pont HMR", () => {
    expect(tags).to.include('src="/_vite/default/@vite/client"');
    expect(tags).to.include(
      'src="/_vite/default/@fs/abs/app/frontend/src/main.tsx"',
    );
    expect(tags).to.include('from "/_vite/default/@react-refresh"');
    expect(tags).to.include('import("/_vite/default/@vite/client")');
  });

  it("aucune origine dans la page : ni scheme, ni port de Vite", () => {
    // Une seule origine absolue suffirait à ramener le contenu mixte depuis
    // un hôte qui n'est pas la boucle locale (téléphone, conteneur).
    expect(tags).to.not.match(/https?:\/\//);
    expect(tags).to.not.include(":5173");
  });

  it("le `requestHost` déprécié est sans effet", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    expect(
      helper.renderTags("app", undefined, "host.docker.internal"),
    ).to.equal(helper.renderTags("app"));
  });

  it("status sans `base` (double historique) : URLs à la racine, sans `//`", () => {
    const legacy = new TemplateHelper(
      supervisorWith({}, true),
      "development",
    ).renderTags("app");
    expect(legacy).to.include('src="/@vite/client"');
    expect(legacy).to.not.include('"//');
  });
});

describe("TemplateHelper.devTarget — cible LOCALE du proxy", () => {
  it("l'origine locale du superviseur, jamais un hôte client", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    expect(helper.devTarget()).to.equal("http://127.0.0.1:5173");
  });

  it("Vite sans port résolu → rien à relayer", () => {
    const helper = new TemplateHelper(
      supervisorWith({ port: null, state: "starting" }),
      "development",
    );
    expect(helper.devTarget()).to.equal(undefined);
  });

  it("sans superviseur (prod) → rien à relayer", () => {
    expect(new TemplateHelper(null, "production").devTarget()).to.equal(
      undefined,
    );
  });
});

interface IMountOptions {
  target: () => string | undefined;
  websocket: boolean;
  methods: string[];
  stripHeaders: string[];
}

/** Faux `reverse-proxy` : retient les montages, comme le vrai. */
function fakeProxy() {
  const mounts = new Map<string, IMountOptions>();
  return {
    mounts,
    mount: (prefix: string, options: IMountOptions) =>
      mounts.set(prefix, options),
    unmount: (prefix: string) => mounts.delete(prefix),
  };
}

function serviceWith(
  proxy: unknown,
  options: Record<string, unknown> = {},
): { svc: FrontendService; logs: Array<[unknown, string | undefined]> } {
  const logs: Array<[unknown, string | undefined]> = [];
  const noop = () => undefined;
  const container = new Container();
  container.set("kernel", { environment: "development", domain: "app.test" });
  container.set("reverse-proxy", proxy);
  const svc = new FrontendService({
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options,
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0]);
  (svc as unknown as { log: (m: unknown, s?: string) => void }).log = (
    m,
    sev,
  ) => logs.push([m, sev]);
  return { svc, logs };
}

const mountFor = (
  svc: FrontendService,
  devBase: string,
  helper: TemplateHelper,
): void =>
  (
    svc as unknown as {
      mountDevProxy(b: string, h: TemplateHelper): void;
    }
  ).mountDevProxy(devBase, helper);

describe("FrontendService — /_vite/<famille>/ monté sur le proxy inverse", () => {
  it("monte le préfixe : WebSocket relayé, lectures seules, ni cookie ni authorization", () => {
    const proxy = fakeProxy();
    const { svc } = serviceWith(proxy);
    mountFor(
      svc,
      devBasePath("default"),
      new TemplateHelper(supervisorWith({}), "development"),
    );
    const mount = proxy.mounts.get("/_vite/default/");
    expect(mount?.websocket).to.equal(true);
    expect(mount?.methods).to.deep.equal(["GET", "HEAD"]);
    expect(mount?.stripHeaders).to.deep.equal(["cookie", "authorization"]);
    // La cible est LOCALE et calculée à la requête (le port vient au démarrage).
    expect(mount?.target()).to.equal("http://127.0.0.1:5173");
  });

  it("proxy SANS `mount` (@nodefony/http désaligné) → WARNING nommé, jamais un silence", () => {
    const { svc, logs } = serviceWith({ addMount: () => undefined });
    mountFor(
      svc,
      "/_vite/default/",
      new TemplateHelper(supervisorWith({}), "development"),
    );
    const warning = logs.find(([, sev]) => sev === "WARNING");
    expect(String(warning?.[0])).to.include("/_vite/default/");
    expect(String(warning?.[0])).to.include("@nodefony/http");
  });

  it("stopDev démonte le préfixe de chaque famille", async () => {
    const proxy = fakeProxy();
    const { svc } = serviceWith(proxy);
    const supervisors = (
      svc as unknown as { supervisors: Map<string, IViteSupervisor> }
    ).supervisors;
    for (const family of ["default", "vue"]) {
      supervisors.set(family, supervisorWith({}));
      proxy.mount(devBasePath(family), {
        target: () => undefined,
        websocket: true,
        methods: [],
        stripHeaders: [],
      });
    }
    await svc.stopDev();
    expect(proxy.mounts.size).to.equal(0);
  });
});

describe("FrontendService — options publiées rendues sans objet", () => {
  const warnings = (options: Record<string, unknown>) => {
    const { svc, logs } = serviceWith(fakeProxy(), options);
    (
      svc as unknown as { warnDeprecatedOptions(): void }
    ).warnDeprecatedOptions();
    return logs.filter(([, sev]) => sev === "WARNING").map(([m]) => String(m));
  };

  it("`publicOrigin` renseignée : acceptée, ignorée, et DITE", () => {
    const w = warnings({ publicOrigin: "https://dev.example.com:{port}" });
    expect(w).to.have.length(1);
    expect(w[0]).to.include("publicOrigin");
    expect(w[0]).to.include("DÉPRÉCIÉE");
  });

  it("`https: true` : accepté, ignoré, et DIT", () => {
    const w = warnings({ https: true });
    expect(w).to.have.length(1);
    expect(w[0]).to.include("frontend.https");
  });

  it("défauts : aucun avertissement", () => {
    expect(warnings({})).to.have.length(0);
  });
});
