/**
 * Contrat de RETOUR de `Router.getSingletonController` (#505, L2).
 *
 * Pendant la création, le cache tient la PROMESSE (anti-course : N requêtes
 * concurrentes partagent le même travail). Une fois l'instance prête, elle
 * REMPLACE la promesse : chaque requête suivante la reçoit DIRECTEMENT, au lieu
 * d'attendre une promesse déjà tenue — une suspension de moins par requête.
 *
 * Ce que ces cas fixent, c'est la FORME du retour (instance ou promesse) à
 * chaque moment de la vie du cache, et le nombre d'appels à la fabrique.
 * L'éviction après échec a son fichier (`singletonEviction.test.ts`).
 *
 * Débrancher : ne plus remplacer la promesse par l'instance une fois tenue —
 * le cas « instance rendue directement » rougit.
 */
import { expect } from "chai";
import { isPromise } from "nodefony";
import Router from "../../service/router.js";

class Ctrl {}

function makeRouter(): Router {
  return Object.create(Router.prototype) as Router;
}

describe("Router.getSingletonController — instance ou promesse", () => {
  it("création asynchrone tenue → les appels suivants rendent l'INSTANCE, sans promesse", async () => {
    const router = makeRouter();
    let calls = 0;
    const create = () => {
      calls++;
      return Promise.resolve(new Ctrl());
    };
    const first = router.getSingletonController(Ctrl, create);
    expect(isPromise(first), "la création est en cours : une promesse").to.be
      .true;
    const instance = await first;
    const next = router.getSingletonController(Ctrl, create);
    expect(isPromise(next), "l'instance est prête : plus de promesse").to.be
      .false;
    expect(next).to.equal(instance);
    expect(calls).to.equal(1);
  });

  it("création en cours → les appelants concurrents reçoivent la MÊME promesse", async () => {
    const router = makeRouter();
    let calls = 0;
    let release!: (ctrl: Ctrl) => void;
    const create = () => {
      calls++;
      return new Promise<Ctrl>((resolve) => (release = resolve));
    };
    const a = router.getSingletonController(Ctrl, create);
    const b = router.getSingletonController(Ctrl, create);
    expect(a).to.equal(b);
    expect(calls, "une seule création pour deux requêtes").to.equal(1);
    const ctrl = new Ctrl();
    release(ctrl);
    expect(await a).to.equal(ctrl);
    expect(await b).to.equal(ctrl);
  });

  it("création synchrone → instance rendue tout de suite, puis partagée", () => {
    const router = makeRouter();
    let calls = 0;
    const create = () => {
      calls++;
      return new Ctrl();
    };
    const first = router.getSingletonController(Ctrl, create);
    expect(first).to.be.instanceOf(Ctrl);
    expect(router.getSingletonController(Ctrl, create)).to.equal(first);
    expect(calls).to.equal(1);
  });

  it("création qui lève de façon synchrone → exception SYNCHRONE, rien en cache", () => {
    const router = makeRouter();
    let calls = 0;
    const boom = new Error("constructeur en échec");
    const create = (): Ctrl => {
      calls++;
      if (calls === 1) throw boom;
      return new Ctrl();
    };
    expect(() => router.getSingletonController(Ctrl, create)).to.throw(boom);
    // Rien n'a été mis en cache : la requête suivante recrée.
    expect(router.getSingletonController(Ctrl, create)).to.be.instanceOf(Ctrl);
    expect(calls).to.equal(2);
  });
});
