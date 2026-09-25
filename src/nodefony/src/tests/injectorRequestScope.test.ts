//
// ─── Portée `request` de l'injecteur (#485) ──────────────────────────────────
//
// Un service `@injectable({ scope: "request" })` vit dans le scope de la requête
// courante, lu par l'ALS : un exemplaire par requête, nettoyé (LIFO) à sa
// fermeture. Un détenteur singleton est refusé — au boot comme pendant une
// requête — parce qu'il garderait l'exemplaire de la première requête pour
// toutes les suivantes.
//
// Chaque bloc nomme ce qu'il faut débrancher pour le voir tomber.
//
import "reflect-metadata";
import { expect } from "chai";
import { fileURLToPath } from "node:url";
import { AsyncResource } from "node:async_hooks";
import Injector from "../kernel/injector/injector";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import Service from "../Service";
import Container, { Scope } from "../Container";
import RequestContext from "../runtime/RequestContext";
import { BootConfigurationError } from "../kernel/BootConfigurationError";
import {
  services,
  injectable,
  inject,
} from "../kernel/decorators/kernelDecorator";

type Logged = { pci: unknown; severity?: string };
const logged: Logged[] = [];

// Décor d'un serveur réel : la racine porte le journal ; les scopes en héritent.
const root = new Container();
root.set("syslog", {
  log: (pci: unknown, severity?: string) => logged.push({ pci, severity }),
});
root.addScope("request");

/** Ouvre une requête : scope neuf posé dans la bulle ALS, refermé à la fin. */
async function inRequest<T>(fn: (scope: Scope) => T | Promise<T>): Promise<T> {
  const scope = root.enterScope("request");
  try {
    return await RequestContext.run({ requestId: "rs-test", scope }, () =>
      fn(scope),
    );
  } finally {
    root.leaveScope(scope);
  }
}

/** Lit le tableau des objets rattachés — champ privé, lu pour la preuve. */
const ownedOf = (scope: Scope): unknown =>
  (scope as unknown as { owned: unknown }).owned;

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

// ─── Services de test ─────────────────────────────────────────────────────────

const cleanOrder: string[] = [];

class Tenant extends Service {
  readonly scopeSeen: Scope;
  constructor(scope: Scope) {
    super("rsTenant", scope, false);
    this.scopeSeen = scope;
  }
  override clean(syslog = false): void {
    cleanOrder.push("rsTenant");
    super.clean(syslog);
  }
}
injectable({ name: "RsTenant", scope: "request" })(Tenant);

/** Service `request` qui dépend d'un autre : créé APRÈS lui, nettoyé AVANT. */
class Audit extends Service {
  constructor(
    scope: Scope,
    readonly tenant: Tenant,
  ) {
    super("rsAudit", scope, false);
  }
  override clean(syslog = false): void {
    cleanOrder.push("rsAudit");
    super.clean(syslog);
  }
}
inject("RsTenant")(Audit, undefined, 1);
injectable({ name: "RsAudit", scope: "request" })(Audit);

/** Consommateur de portée request — un contrôleur, par son statique. */
class RequestConsumer extends Service {
  static scope = "request";
  constructor(
    readonly context: unknown,
    readonly tenant: Tenant,
  ) {
    super("rsConsumer", root, false);
  }
}
inject("RsTenant")(RequestConsumer, undefined, 1);

// ─── 1. Un exemplaire par requête ─────────────────────────────────────────────
// Débrancher : retirer la branche `request` de `_resolveWithStack`.

describe("Portée request — un exemplaire par requête", () => {
  it("rend le même exemplaire à deux consommateurs d'une même requête, rangé dans SON scope", async () => {
    await inRequest((scope) => {
      const a = Injector.instantiate<RequestConsumer>(RequestConsumer, "ctx");
      const b = Injector.instantiate<RequestConsumer>(RequestConsumer, "ctx");
      expect(a.tenant).to.be.instanceOf(Tenant);
      expect(b.tenant, "même requête → même exemplaire").to.equal(a.tenant);
      expect(a.tenant.scopeSeen, "reçoit le scope en 1ᵉʳ argument").to.equal(
        scope,
      );
      expect(scope.hasOwn("rsTenant"), "rangé sur le scope").to.equal(true);
      expect(root.has("rsTenant"), "jamais sur la racine").to.equal(false);
    });
  });

  it("donne un exemplaire DISTINCT à chacune de deux requêtes concurrentes", async () => {
    const seen: Tenant[] = [];
    const request = () =>
      inRequest(async (scope) => {
        await tick();
        const first = Injector.instantiate<RequestConsumer>(
          RequestConsumer,
          "ctx",
        ).tenant;
        await tick();
        const again = Injector.instantiate<RequestConsumer>(
          RequestConsumer,
          "ctx",
        ).tenant;
        expect(again, "stable au fil des await de SA requête").to.equal(first);
        expect(first.scopeSeen).to.equal(scope);
        seen.push(first);
      });
    await Promise.all([request(), request()]);
    expect(seen).to.have.length(2);
    expect(seen[0], "deux requêtes → deux exemplaires").to.not.equal(seen[1]);
  });

  it("lève hors de toute requête, en nommant le service et la cause", () => {
    expect(() => Injector.instantiate(RequestConsumer, "ctx")).to.throw(
      /« RsTenant » \(portée request\).*aucune requête en cours/s,
    );
  });

  it("lève dans une continuation qui reprend après la fin de la requête", async () => {
    let late: (() => unknown) | null = null;
    await inRequest(() => {
      late = AsyncResource.bind(() =>
        Injector.instantiate(RequestConsumer, "ctx"),
      );
    });
    expect(late).to.be.a("function");
    expect(late!).to.throw(/« RsTenant ».*déjà fermé/s);
  });

  it("ne rend pas un singleton HOMONYME posé sur la racine — lecture sur le scope seul", async () => {
    const intruder = { intruder: true };
    root.set("rsTenant", intruder);
    try {
      await inRequest(() => {
        const c = Injector.instantiate<RequestConsumer>(RequestConsumer, "ctx");
        expect(c.tenant, "un exemplaire de la requête").to.be.instanceOf(
          Tenant,
        );
      });
    } finally {
      root.remove("rsTenant");
    }
  });
});

// ─── 2. Nettoyage LIFO à la fermeture ─────────────────────────────────────────
// Débrancher : la boucle de `Scope.clean()` (ou son ordre, ou son try/catch).

class RequestAuditConsumer extends Service {
  static scope = "request";
  constructor(
    readonly context: unknown,
    readonly audit: Audit,
  ) {
    super("rsAuditConsumer", root, false);
  }
}
inject("RsAudit")(RequestAuditConsumer, undefined, 1);

describe("Portée request — nettoyage à la fermeture du scope", () => {
  beforeEach(() => {
    cleanOrder.length = 0;
  });

  it("appelle clean() une fois par service, du dernier créé au premier", async () => {
    let scopeRef: Scope | null = null;
    await inRequest((scope) => {
      scopeRef = scope;
      const c = Injector.instantiate<RequestAuditConsumer>(
        RequestAuditConsumer,
        "ctx",
      );
      expect(c.audit.tenant).to.be.instanceOf(Tenant);
      expect(
        ownedOf(scope),
        "rattachés dans l'ordre de création",
      ).to.have.length(2);
      expect(cleanOrder, "rien de nettoyé pendant la requête").to.deep.equal(
        [],
      );
    });
    expect(cleanOrder, "LIFO : Audit dépend de Tenant").to.deep.equal([
      "rsAudit",
      "rsTenant",
    ]);
    expect(ownedOf(scopeRef!), "tableau rendu").to.equal(null);
    expect(scopeRef!.closed).to.equal(true);
  });

  it("n'alloue rien pour une requête qui ne résout aucun service request", async () => {
    await inRequest((scope) => {
      scope.set("context", { any: true });
      expect(scope.get("context")).to.deep.equal({ any: true });
      expect(ownedOf(scope), "aucun tableau alloué").to.equal(null);
    });
  });

  it("un clean() qui lève est journalisé et n'empêche pas les suivants", async () => {
    logged.length = 0;
    const survivor = {
      cleaned: 0,
      clean() {
        this.cleaned++;
      },
    };
    const faulty = {
      name: "rsFaulty",
      clean() {
        throw new Error("boom-clean");
      },
    };
    await inRequest((scope) => {
      scope.own(survivor);
      scope.own(faulty);
    });
    expect(survivor.cleaned, "le précédent est nettoyé malgré tout").to.equal(
      1,
    );
    const errors = logged.filter((l) => l.severity === "ERROR");
    expect(errors).to.have.length(1);
    expect(String(errors[0].pci)).to.match(/rsFaulty.*boom-clean/);
  });

  it("own() refuse un scope déjà fermé — l'objet ne serait jamais nettoyé", () => {
    const scope = root.enterScope("request");
    root.leaveScope(scope);
    expect(() => scope.own({})).to.throw(/déjà fermé/);
  });
});

// ─── 3. Dépendance captive refusée ────────────────────────────────────────────
// Débrancher : la boucle du détenteur dans `_resolveRequestScoped`.

class Captor extends Service {
  constructor(readonly tenant: Tenant) {
    super("rsCaptor", root, false);
  }
}
inject("RsTenant")(Captor, undefined, 0);
injectable({ name: "RsCaptor" })(Captor);

class TransientBridge extends Service {
  constructor(readonly tenant: Tenant) {
    super("rsBridge", root, false);
  }
}
inject("RsTenant")(TransientBridge, undefined, 0);
injectable({ name: "RsBridge", scope: "transient" })(TransientBridge);

class CaptorThroughTransient extends Service {
  constructor(readonly bridge: TransientBridge) {
    super("rsCaptorT", root, false);
  }
}
inject("RsBridge")(CaptorThroughTransient, undefined, 0);
injectable({ name: "RsCaptorT" })(CaptorThroughTransient);

class SingletonController extends Service {
  static scope = "singleton";
  constructor(
    readonly context: unknown,
    readonly tenant: Tenant,
  ) {
    super("rsSingletonController", root, false);
  }
}
inject("RsTenant")(SingletonController, undefined, 1);

describe("Portée request — dépendance captive refusée", () => {
  it("refuse un singleton qui en dépend, MÊME pendant une requête, en nommant les deux", async () => {
    await inRequest(() => {
      let caught: unknown = null;
      try {
        Injector.instantiate(Captor);
      } catch (e) {
        caught = e;
      }
      expect(
        BootConfigurationError.is(caught),
        "erreur de configuration",
      ).to.equal(true);
      expect((caught as Error).message).to.match(
        /« Captor » \(singleton\) dépend de « RsTenant » \(portée request\)/,
      );
    });
  });

  it("voit le détenteur singleton À TRAVERS une dépendance transient", async () => {
    await inRequest(() => {
      expect(() => Injector.instantiate(CaptorThroughTransient)).to.throw(
        /« CaptorThroughTransient » \(singleton\).*CaptorThroughTransient → TransientBridge → RsTenant/s,
      );
    });
  });

  it("accepte une racine transient : elle appartient à son appelant", async () => {
    await inRequest(() => {
      const bridge = Injector.instantiate<TransientBridge>(TransientBridge);
      expect(bridge.tenant).to.be.instanceOf(Tenant);
    });
  });

  it('refuse un contrôleur @Scope("singleton") — son statique fait foi', async () => {
    await inRequest(() => {
      expect(() => Injector.instantiate(SingletonController, "ctx")).to.throw(
        /« SingletonController » \(singleton\)/,
      );
    });
  });
});

// ─── 4. Au démarrage : déclaration, refus, et captive fatale ─────────────────

// Un module charge le `package.json` de SON dossier à `onPreBoot` : on vise
// l'`index.ts` du cœur, comme un vrai module vise le sien.
const MODULE_PATH = fileURLToPath(new URL("../../index.ts", import.meta.url));
const makeKernel = (): Kernel =>
  new Kernel("development", null, { log: { active: false } });
const firePreBoot = async (k: Kernel) => k.fireLifecycle("onPreBoot", k);

let bootTenants = 0;
class BootTenant extends Service {
  constructor(scope: Scope) {
    super("rsBootTenant", scope, false);
    bootTenants++;
  }
}
injectable({ name: "RsBootTenant", scope: "request" })(BootTenant);

class BootCaptor extends Service {
  constructor(readonly tenant: BootTenant) {
    super("rsBootCaptor", root, false);
  }
}
inject("RsBootTenant")(BootCaptor, undefined, 0);
injectable({ name: "RsBootCaptor" })(BootCaptor);

@services([BootTenant])
class DeclaringModule extends Module {
  constructor(kernel: Kernel) {
    super("@nodefony/rs-declaring", kernel, MODULE_PATH, {});
  }
}

// Optionnel ET en développement : les deux conditions du fail-soft. Une
// captive reste fatale — c'est une faute de déclaration, pas une panne.
@services([BootTenant, BootCaptor])
class CaptiveModule extends Module {
  static override critical = false;
  constructor(kernel: Kernel) {
    super("@nodefony/rs-captive", kernel, MODULE_PATH, {});
  }
}

describe("Portée request — au démarrage", () => {
  it("@services DÉCLARE un service request sans l'instancier", async () => {
    const k = makeKernel();
    await k.addModule(DeclaringModule);
    await firePreBoot(k);
    expect(bootTenants, "aucun exemplaire au démarrage").to.equal(0);
    expect(k.get("rsBootTenant")).to.equal(null);
    expect(k.getBootReport().modulesSkipped).to.have.length(0);
  });

  it("addService() refuse un service request, en disant quoi faire", async () => {
    const k = makeKernel();
    const mod = await k.addModule(DeclaringModule);
    let caught: unknown = null;
    await mod.addService(BootTenant).catch((e: unknown) => (caught = e));
    expect(BootConfigurationError.is(caught)).to.equal(true);
    expect((caught as Error).message).to.match(/@services\(\[\.\.\.\]\)/);
    expect(bootTenants).to.equal(0);
  });

  it("une captive fait ÉCHOUER le boot — en développement, module optionnel compris", async () => {
    const k = makeKernel();
    await k.addModule(CaptiveModule);
    let caught: unknown = null;
    await firePreBoot(k).catch((e: unknown) => (caught = e));
    expect(BootConfigurationError.is(caught), "boot interrompu").to.equal(true);
    expect((caught as Error).message).to.match(
      /« BootCaptor » \(singleton\) dépend de « RsBootTenant »/,
    );
    expect(bootTenants).to.equal(0);
  });
});

// ─── 5. Clé du scope déjà occupée ────────────────────────────────────────────
// Débrancher : le contrôle `instanceof` / `_requestKeyTaken`.

class ContextShadow extends Service {
  constructor(scope: Scope) {
    // Même nom que ce que le pipeline range sur le scope à chaque requête.
    super("context", scope, false);
  }
}
injectable({ name: "RsContextShadow", scope: "request" })(ContextShadow);

class ShadowConsumer extends Service {
  static scope = "request";
  constructor(
    readonly context: unknown,
    readonly shadow: ContextShadow,
  ) {
    super("rsShadowConsumer", root, false);
  }
}
inject("RsContextShadow")(ShadowConsumer, undefined, 1);

describe("Portée request — clé du scope déjà occupée", () => {
  it("refuse d'écraser un objet du pipeline, et le laisse intact", async () => {
    const pipelineContext = { pipeline: true };
    await inRequest((scope) => {
      scope.set("context", pipelineContext);
      expect(() => Injector.instantiate(ShadowConsumer, "ctx")).to.throw(
        /clé « context » .*déjà occupée/,
      );
      expect(scope.get("context")).to.equal(pipelineContext);
    });
  });
});
