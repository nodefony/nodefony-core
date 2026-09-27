import { expect } from "chai";
import Router from "../../service/router.js";

// Un contrôleur singleton dont la création ÉCHOUE (initialize() qui lève :
// base pas encore prête, service distant absent) ne doit pas rester en cache.
// Sinon la promesse rejetée est resservie à chaque requête, et le contrôleur
// est mort jusqu'au redémarrage du process.

class Ctrl {}

function makeRouter(): Router {
  return Object.create(Router.prototype) as Router;
}

describe("Router.getSingletonController — échec de création", () => {
  it("une création rejetée est évincée : la requête suivante recrée", async () => {
    const router = makeRouter();
    let calls = 0;
    const create = () => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error("base pas prête"))
        : Promise.resolve(new Ctrl());
    };
    let failed = false;
    try {
      await router.getSingletonController(Ctrl, create);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    const second = await router.getSingletonController(Ctrl, create);
    expect(second).to.be.instanceOf(Ctrl);
    expect(calls).to.equal(2);
    // Réussie, elle est désormais partagée.
    const third = await router.getSingletonController(Ctrl, create);
    expect(third).to.equal(second);
    expect(calls).to.equal(2);
  });

  it("les appelants concurrents d'une création en cours partagent son échec", async () => {
    const router = makeRouter();
    let calls = 0;
    const create = () => {
      calls++;
      return new Promise<Ctrl>((_, reject) =>
        setTimeout(() => reject(new Error("boom")), 5),
      );
    };
    const results = await Promise.allSettled([
      router.getSingletonController(Ctrl, create),
      router.getSingletonController(Ctrl, create),
    ]);
    expect(results.map((r) => r.status)).to.deep.equal([
      "rejected",
      "rejected",
    ]);
    expect(calls).to.equal(1);
  });
});
