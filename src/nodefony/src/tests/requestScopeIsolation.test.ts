//
// ─── Isolation par requête : ce que la documentation affirme (#486) ──────────
//
// `docs/architecture/injection-portees.md` et le tutoriel enseignent trois
// choses que ce fichier rend vraies ou fausses :
//
// 1. une variable de module partagée FUIT entre deux requêtes concurrentes
//    (Node passe à l'autre requête à chaque `await`), quand l'ALS et le scope
//    rendent à chacune la sienne ;
// 2. un service `request` se remplace pour UNE requête en posant sur son scope
//    une instance de la même classe (une sous-classe) avant sa résolution ;
// 3. un objet quelconque posé sous sa clé est refusé : l'injecteur ne rend
//    jamais qu'une instance de la classe déclarée.
//
// Chaque bloc nomme ce qu'il faut débrancher pour le voir tomber.
//
import "reflect-metadata";
import { expect } from "chai";
import Injector from "../kernel/injector/injector";
import Service from "../Service";
import Container, { Scope } from "../Container";
import RequestContext from "../runtime/RequestContext";
import { injectable, inject } from "../kernel/decorators/kernelDecorator";

const root = new Container();
root.set("syslog", { log: () => undefined });
root.addScope("request");

/** Ouvre une requête : scope neuf posé dans la bulle ALS, refermé à la fin. */
async function inRequest<T>(
  requestId: string,
  fn: (scope: Scope) => T | Promise<T>,
): Promise<T> {
  const scope = root.enterScope("request");
  try {
    return await RequestContext.run({ requestId, scope }, () => fn(scope));
  } finally {
    root.leaveScope(scope);
  }
}

/** Une entrée-sortie simulée : rend la main à la boucle, comme une requête SQL. */
const io = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

// ─── 1. La variable globale fuit, le scope non ────────────────────────────────
// Débrancher : dans la variante « scope », lire `currentTenant` au lieu du
// scope — la seconde assertion tombe.

let currentTenant = "";

describe("Isolation par requête — pourquoi une variable globale ne suffit pas", () => {
  it("une variable de module est écrasée par la requête concurrente pendant l'attente", async () => {
    const serve = (tenant: string) =>
      inRequest(tenant, async () => {
        currentTenant = tenant;
        await io();
        return currentTenant;
      });
    const [acme, globex] = await Promise.all([serve("acme"), serve("globex")]);
    // acme a lu la valeur de globex : c'est la fuite entre clients.
    expect([acme, globex]).to.deep.equal(["globex", "globex"]);
  });

  it("le scope de la requête, lu par RequestContext.getScope(), rend à chacune la sienne", async () => {
    const serve = (tenant: string) =>
      inRequest(tenant, async () => {
        RequestContext.requireScope().set("tenantId", tenant);
        await io();
        return RequestContext.getScope()?.get<string>("tenantId");
      });
    const [acme, globex] = await Promise.all([serve("acme"), serve("globex")]);
    expect([acme, globex]).to.deep.equal(["acme", "globex"]);
    expect(root.get("tenantId"), "rien n'a été écrit sur la racine").to.equal(
      null,
    );
  });
});

// ─── 2 et 3. Remplacer un service `request` pour une requête ──────────────────

class Tenant extends Service {
  readonly id: string = "réel";
  constructor(scope: Scope) {
    super("isoTenant", scope, false);
  }
}
injectable({ name: "isoTenant", scope: "request" })(Tenant);

class FakeTenant extends Tenant {
  override readonly id = "faux";
}

/** Consommateur `transient` : il résout le service à chaque construction. */
class TenantReader extends Service {
  constructor(readonly tenant: Tenant) {
    super("isoTenantReader", root, false);
  }
}
inject("isoTenant")(TenantReader, undefined, 0);
injectable({ name: "isoTenantReader", scope: "transient" })(TenantReader);

describe("Isolation par requête — un faux service pour UNE requête", () => {
  // Débrancher : dans `Injector._resolveRequestScoped`, ignorer l'objet déjà
  // posé (`scope.hasOwn(key)`) — le faux n'est plus rendu.
  it("rend l'instance posée sur le scope avant la résolution, si elle est de la classe du service", async () => {
    const seen = await inRequest("test", (scope) => {
      scope.set("isoTenant", new FakeTenant(scope));
      return Injector.instantiate<TenantReader>(TenantReader).tenant.id;
    });
    expect(seen).to.equal("faux");
    // La requête suivante retrouve le vrai service : le faux est parti avec
    // son scope.
    const next = await inRequest(
      "suivante",
      () => Injector.instantiate<TenantReader>(TenantReader).tenant.id,
    );
    expect(next).to.equal("réel");
  });

  // Débrancher : le `instanceof Ctor` de `Injector._resolveRequestScoped`.
  it("refuse un objet quelconque posé sous la clé du service, en le disant", async () => {
    await inRequest("test", (scope) => {
      scope.set("isoTenant", { id: "objet nu" });
      expect(() => Injector.instantiate(TenantReader)).to.throw(
        /clé « isoTenant » est déjà occupée/,
      );
    });
  });
});
