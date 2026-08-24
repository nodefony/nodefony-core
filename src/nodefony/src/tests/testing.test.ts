import { describe, it } from "vitest";
import { assert } from "chai";
import { inject, injectable } from "../kernel/decorators/kernelDecorator";
import Service from "../Service";
import Container from "../Container";
import type Module from "../kernel/Module";
import { createTestModule } from "../testing/index";

/**
 * La porte de test publiée (`nodefony/testing`).
 *
 * Ce qui est éprouvé ici n'est pas « la fonction rend un objet », mais la seule
 * chose qui justifie de publier ce sous-chemin : **un service se construit
 * dessus et sa logique s'éprouve, sans démarrer quoi que ce soit**. Sans cette
 * porte, un développeur écrit un test de bout en bout — il lance le serveur et
 * tape en HTTP — pour vérifier un calcul.
 */

/** Un service comme en écrirait un utilisateur (ce que `create service` rend). */
@injectable()
class TaxService extends Service {
  constructor(module: Module) {
    super("tax", module.container as Container, module.notificationsCenter);
  }
  rate(): number {
    return 0.2;
  }
  on100(): number {
    return 100 * this.rate();
  }
}

/** Un second service qui dépend du premier — le cas de la tâche mesurée. */
@injectable()
class InvoiceService extends Service {
  constructor(
    module: Module,
    // La forme que `create service --inject` écrit : le décorateur nomme la
    // CLASSE, le conteneur la réconcilie avec la clé d'instance.
    @inject("TaxService") private readonly tax: TaxService,
  ) {
    super("invoice", module.container as Container, module.notificationsCenter);
  }
  total(ht: number): number {
    return ht + ht * this.tax.rate();
  }
}

describe("nodefony/testing — éprouver un service SEUL", () => {
  it("un service se construit et sa logique répond, sans kernel ni port", () => {
    const service = new TaxService(createTestModule());
    assert.equal(service.rate(), 0.2);
    assert.equal(service.on100(), 20);
  });

  it("une dépendance s'INJECTE à la main — c'est le propre d'un test unitaire", () => {
    // Le cas mesuré au banc : « une responsabilité s'appuie sur l'autre ».
    // On ne passe PAS par le conteneur — on donne la dépendance soi-même,
    // exactement ce que l'injection par constructeur permet. C'est aussi ce
    // qui autorise à y glisser un double pour éprouver un cas limite.
    const app = createTestModule();
    const invoice = new InvoiceService(app, new TaxService(app));
    assert.equal(invoice.total(200), 240);
  });

  it("un service posé par `addService` entre au conteneur", async () => {
    // L'autre voie, quand c'est le MONTAGE qu'on éprouve et non un calcul.
    // `addService` sait se passer de kernel (`Module.ts:389` : « pas de kernel
    // (test isolé) → init direct non gardé »).
    const app = createTestModule();
    const tax = (await app.addService(TaxService)) as TaxService;
    assert.strictEqual(app.container.get("tax"), tax);
  });

  it("un service construit au `new` n'entre PAS au conteneur", () => {
    // À dire explicitement : c'est la confusion qui coûte une heure. Le `new`
    // éprouve une logique ; `addService` monte un service.
    const app = createTestModule();
    const tax = new TaxService(app);
    assert.equal(tax.rate(), 0.2);
    assert.isNotOk(app.container.get("tax"));
  });

  it("deux modules de test sont ISOLÉS l'un de l'autre", async () => {
    // Sans quoi un test polluerait le suivant : c'est la première chose qu'on
    // attend d'un décor jetable, et rien d'autre ne le vérifie.
    const a = createTestModule();
    const b = createTestModule();
    await a.addService(TaxService);
    assert.isOk(a.container.get("tax"));
    assert.isNotOk(b.container.get("tax"));
  });

  it("accepte un conteneur préparé — pour y poser un service simulé", () => {
    const container = new Container();
    container.set("clock", { now: () => 42 });
    const app = createTestModule({ container });
    assert.strictEqual(app.container, container);
    assert.equal(
      (app.container.get("clock") as { now: () => number }).now(),
      42,
    );
  });
});
