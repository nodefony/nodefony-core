/* eslint-disable @typescript-eslint/no-explicit-any */
//
// ─── RED-TEAM — brique « boot des services » (@services / addService) ─────────
//
// Matrice conçue depuis l'ARCHITECTURE, pas depuis l'implémentation.
//
// Actifs   : l'INTÉGRITÉ du boot (un service critique manquant) · le VERDICT de
//            santé (UP vs DÉGRADÉ, via le BootReport) · la production.
// Chemins  : `@services([Ctor])` (le chemin de TOUS les modules) · `addService`.
//
// L'invariant à prouver est la règle du projet — « résilience SANS dégradation
// silencieuse » : fail-soft sur la DISPONIBILITÉ, fail-LOUD sur la DÉGRADATION,
// et tout repli ANNONCÉ. Un service qu'on ne peut pas CONSTRUIRE doit donc suivre
// exactement la même politique que celui qu'on ne peut pas INITIALISER
// (`guardServiceInitialize` → `isBootErrorFatal`) : fatal en production,
// fail-soft AGRÉGÉ AU BOOTREPORT ailleurs.
//
// Vécu qui motive la matrice : en déplaçant `HttpKernel` de 3 lignes dans le
// `@services([...])` de @nodefony/http, le serveur démarre « UP », ports à
// l'écoute, et rend 499 « sessionService not found » sur CHAQUE requête — sans
// jamais se déclarer dégradé.
//
import "reflect-metadata";
import assert from "node:assert";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import { services } from "../kernel/decorators/kernelDecorator";

const makeKernel = (env: "development" | "production"): Kernel =>
  new Kernel(env, null, { log: { active: false } });

// Un Module charge le `package.json` de SON dossier à `onPreBoot` : le path doit
// donc désigner un fichier dont le dossier en contient un (sinon ENOENT → le
// module est skippé pour une raison étrangère à ce qu'on teste). On vise
// l'`index.ts` du core, comme un vrai module vise le sien.
const MODULE_PATH = new URL("../../index.ts", import.meta.url).pathname;

/** Service dont la CONSTRUCTION échoue — le cas réel : une dépendance absente. */
class BrokenService extends Service {
  constructor(module: Module) {
    super("brokenService", module.container as Container);
    throw new Error("boom: dépendance absente à la construction");
  }
}

/** Service sain — contrôle positif. */
class HealthyService extends Service {
  constructor(module: Module) {
    super("healthyService", module.container as Container);
  }
}

@services([BrokenService])
class BrokenModule extends Module {
  constructor(kernel: Kernel) {
    super("@nodefony/broken", kernel, MODULE_PATH);
  }
}

@services([BrokenService])
class NonCriticalBrokenModule extends Module {
  static override critical = false;
  constructor(kernel: Kernel) {
    super("@nodefony/broken-soft", kernel, MODULE_PATH);
  }
}

@services([HealthyService])
class HealthyModule extends Module {
  constructor(kernel: Kernel) {
    super("@nodefony/healthy", kernel, MODULE_PATH);
  }
}

/** Déclenche la phase où `@services` instancie (`onPreBoot`). */
const firePreBoot = async (k: Kernel) => k.fireLifecycle("onPreBoot", k);

describe("RED-TEAM @services — intégrité du boot", () => {
  it("F0 — CONTRÔLE POSITIF : un service sain → boot nominal, 0 module ignoré", async () => {
    const k = makeKernel("development");
    await k.addModule(HealthyModule);
    await firePreBoot(k);

    assert.ok(
      k.get("healthyService"),
      "le service sain doit être au container",
    );
    assert.strictEqual(
      k.getBootReport().modulesSkipped.length,
      0,
      `un boot nominal ne signale aucun module ignoré — reçu: ${JSON.stringify(
        k.getBootReport().modulesSkipped,
      )}`,
    );
  });

  it("F1 — PRODUCTION + module critical : une construction qui échoue doit être FATALE", async () => {
    const k = makeKernel("production");
    await k.addModule(BrokenModule);

    // Fatal = l'échec REMONTE (le boot s'interrompt), il n'est pas collecté en
    // « erreur non bloquante ». Sinon le pod démarre amputé et se déclare sain.
    await assert.rejects(
      () => firePreBoot(k),
      /boom/,
      "en production, un service critique impossible à CONSTRUIRE doit interrompre le boot",
    );
  });

  it("F2 — DEV + module critical : fail-soft, mais ANNONCÉ au BootReport", async () => {
    const k = makeKernel("development");
    await k.addModule(BrokenModule);
    await firePreBoot(k);

    const report = k.getBootReport();
    assert.strictEqual(
      report.modulesSkipped.length,
      1,
      "un service sauté doit être AGRÉGÉ au BootReport — c'est ce qui fait dire " +
        "« boot DÉGRADÉ » au superviseur au lieu de « UP »",
    );
    assert.match(report.modulesSkipped[0].reason, /boom/);
  });

  it("F3 — le service dont la construction échoue ne doit PAS être au container", async () => {
    const k = makeKernel("development");
    await k.addModule(BrokenModule);
    await firePreBoot(k);

    assert.ok(
      !k.get("brokenService"),
      "une demi-instance au container serait pire que l'absence",
    );
  });

  it("F5 — le message d'erreur doit être ACTIONNABLE : qui manque, qui le demande, quoi faire", async () => {
    // Le vécu : déplacer HttpKernel dans @services([...]) produisait
    // « Cannot read properties of undefined (reading 'container') » — un message
    // qui ne nomme ni le service manquant, ni son demandeur, ni le remède.
    const { default: Injector } = await import("../kernel/injector/injector");
    const { injectable } = await import("../kernel/decorators/kernelDecorator");

    @injectable()
    class NeedsItsModule extends Service {
      constructor(module: Module) {
        // Résolu comme DÉPENDANCE → aucun argument → `module` est undefined.
        super("needsItsModule", module.container as Container);
      }
    }
    class Consumer extends Service {
      constructor(dep: NeedsItsModule) {
        super("consumer", new Container());
        void dep;
      }
    }
    Reflect.defineMetadata("design:paramtypes", [NeedsItsModule], Consumer);

    try {
      assert.throws(
        () => Injector.instantiate(Consumer as any),
        (e: Error) => {
          assert.match(e.message, /NeedsItsModule/, "doit nommer le service");
          assert.match(e.message, /Consumer/, "doit nommer le demandeur");
          assert.match(
            e.message,
            /@services\(\[/,
            "doit pointer le remède (l'ordre de @services)",
          );
          assert.ok(e.cause, "doit chaîner la cause d'origine");
          return true;
        },
      );
    } finally {
      delete (Injector.injectables as any)["NeedsItsModule"];
    }
  });

  it("F4 — module critical=false : fail-soft ANNONCÉ même en production", async () => {
    const k = makeKernel("production");
    await k.addModule(NonCriticalBrokenModule);

    const r = await firePreBoot(k);
    assert.strictEqual(
      r.errors.length,
      0,
      "un module explicitement non critique ne doit pas tuer le boot",
    );
    assert.strictEqual(
      k.getBootReport().modulesSkipped.length,
      1,
      "…mais son échec reste ANNONCÉ (jamais un skip silencieux)",
    );
  });
});
