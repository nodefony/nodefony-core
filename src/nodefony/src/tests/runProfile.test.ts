import assert from "node:assert/strict";
import {
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
  runNeedsExternalServices,
  type IRunProfile,
} from "../kernel/Kernel";
import type { IKernel } from "../types/IKernel";
import type { ICliKernel } from "../types/ICliKernel";

/**
 * **Le profil d'exécution est déclaré à TROIS endroits — ils doivent dire la
 * même chose.**
 *
 * `IRunProfile` vit dans `Kernel.ts`, et `types/IKernel.ts` comme
 * `types/ICliKernel.ts` en portent chacun une COPIE écrite à la main. La
 * duplication est imposée par un cycle d'imports (les commentaires de ces
 * fichiers l'expliquent), pas choisie — mais rien ne la gardait alignée, et le
 * typage structurel rend la dérive MUETTE : un objet qui porte un champ de plus
 * reste assignable à un type qui en porte un de moins. Un axe ajouté au
 * canonique restait donc invisible pour qui type son kernel par l'interface
 * publique, sans qu'aucun test ne tombe.
 *
 * Les assertions ci-dessous ferment ce trou à la COMPILATION, dans les deux
 * sens : une copie en retard casse le typecheck du cœur, en nommant le fichier.
 */

// Canonique → miroir : le miroir accepte-t-il tout ce que le canonique porte ?
const _kernelMirrorAcceptsCanonical: IKernel["runProfile"] = {} as IRunProfile;
const _cliMirrorAcceptsCanonical: ICliKernel["runProfile"] = {} as IRunProfile;
// Miroir → canonique : le miroir porte-t-il TOUT ce que le canonique exige ?
const _canonicalAcceptsKernelMirror: IRunProfile = {} as IKernel["runProfile"];
const _canonicalAcceptsCliMirror: IRunProfile = {} as ICliKernel["runProfile"];
void _kernelMirrorAcceptsCanonical;
void _cliMirrorAcceptsCanonical;
void _canonicalAcceptsKernelMirror;
void _canonicalAcceptsCliMirror;

describe("IRunProfile — le profil par défaut", () => {
  it("un run qui n'a rien déclaré n'ouvre AUCUNE connexion", () => {
    assert.equal(CONSOLE_RUN_PROFILE.externalServices, false);
  });

  it("le profil des commandes de données déclare le besoin, et rien d'autre", () => {
    assert.equal(CONSOLE_DATA_RUN_PROFILE.externalServices, true);
    // Il ne doit pas ouvrir de port au passage : c'est un profil CONSOLE.
    assert.equal(CONSOLE_DATA_RUN_PROFILE.servers, false);
    assert.equal(CONSOLE_DATA_RUN_PROFILE.lifetime, "oneshot");
  });

  it("les deux profils sont gelés — personne ne mute une déclaration partagée", () => {
    assert.ok(Object.isFrozen(CONSOLE_RUN_PROFILE));
    assert.ok(Object.isFrozen(CONSOLE_DATA_RUN_PROFILE));
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
    const bidon = { runProfile: { externalServices: "true" } };
    assert.equal(
      runNeedsExternalServices(bidon as unknown as { runProfile: IRunProfile }),
      false,
    );
  });
});
