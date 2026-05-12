import { expect, assert } from "chai";
import "mocha";
import Container, { Scope } from "../Container";

class ServiceA {
  name: string;
  constructor(name: string = "A") {
    this.name = name;
  }
  greet(): string {
    return `hello from ${this.name}`;
  }
}

class ServiceB {
  value: number;
  constructor(value: number = 0) {
    this.value = value;
  }
}

class ServiceC {
  label: string;
  constructor(label: string = "C") {
    this.label = label;
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────

describe("Container › Services", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
  });

  it("set() puis get() retourne l'instance", () => {
    const svc = new ServiceA("test");
    c.set("svcA", svc);
    expect(c.get("svcA")).to.equal(svc);
  });

  it("get() service inexistant → null", () => {
    expect(c.get("ghost")).to.be.null;
  });

  it("get<T>() retourne le bon type TypeScript (cast)", () => {
    const svc = new ServiceA("typed");
    c.set("svcA", svc);
    const result = c.get<ServiceA>("svcA");
    expect(result?.greet()).to.equal("hello from typed");
  });

  it("has() vrai / faux", () => {
    c.set("svcA", new ServiceA());
    expect(c.has("svcA")).to.be.true;
    expect(c.has("ghost")).to.be.false;
  });

  it("set() deux fois écrase la valeur", () => {
    c.set("svcA", new ServiceA("v1"));
    c.set("svcA", new ServiceA("v2"));
    expect((c.get<ServiceA>("svcA"))?.name).to.equal("v2");
  });

  it("set() name vide lève une erreur", () => {
    assert.throws(() => c.set("", new ServiceA()), Error, "Container bad argument name");
  });

  it("remove() service existant → true, plus accessible", () => {
    c.set("svcA", new ServiceA());
    expect(c.remove("svcA")).to.be.true;
    expect(c.get("svcA")).to.be.null;
    expect(c.has("svcA")).to.be.false;
  });

  it("remove() service inexistant → false", () => {
    expect(c.remove("ghost")).to.be.false;
  });

  it("keys() container vide → []", () => {
    expect(c.keys()).to.deep.equal([]);
  });

  it("keys() retourne les noms des services enregistrés", () => {
    c.set("svcA", new ServiceA());
    c.set("svcB", new ServiceB());
    expect(c.keys()).to.have.members(["svcA", "svcB"]);
  });

  it("entries() retourne les paires [nom, instance]", () => {
    const svcA = new ServiceA();
    const svcB = new ServiceB(42);
    c.set("svcA", svcA);
    c.set("svcB", svcB);
    const map = Object.fromEntries(c.entries());
    expect(map["svcA"]).to.equal(svcA);
    expect(map["svcB"]).to.equal(svcB);
  });

  it("set() accepte une fonction comme service", () => {
    const fn = () => 42;
    c.set("fn", fn);
    expect(c.get("fn")).to.equal(fn);
    expect(c.get("fn")).to.be.a("function");
  });

  it("set() accepte une valeur primitive", () => {
    c.set("version", "1.0.0");
    expect(c.get("version")).to.equal("1.0.0");
    c.set("count", 99);
    expect(c.get("count")).to.equal(99);
  });
});

// ─── Parameters ───────────────────────────────────────────────────────────────

describe("Container › Parameters", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
  });

  it("setParameters / getParameters simple", () => {
    c.setParameters("host", "localhost");
    expect(c.getParameters("host")).to.equal("localhost");
  });

  it("setParameters / getParameters notation pointée", () => {
    c.setParameters("db.host", "127.0.0.1");
    c.setParameters("db.port", 5432);
    expect(c.getParameters("db.host")).to.equal("127.0.0.1");
    expect(c.getParameters("db.port")).to.equal(5432);
  });

  it("getParameters() sur le nœud parent retourne l'objet complet", () => {
    c.setParameters("db.host", "127.0.0.1");
    c.setParameters("db.port", 5432);
    const db = c.getParameters("db") as Record<string, unknown>;
    expect(db).to.include({ host: "127.0.0.1", port: 5432 });
  });

  it("setParameters() écrase une valeur existante", () => {
    c.setParameters("db.port", 5432);
    c.setParameters("db.port", 3306);
    expect(c.getParameters("db.port")).to.equal(3306);
  });

  it("setParameters() imbrication profonde", () => {
    c.setParameters("a.b.c.d", "deep");
    expect(c.getParameters("a.b.c.d")).to.equal("deep");
    expect(c.getParameters("a.b.c")).to.deep.include({ d: "deep" });
    expect(c.getParameters("a.b")).to.be.an("object");
    expect(c.getParameters("a")).to.be.an("object");
  });

  it("setParameters() valeur objet / tableau", () => {
    const arr = [1, 2, 3];
    c.setParameters("list", arr);
    expect(c.getParameters("list")).to.deep.equal([1, 2, 3]);
  });

  it("setParameters() lève erreur si name n'est pas string", () => {
    assert.throws(
      () => c.setParameters(42 as unknown as string, "val"),
      Error,
      "container parameter name must be a string"
    );
  });

  it("setParameters() lève erreur si value est undefined", () => {
    assert.throws(
      () => c.setParameters("key", undefined as unknown as string),
      Error,
      "container parameter value must be defined"
    );
  });

  it("setParameters() lève erreur si on descend dans un nœud non-objet", () => {
    c.setParameters("foo.bar", "string_value");
    assert.throws(
      () => c.setParameters("foo.bar.nested", "oops"),
      Error,
      "Cannot create property"
    );
  });

  it("getParameters() name vide lève erreur", () => {
    assert.throws(() => c.getParameters(""), Error);
  });

  it("getParameters() clé inexistante → null", () => {
    expect(c.getParameters("ghost")).to.be.null;
  });
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe("Container › Lifecycle", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
    c.set("svcA", new ServiceA());
    c.setParameters("env", "production");
  });

  it("clean() : get() → null, has() → false, keys() → []", () => {
    c.clean();
    expect(c.get("svcA")).to.be.null;
    expect(c.has("svcA")).to.be.false;
    expect(c.keys()).to.deep.equal([]);
  });

  it("clean() : setParameters / getParameters → null (pas d'erreur)", () => {
    c.clean();
    expect(c.setParameters("x", "y")).to.be.null;
    expect(c.getParameters("x")).to.be.null;
  });

  it("reset() : container à nouveau utilisable après clean()", () => {
    c.clean();
    c.reset();
    c.set("svcA", new ServiceA("after-reset"));
    expect(c.get<ServiceA>("svcA")?.name).to.equal("after-reset");
    c.setParameters("key", "value");
    expect(c.getParameters("key")).to.equal("value");
  });

  it("remove() sur container clean() → false (pas d'erreur)", () => {
    c.clean();
    expect(c.remove("svcA")).to.be.false;
  });
});

// ─── Constructor clone ────────────────────────────────────────────────────────

describe("Container › Constructeur clone", () => {
  it("shallow clone hérite des services du parent", () => {
    const parent = new Container();
    const svcA = new ServiceA("original");
    parent.set("svcA", svcA);
    const child = new Container(parent);
    expect(child.get("svcA")).to.equal(svcA);
  });

  it("shallow clone hérite des paramètres du parent", () => {
    const parent = new Container();
    parent.setParameters("db.host", "localhost");
    const child = new Container(parent);
    expect(child.getParameters("db.host")).to.equal("localhost");
  });

  it("shallow clone : service ajouté au child non visible dans parent", () => {
    const parent = new Container();
    const child = new Container(parent);
    child.set("childOnly", new ServiceB(7));
    expect(parent.get("childOnly")).to.be.null;
  });

  it("deep=true : paramètres clonés — mutation child n'affecte pas parent", () => {
    const parent = new Container();
    parent.setParameters("config.port", 3000);
    const child = new Container(parent, true);
    child.setParameters("config.port", 9999);
    expect(parent.getParameters("config.port")).to.equal(3000);
    expect(child.getParameters("config.port")).to.equal(9999);
  });
});

// ─── Scopes ───────────────────────────────────────────────────────────────────

describe("Container › Scopes", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
    c.set("svcA", new ServiceA("main"));
    c.set("svcB", new ServiceB(1));
    c.setParameters("app.debug", false);
  });

  it("enterScope() sans addScope() préalable lève une erreur", () => {
    assert.throws(() => c.enterScope("unknown"), Error, 'not declared');
  });

  it("scope hérite des services du parent via chaîne prototype", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope.get<ServiceA>("svcA")?.name).to.equal("main");
    expect(scope.get<ServiceB>("svcB")?.value).to.equal(1);
  });

  it("scope retourne instance de Scope (extends Container)", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope).to.be.instanceOf(Scope);
    expect(scope).to.be.instanceOf(Container);
  });

  it("service ajouté au parent APRÈS création du scope visible dans le scope", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    c.set("late", new ServiceC("late-binding"));
    // chaîne prototype : protoService.prototype mis à jour → scope voit le service
    expect(scope.get<ServiceC>("late")?.label).to.equal("late-binding");
  });

  it("service ajouté au scope NON visible dans le parent", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    scope.set("scopeOnly", new ServiceC("local"));
    expect(c.get("scopeOnly")).to.be.null;
  });

  it("remove() dans le parent se propage aux scopes ouverts", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope.get("svcA")).to.not.be.null;
    c.remove("svcA");
    expect(c.get("svcA")).to.be.null;
    expect(scope.get("svcA")).to.be.null;
  });

  it("deux scopes du même nom sont isolés par ID", () => {
    c.addScope("req");
    const s1 = c.enterScope("req");
    const s2 = c.enterScope("req");
    s1.set("exclusive", new ServiceC("s1"));
    expect(s1.get<ServiceC>("exclusive")?.label).to.equal("s1");
    expect(s2.get("exclusive")).to.be.null;
  });

  it("paramètres scope : voit les paramètres du parent", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope.getParameters("app.debug")).to.equal(false);
  });

  it("paramètres scope : override local n'affecte pas le parent", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    scope.setParameters("app.debug", true);
    expect(scope.getParameters("app.debug")).to.equal(true);
    expect(c.getParameters("app.debug")).to.equal(false);
  });

  it("paramètres scope : merge quand parent et scope ont un objet", () => {
    c.setParameters("db", { host: "localhost", port: 5432 });
    c.addScope("req");
    const scope = c.enterScope("req");
    scope.setParameters("db", { port: 3306, ssl: true });
    const merged = scope.getParameters("db") as Record<string, unknown>;
    expect(merged["host"]).to.equal("localhost");
    expect(merged["port"]).to.equal(3306);
    expect(merged["ssl"]).to.equal(true);
  });

  it("paramètres scope : pas de merge si valeur non-objet dans scope", () => {
    c.setParameters("level", { nested: true });
    c.addScope("req");
    const scope = c.enterScope("req");
    scope.setParameters("level", "override-string");
    expect(scope.getParameters("level")).to.equal("override-string");
    expect(c.getParameters("level")).to.deep.include({ nested: true });
  });

  it("leaveScope() : scope nettoyé, accès aux services → null", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    c.leaveScope(scope);
    expect(scope.get("svcA")).to.be.null;
  });

  it("removeScope() : tous les sous-scopes nettoyés", () => {
    c.addScope("req");
    const s1 = c.enterScope("req");
    const s2 = c.enterScope("req");
    c.removeScope("req");
    expect(s1.get("svcA")).to.be.null;
    expect(s2.get("svcA")).to.be.null;
  });

  it("leaveScope sur scope nettoyé (clean) ne lève pas d'erreur", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    c.leaveScope(scope);
    // deuxième leave : idempotent
    assert.doesNotThrow(() => c.leaveScope(scope));
  });
});

// ─── log() ────────────────────────────────────────────────────────────────────

describe("Container › log()", () => {
  it("sans syslog enregistré : ne lève pas d'erreur", () => {
    const c = new Container();
    assert.doesNotThrow(() => c.log(new Error("test")));
  });

  it("avec syslog enregistré : délègue au syslog", () => {
    const c = new Container();
    let called = false;
    const fakeSyslog = {
      log: () => {
        called = true;
      },
    };
    c.set("syslog", fakeSyslog);
    c.log("pci value", undefined, "MSGID", "msg");
    expect(called).to.be.true;
  });
});
