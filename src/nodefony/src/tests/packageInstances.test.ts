import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";

import {
  registerPackageInstance,
  listPackageInstances,
  isPackageDuplicated,
  packageDualityReport,
} from "../runtime/packageInstances";
import Kernel from "../kernel/Kernel";
import { BootConfigurationError } from "../kernel/BootConfigurationError";
import { Nodefony } from "../Nodefony";

/**
 * SPEC — « deux copies du paquet `nodefony` dans un process se DÉTECTENT, et le
 * verdict diffère selon l'environnement ».
 *
 * Pourquoi la détection ne peut PAS porter sur le descripteur de configuration
 * (ce qu'elle faisait avant) : la marque de `defineConfig` vit dans le registre
 * global de symboles, donc les deux copies posent LE MÊME symbole et un
 * descripteur venu d'ailleurs est indiscernable d'un descripteur local. La
 * garde qui s'appuyait dessus cessait de mordre dès que les deux copies étaient
 * à jour — l'inverse du comportement attendu d'un correctif.
 *
 * Mesuré sous dualité réelle sur ce dépôt (deux copies physiques du paquet,
 * `NF_CLI_DELEGATED=1`) : 11 modules chargés sur 17, 5 écartés en fail-soft,
 * dont `@nodefony/http` (aucun serveur) et `@nodefony/security` (aucun
 * pare-feu) — et pas une ligne pour le dire.
 */

/** Le registre vit sur `globalThis` : le vider entre deux tests, sinon ils se contaminent. */
const CLÉ = Symbol.for("nodefony.packageInstances");
type PorteeRegistre = typeof globalThis & { [CLÉ]?: unknown[] };

/** Copies réellement inscrites par le chargement du module — à restaurer. */
let inscritesInitialement: unknown[] | undefined;

beforeEach(() => {
  inscritesInitialement = (globalThis as PorteeRegistre)[CLÉ];
  delete (globalThis as PorteeRegistre)[CLÉ];
});

afterEach(() => {
  if (inscritesInitialement === undefined)
    delete (globalThis as PorteeRegistre)[CLÉ];
  else (globalThis as PorteeRegistre)[CLÉ] = inscritesInitialement;
});

describe("registre des copies du paquet — compter, pas deviner", () => {
  it("le module s'inscrit tout seul au chargement", () => {
    // Test du décor réel, hors purge : `Nodefony.ts` s'inscrit à son évaluation.
    // Sans cela, tout le reste mesurerait un registre que personne n'alimente.
    expect(inscritesInitialement, "Nodefony.ts ne s'est pas inscrit").to.be.an(
      "array",
    );
    expect((inscritesInitialement as unknown[]).length).to.be.greaterThan(0);
    expect(Nodefony.version).to.be.a("string");
  });

  it("une seule copie → aucune dualité, aucun rapport", () => {
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    expect(listPackageInstances()).to.have.lengthOf(1);
    expect(isPackageDuplicated()).to.equal(false);
    expect(packageDualityReport()).to.equal(null);
  });

  it("deux copies → dualité détectée, et le rapport NOMME les deux chemins", () => {
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    registerPackageInstance("file:///b/dist/Nodefony.js", "9.9.9");
    expect(isPackageDuplicated()).to.equal(true);
    const rapport = packageDualityReport();
    // Nommer les chemins est la seule information qui permette d'AGIR : sans
    // eux, le lecteur sait qu'il a un problème mais pas lequel de ses deux
    // `nodefony` s'exécute.
    expect(rapport).to.contain("file:///a/dist/Nodefony.js");
    expect(rapport).to.contain("file:///b/dist/Nodefony.js");
    expect(rapport).to.contain("10.0.0");
    expect(rapport).to.contain("9.9.9");
  });

  it("la même URL réenregistrée ne compte pas pour deux", () => {
    // Un module réévalué (rechargement de test, deux spécificateurs qui
    // résolvent au même fichier) inventerait sinon une dualité qui n'existe pas
    // — un faux positif REFUSERAIT un boot de production parfaitement sain.
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    expect(listPackageInstances()).to.have.lengthOf(1);
    expect(isPackageDuplicated()).to.equal(false);
  });
});

describe("verdict du Kernel — avertir en dev, REFUSER en production", () => {
  /** Accès à la méthode privée, comme `configBoot.test.ts` le fait déjà. */
  type AvecGarde = { assertSinglePackageInstance: () => void };

  /** Kernel réel, journal coupé ; `new Kernel` écrase le singleton → restauré. */
  function kernelDe(env: "development" | "production"): Kernel {
    return new Kernel(env, null, { log: { active: false } });
  }

  let singletonSauvé: Kernel | null = null;
  let nodeEnvSauvé: string | undefined;
  beforeEach(() => {
    singletonSauvé = Nodefony.getKernel();
    nodeEnvSauvé = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (singletonSauvé) Nodefony.setKernel(singletonSauvé);
    if (nodeEnvSauvé === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvSauvé;
  });

  /**
   * Pose le mode runtime pour de vrai. `Kernel.resolveRuntimeEnv` lit
   * `NODE_ENV` AVANT l'environnement passé au constructeur — sous vitest il
   * vaut `test`, qui collapse en `production`. Un `new Kernel("development")`
   * seul mesurerait donc le régime inverse de celui qu'on croit éprouver.
   */
  function avecNodeEnv(v: string): void {
    process.env.NODE_ENV = v;
  }

  it("une seule copie → le boot n'est pas dérangé, dans les DEUX environnements", () => {
    registerPackageInstance("file:///seule/dist/Nodefony.js", "10.0.0");
    for (const env of ["development", "production"] as const) {
      avecNodeEnv(env);
      const k = kernelDe(env);
      expect(
        () => (k as unknown as AvecGarde).assertSinglePackageInstance(),
        `un boot sain doit passer en ${env}`,
      ).to.not.throw();
    }
  });

  it("deux copies en DÉVELOPPEMENT → l'application démarre (avertissement seul)", () => {
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    registerPackageInstance("file:///b/dist/Nodefony.js", "10.0.0");
    avecNodeEnv("development");
    const k = kernelDe("development");
    const dits: string[] = [];
    (k as unknown as { log: (m: unknown, s?: string) => void }).log = (
      m,
      s,
    ) => {
      dits.push(`${s ?? ""} ${String(m)}`);
    };
    expect(() =>
      (k as unknown as AvecGarde).assertSinglePackageInstance(),
    ).to.not.throw();
    const averti = dits.join("\n");
    expect(averti, "la dualité doit être DITE").to.contain("2 copies");
    expect(averti).to.contain("WARNING");
    expect(averti).to.contain("file:///b/dist/Nodefony.js");
  });

  it("deux copies en PRODUCTION → boot REFUSÉ, et l'erreur nomme les copies", () => {
    // Ce qui tombe en silence sous dualité est exactement ce dont dépend la
    // sécurité : `@nodefony/security` écarté = application servie sans
    // pare-feu. En production, personne ne lit les avertissements.
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    registerPackageInstance("file:///b/dist/Nodefony.js", "10.0.0");
    avecNodeEnv("production");
    const k = kernelDe("production");
    let levée: unknown = null;
    try {
      (k as unknown as AvecGarde).assertSinglePackageInstance();
    } catch (e) {
      levée = e;
    }
    expect(levée, "la production doit REFUSER de démarrer").to.not.equal(null);
    expect(
      BootConfigurationError.is(levée),
      "une erreur de configuration est fatale dans tous les environnements",
    ).to.equal(true);
    const dit = (levée as Error).message;
    expect(dit).to.contain("Démarrage refusé");
    expect(
      dit,
      "le message nomme le mode CONSTATÉ, jamais un mode supposé",
    ).to.contain("mode runtime `production` (NODE_ENV=production)");
    expect(dit).to.contain("file:///a/dist/Nodefony.js");
    expect(dit).to.contain("file:///b/dist/Nodefony.js");
  });
});

/**
 * 🔴 CE QUI MANQUAIT — les tests ci-dessus appellent la garde DIRECTEMENT :
 * retirer ses points d'appel dans le Kernel les laisserait tous verts. Un gate
 * qu'on peut débrancher sans qu'un test tombe ne garde rien. Ces deux-ci
 * gardent le CÂBLAGE : ils passent par les méthodes du cycle de vie.
 */
describe("câblage — la garde est réellement CONSULTÉE pendant le boot", () => {
  let singletonSauvé: Kernel | null = null;
  let nodeEnvSauvé: string | undefined;
  beforeEach(() => {
    singletonSauvé = Nodefony.getKernel();
    nodeEnvSauvé = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (singletonSauvé) Nodefony.setKernel(singletonSauvé);
    if (nodeEnvSauvé === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvSauvé;
  });

  it("preRegister() REFUSE quand une copie est apparue avec les modules", async () => {
    // Le second point de contrôle existe pour ce cas précis : les modules du
    // manifeste sont chargés par un `once("onPreRegister")`, donc APRÈS le
    // contrôle de `loadApp`. Une copie apportée par un module — deux versions
    // dans l'arbre npm, monorepo — n'apparaît qu'ici. Débrancher l'appel dans
    // `preRegister` fait tomber ce test, et lui seul.
    registerPackageInstance("file:///app/dist/Nodefony.js", "10.0.0");
    registerPackageInstance(
      "file:///un-module/node_modules/nodefony/Nodefony.js",
      "9.0.0",
    );
    process.env.NODE_ENV = "production";
    const k = new Kernel("production", null, { log: { active: false } });
    let levée: unknown = null;
    try {
      await k.preRegister();
    } catch (e) {
      levée = e;
    }
    expect(
      BootConfigurationError.is(levée),
      "un module qui apporte une seconde copie doit être refusé, pas ignoré",
    ).to.equal(true);
    expect((levée as Error).message).to.contain("un-module");
  });

  it("le verdict ne se répète pas quand rien n'a changé entre les deux points", () => {
    // Deux points de contrôle, une seule dualité : en développement, le même
    // avertissement émis deux fois cesse d'être lu.
    registerPackageInstance("file:///a/dist/Nodefony.js", "10.0.0");
    registerPackageInstance("file:///b/dist/Nodefony.js", "10.0.0");
    process.env.NODE_ENV = "development";
    const k = new Kernel("development", null, { log: { active: false } });
    const dits: string[] = [];
    (k as unknown as { log: (m: unknown, s?: string) => void }).log = (m) => {
      dits.push(String(m));
    };
    const garde = (k as unknown as { assertSinglePackageInstance: () => void })
      .assertSinglePackageInstance;
    garde.call(k);
    garde.call(k);
    expect(dits.filter((d) => d.includes("copies du paquet"))).to.have.lengthOf(
      1,
    );
  });
});
