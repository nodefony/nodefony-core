//
// ─── Contrôleur captif refusé AU DÉMARRAGE (#485) ────────────────────────────
//
// Un contrôleur n'est construit qu'à sa première requête. Sans analyse au
// boot, un `@Scope("singleton")` qui réclame un service de portée `request`
// démarrerait vert, puis rendrait 500 à la première requête qui l'atteint —
// ou pire, garderait l'exemplaire de cette requête pour toutes les suivantes.
// `@controllers` fait lire son graphe de dépendances déclarées par
// `Injector.assertNoCaptiveDependency` à l'enregistrement : la faute arrête
// le démarrage, en `BootConfigurationError`, même pour un module optionnel.
//
// Débrancher : l'appel `Injector.assertNoCaptiveDependency` dans
// `initDecoratorControllers` (routerDecorators.ts).
//
import { expect } from "chai";
import { fileURLToPath } from "node:url";
import {
  BootConfigurationError,
  Kernel,
  Module,
  Service,
  inject,
  injectable,
} from "nodefony";
import type { Scope } from "nodefony";
import type { ContextType } from "@nodefony/http";
import Controller from "../../src/Controller.js";
import {
  controllers,
  Scope as ControllerLifetime,
} from "../../decorators/routerDecorators.js";

// Un module charge le `package.json` de SON dossier au démarrage : on vise
// l'`index.ts` du paquet, comme un vrai module vise le sien.
const MODULE_PATH = fileURLToPath(
  new URL("../../../index.ts", import.meta.url),
);

class FwTenant extends Service {
  constructor(scope: Scope) {
    super("fwTenant", scope, false);
  }
}
injectable({ name: "FwTenant", scope: "request" })(FwTenant);

/** Singleton par `@Scope` : la captive. */
class CaptiveController extends Controller {
  constructor(
    context: ContextType,
    readonly tenant: FwTenant,
  ) {
    super("CaptiveController", context);
  }
}
ControllerLifetime("singleton")(CaptiveController);
inject("FwTenant")(CaptiveController, undefined, 1);

/** Portée par requête (le défaut) : il PEUT recevoir un service request. */
class RequestController extends Controller {
  constructor(
    context: ContextType,
    readonly tenant: FwTenant,
  ) {
    super("RequestController", context);
  }
}
inject("FwTenant")(RequestController, undefined, 1);

@controllers([CaptiveController])
class CaptiveModule extends Module {
  static override critical = false;
  constructor(kernel: Kernel) {
    super("@nodefony/fw-captive", kernel, MODULE_PATH, {});
  }
}

@controllers([RequestController])
class HealthyModule extends Module {
  constructor(kernel: Kernel) {
    super("@nodefony/fw-healthy", kernel, MODULE_PATH, {});
  }
}

const makeKernel = (): Kernel =>
  new Kernel("development", null, { log: { active: false } });

describe("@controllers — dépendance captive refusée au démarrage", () => {
  it("CONTRÔLE POSITIF : un contrôleur par requête qui injecte un service request démarre", async () => {
    const k = makeKernel();
    await k.addModule(HealthyModule);
    await k.fireLifecycle("onBoot", k);
    expect(k.getBootReport().modulesSkipped).to.have.length(0);
  });

  it('un contrôleur @Scope("singleton") qui en injecte un fait ÉCHOUER le démarrage — module optionnel et développement compris', async () => {
    const k = makeKernel();
    await k.addModule(CaptiveModule);
    let caught: unknown = null;
    await k.fireLifecycle("onBoot", k).catch((e: unknown) => (caught = e));
    expect(BootConfigurationError.is(caught), "boot interrompu").to.equal(true);
    expect((caught as Error).message).to.match(
      /« CaptiveController » \(singleton\) dépend de « FwTenant » \(portée request\)/,
    );
  });
});
