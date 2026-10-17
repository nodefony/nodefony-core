import assert from "node:assert/strict";
import {
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
  CONSOLE_SCHEMA_RUN_PROFILE,
  runNeedsExternalServices,
  runWorksOnSchema,
  storeConnectivity,
  runWillServeTraffic,
  type IRunProfile,
} from "../kernel/runProfile";
import * as fromKernel from "../kernel/Kernel";
import * as fromBarrel from "../index";
import type { IKernel } from "../types/IKernel";
import type { ICliKernel } from "../types/ICliKernel";
import type { ICommand } from "../types/ICommand";

/**
 * **Le profil d'exécution a UNE source : `kernel/runProfile.ts`.**
 *
 * `types/IKernel.ts`, `types/ICliKernel.ts` et `types/ICommand.ts` en portaient
 * chacun une COPIE écrite à la main, imposée par le cycle d'imports
 * `Kernel → Service → IService → IKernel → Kernel` — et le typage structurel
 * rendait leur dérive MUETTE (un axe ajouté au canonique restait invisible pour
 * qui type son kernel par l'interface publique). Le module feuille supprime le
 * cycle : les trois fichiers de types importent désormais le type canonique.
 *
 * Les assertions ci-dessous ferment ce trou à la COMPILATION, par IDENTITÉ de
 * type (pas une simple assignabilité) : réintroduire un miroir qui diverge
 * casse le typecheck du cœur en nommant le fichier.
 */
type Same<A, B> =
  // Idiome d'égalité STRICTE de types : `T` n'y sert qu'une fois PAR CONSTRUCTION
  // — c'est le report de son évaluation qui distingue `A` de `B` au lieu de
  // comparer leur seule assignabilité. La règle ne voit pas cette intention.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const _kernelProfileIsCanonical: Same<IKernel["runProfile"], IRunProfile> =
  true;
const _cliProfileIsCanonical: Same<ICliKernel["runProfile"], IRunProfile> =
  true;
const _commandLifetimeIsCanonical: Same<
  ICommand["lifetime"],
  IRunProfile["lifetime"]
> = true;
void _kernelProfileIsCanonical;
void _cliProfileIsCanonical;
void _commandLifetimeIsCanonical;

describe("IRunProfile — les profils déclarés", () => {
  it("un run qui n'a rien déclaré n'ouvre AUCUNE connexion ni aucun port", () => {
    assert.equal(CONSOLE_RUN_PROFILE.servers, false);
    assert.equal(CONSOLE_RUN_PROFILE.lifetime, "oneshot");
    assert.equal(CONSOLE_RUN_PROFILE.interactive, false);
    assert.equal(CONSOLE_RUN_PROFILE.externalServices, false);
    // L'axe optionnel n'est pas posé : « ne rien dire » n'est pas « dire faux ».
    assert.equal("schemaWork" in CONSOLE_RUN_PROFILE, false);
  });

  it("le profil des commandes de données déclare le besoin, et rien d'autre", () => {
    assert.equal(CONSOLE_DATA_RUN_PROFILE.externalServices, true);
    // Il ne doit pas ouvrir de port au passage : c'est un profil CONSOLE.
    assert.equal(CONSOLE_DATA_RUN_PROFILE.servers, false);
    assert.equal(CONSOLE_DATA_RUN_PROFILE.lifetime, "oneshot");
    assert.equal("schemaWork" in CONSOLE_DATA_RUN_PROFILE, false);
  });

  it("le profil de travail du schéma est un profil de données qui le DIT", () => {
    assert.equal(CONSOLE_SCHEMA_RUN_PROFILE.externalServices, true);
    assert.equal(CONSOLE_SCHEMA_RUN_PROFILE.schemaWork, true);
    assert.equal(CONSOLE_SCHEMA_RUN_PROFILE.servers, false);
    assert.equal(CONSOLE_SCHEMA_RUN_PROFILE.lifetime, "oneshot");
  });

  it("les trois profils sont gelés — personne ne mute une déclaration partagée", () => {
    assert.ok(Object.isFrozen(CONSOLE_RUN_PROFILE));
    assert.ok(Object.isFrozen(CONSOLE_DATA_RUN_PROFILE));
    assert.ok(Object.isFrozen(CONSOLE_SCHEMA_RUN_PROFILE));
  });
});

describe("runNeedsExternalServices — point d'appel unique de la question", () => {
  it("répond `true` sur un profil qui le déclare", () => {
    assert.equal(
      runNeedsExternalServices({ runProfile: CONSOLE_DATA_RUN_PROFILE }),
      true,
    );
  });

  it("répond `false` sur le profil console", () => {
    assert.equal(
      runNeedsExternalServices({ runProfile: CONSOLE_RUN_PROFILE }),
      false,
    );
  });

  it("répond `false` sans kernel, et sans profil encore posé", () => {
    assert.equal(runNeedsExternalServices(null), false);
    assert.equal(runNeedsExternalServices(undefined), false);
    assert.equal(runNeedsExternalServices({}), false);
    assert.equal(runNeedsExternalServices({ runProfile: null }), false);
  });

  it("n'accepte QUE `true` — pas une valeur qui lui ressemble", () => {
    // Une config lue d'un fichier peut rendre "true" ou 1 ; les traiter comme
    // vrai ouvrirait une connexion sur une valeur que personne n'a écrite.
    const lookalike = { runProfile: { externalServices: "true" } };
    assert.equal(
      runNeedsExternalServices(
        lookalike as unknown as { runProfile: IRunProfile },
      ),
      false,
    );
  });
});

describe("runWorksOnSchema — seule la famille orm:* le déclare", () => {
  it("répond `true` sur le profil de travail du schéma, `false` sur les autres", () => {
    assert.equal(
      runWorksOnSchema({ runProfile: CONSOLE_SCHEMA_RUN_PROFILE }),
      true,
    );
    assert.equal(
      runWorksOnSchema({ runProfile: CONSOLE_DATA_RUN_PROFILE }),
      false,
    );
    assert.equal(runWorksOnSchema({ runProfile: CONSOLE_RUN_PROFILE }), false);
  });

  it("répond `false` sans kernel, sans profil, ou sur une valeur qui ressemble à `true`", () => {
    assert.equal(runWorksOnSchema(null), false);
    assert.equal(runWorksOnSchema(undefined), false);
    assert.equal(runWorksOnSchema({ runProfile: null }), false);
    const lookalike = {
      runProfile: { ...CONSOLE_DATA_RUN_PROFILE, schemaWork: 1 },
    };
    assert.equal(
      runWorksOnSchema(lookalike as unknown as { runProfile: IRunProfile }),
      false,
    );
  });
});

describe("storeConnectivity — le verdict des stores `auto`, avec sa cause", () => {
  it("refuse sans connexion déclarée, et dit pourquoi", () => {
    assert.deepEqual(storeConnectivity({ runProfile: CONSOLE_RUN_PROFILE }), {
      allowed: false,
      cause: "no-external-services",
    });
    assert.deepEqual(storeConnectivity(null), {
      allowed: false,
      cause: "no-external-services",
    });
  });

  it("autorise un run de données", () => {
    assert.deepEqual(
      storeConnectivity({ runProfile: CONSOLE_DATA_RUN_PROFILE }),
      {
        allowed: true,
      },
    );
  });

  it("refuse un run qui travaille le schéma — connecté, mais aux tables pas encore écrites", () => {
    assert.deepEqual(
      storeConnectivity({ runProfile: CONSOLE_SCHEMA_RUN_PROFILE }),
      { allowed: false, cause: "schema-work" },
    );
  });
});

describe("runWillServeTraffic — l'intention de la commande complète le profil", () => {
  it("une commande sans intention déclarée, sous profil console, ne sert pas", () => {
    assert.equal(runWillServeTraffic(CONSOLE_RUN_PROFILE, {}), false);
  });

  it("n'accepte QUE `true` pour l'intention — pas une valeur qui lui ressemble", () => {
    const lookalike = { servesTraffic: "true" };
    assert.equal(
      runWillServeTraffic(
        CONSOLE_RUN_PROFILE,
        lookalike as unknown as { servesTraffic?: boolean },
      ),
      false,
    );
  });
});

describe("surface publique — une seule implémentation, ré-exportée à l'identique", () => {
  it("`Kernel.ts` ré-exporte les MÊMES références que le module feuille", () => {
    assert.equal(fromKernel.CONSOLE_RUN_PROFILE, CONSOLE_RUN_PROFILE);
    assert.equal(fromKernel.CONSOLE_DATA_RUN_PROFILE, CONSOLE_DATA_RUN_PROFILE);
    assert.equal(
      fromKernel.CONSOLE_SCHEMA_RUN_PROFILE,
      CONSOLE_SCHEMA_RUN_PROFILE,
    );
    assert.equal(fromKernel.runNeedsExternalServices, runNeedsExternalServices);
    assert.equal(fromKernel.runWorksOnSchema, runWorksOnSchema);
    assert.equal(fromKernel.storeConnectivity, storeConnectivity);
    assert.equal(fromKernel.runWillServeTraffic, runWillServeTraffic);
  });

  it("le barrel `nodefony` expose les MÊMES références", () => {
    assert.equal(fromBarrel.CONSOLE_RUN_PROFILE, CONSOLE_RUN_PROFILE);
    assert.equal(fromBarrel.CONSOLE_DATA_RUN_PROFILE, CONSOLE_DATA_RUN_PROFILE);
    assert.equal(
      fromBarrel.CONSOLE_SCHEMA_RUN_PROFILE,
      CONSOLE_SCHEMA_RUN_PROFILE,
    );
    assert.equal(fromBarrel.runNeedsExternalServices, runNeedsExternalServices);
    assert.equal(fromBarrel.runWorksOnSchema, runWorksOnSchema);
    assert.equal(fromBarrel.storeConnectivity, storeConnectivity);
  });
});
