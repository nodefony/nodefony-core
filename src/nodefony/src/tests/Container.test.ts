import { expect, assert } from "chai";
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
    expect(c.get<ServiceA>("svcA")?.name).to.equal("v2");
  });

  it("set() name vide lève une erreur", () => {
    assert.throws(
      () => c.set("", new ServiceA()),
      Error,
      "Container bad argument name",
    );
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

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe("Container › Lifecycle", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
    c.set("svcA", new ServiceA());
  });

  it("clean() : get() → null, has() → false, keys() → []", () => {
    c.clean();
    expect(c.get("svcA")).to.be.null;
    expect(c.has("svcA")).to.be.false;
    expect(c.keys()).to.deep.equal([]);
  });

  it("reset() : container à nouveau utilisable après clean()", () => {
    c.clean();
    c.reset();
    c.set("svcA", new ServiceA("after-reset"));
    expect(c.get<ServiceA>("svcA")?.name).to.equal("after-reset");
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

  it("shallow clone : service ajouté au child non visible dans parent", () => {
    const parent = new Container();
    const child = new Container(parent);
    child.set("childOnly", new ServiceB(7));
    expect(parent.get("childOnly")).to.be.null;
  });
});

// ─── Scopes ───────────────────────────────────────────────────────────────────

describe("Container › Scopes", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
    c.set("svcA", new ServiceA("main"));
    c.set("svcB", new ServiceB(1));
  });

  it("enterScope() sans addScope() préalable lève une erreur", () => {
    assert.throws(() => c.enterScope("unknown"), Error, "not declared");
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

  // ── Garde-fous durcissement 2026-06-11 (adoption protos parents + Map) ──

  it("scopeCount() suit enter/leave ; 0 pour un scope inconnu", () => {
    expect(c.scopeCount("req")).to.equal(0);
    c.addScope("req");
    const s1 = c.enterScope("req");
    const s2 = c.enterScope("req");
    expect(c.scopeCount("req")).to.equal(2);
    c.leaveScope(s1);
    expect(c.scopeCount("req")).to.equal(1);
    c.leaveScope(s2);
    expect(c.scopeCount("req")).to.equal(0);
    expect(c.scopeCount("unknown")).to.equal(0);
  });

  it("scope.set ne pollue JAMAIS le prototype partagé du parent (anti data race)", () => {
    c.addScope("req");
    const s1 = c.enterScope("req");
    const s2 = c.enterScope("req");
    s1.set("controller", new ServiceC("req-1"));
    // Ni le parent ni un scope CONCURRENT ne doivent voir le service per-request.
    expect(c.get("controller")).to.be.null;
    expect(s2.get("controller")).to.be.null;
    expect(c.protoService.prototype["controller"]).to.equal(undefined);
  });

  it("scope.remove : own only — un service HÉRITÉ n'est pas supprimable depuis le scope", () => {
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope.remove("svcA")).to.equal(false);
    // Le parent et le scope voient toujours le service.
    expect(c.get("svcA")).to.not.be.null;
    expect(scope.get("svcA")).to.not.be.null;
    // Un service LOCAL au scope reste supprimable.
    scope.set("local", new ServiceC("x"));
    expect(scope.remove("local")).to.equal(true);
    expect(scope.get("local")).to.be.null;
  });

  it("ids de scopes uniques (compteur monotone)", () => {
    c.addScope("req");
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = c.enterScope("req");
      ids.add(s.id);
      c.leaveScope(s);
    }
    expect(ids.size).to.equal(50);
  });
});

// ─── log() ────────────────────────────────────────────────────────────────────

describe("Container › log()", () => {
  it("sans syslog enregistré : appelle console.warn, ne lève pas d'erreur", () => {
    const c = new Container();
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      assert.doesNotThrow(() => c.log("test pci"));
      expect(warnings).to.have.length(1);
      expect(warnings[0][0]).to.include("[Container]");
    } finally {
      console.warn = original;
    }
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

  it("sans msgid : utilise 'SERVICES CONTAINER' comme msgid", () => {
    const c = new Container();
    let capturedMsgid: unknown;
    c.set("syslog", {
      log: (_pci: unknown, _sev: unknown, msgid: unknown) => {
        capturedMsgid = msgid;
      },
    });
    c.log("payload", "INFO");
    expect(capturedMsgid).to.equal("SERVICES CONTAINER");
  });

  it("avec msgid explicite : le transmet au syslog", () => {
    const c = new Container();
    let capturedMsgid: unknown;
    c.set("syslog", {
      log: (_pci: unknown, _sev: unknown, msgid: unknown) => {
        capturedMsgid = msgid;
      },
    });
    c.log("payload", "INFO", "MY_ID");
    expect(capturedMsgid).to.equal("MY_ID");
  });
});

// ─── Valeurs falsy (bugs has/remove) ─────────────────────────────────────────

describe("Container › valeurs falsy", () => {
  let c: Container;
  beforeEach(() => {
    c = new Container();
  });

  it("has() → true pour valeur false", () => {
    c.set("flag", false);
    expect(c.has("flag")).to.be.true;
  });

  it("has() → true pour valeur 0", () => {
    c.set("count", 0);
    expect(c.has("count")).to.be.true;
  });

  it("has() → true pour chaîne vide", () => {
    c.set("str", "");
    expect(c.has("str")).to.be.true;
  });

  it("get() retourne la valeur falsy enregistrée", () => {
    c.set("flag", false);
    expect(c.get("flag")).to.equal(false);
    c.set("count", 0);
    expect(c.get("count")).to.equal(0);
  });

  it("remove() supprime une valeur false → true, plus accessible", () => {
    c.set("flag", false);
    expect(c.remove("flag")).to.be.true;
    expect(c.has("flag")).to.be.false;
    expect(c.get("flag")).to.be.null;
  });

  it("remove() supprime une valeur 0 → true, plus accessible", () => {
    c.set("count", 0);
    expect(c.remove("count")).to.be.true;
    expect(c.has("count")).to.be.false;
  });

  it("remove() supprime une chaîne vide → true", () => {
    c.set("str", "");
    expect(c.remove("str")).to.be.true;
    expect(c.has("str")).to.be.false;
  });
});

// ─── Comportements avancés ────────────────────────────────────────────────────

describe("Container › comportements avancés", () => {
  it("set() après clean() lève une erreur (services=null)", () => {
    const c = new Container();
    c.clean();
    assert.throws(() => c.set("x", {}), Error);
  });

  it("has() après clean() → false (pas d'erreur)", () => {
    const c = new Container();
    c.clean();
    expect(c.has("x")).to.be.false;
  });

  it("keys() après clean() → []", () => {
    const c = new Container();
    c.set("a", 1);
    c.clean();
    expect(c.keys()).to.deep.equal([]);
  });

  it("entries() après clean() → []", () => {
    const c = new Container();
    c.set("a", 1);
    c.clean();
    expect(c.entries()).to.deep.equal([]);
  });

  it("addScope() appelé deux fois pour le même nom → idempotent", () => {
    const c = new Container();
    const s1 = c.addScope("req");
    const s2 = c.addScope("req");
    expect(s1).to.equal(s2);
  });

  it("leaveScope() avec scope inexistant → ne lève pas d'erreur", () => {
    const c = new Container();
    c.addScope("req");
    const scope = c.enterScope("req");
    c.leaveScope(scope);
    assert.doesNotThrow(() => c.leaveScope(scope));
  });

  it("constructeur avec argument non-Container → container vide", () => {
    const c = new Container("not a container" as unknown as Container);
    expect(c.keys()).to.deep.equal([]);
  });

  it("clone shallow : clean() du child n'affecte pas le parent", () => {
    const parent = new Container();
    parent.set("svc", { v: 1 });
    const child = new Container(parent);
    child.clean();
    expect(parent.has("svc")).to.be.true;
    expect(parent.get("svc")).to.deep.equal({ v: 1 });
  });

  it("reset() recrée protoService", () => {
    const c = new Container();
    const origProto = c.protoService;
    c.reset();
    expect(c.protoService).to.not.equal(origProto);
    c.set("x", 1);
    expect(c.get("x")).to.equal(1);
  });

  it("remove() propage aux scopes ouverts (vérification has)", () => {
    const c = new Container();
    c.set("svc", { v: 1 });
    c.addScope("req");
    const scope = c.enterScope("req");
    expect(scope.has("svc")).to.be.true;
    c.remove("svc");
    expect(scope.has("svc")).to.be.false;
  });
});

// ─── Scope avancé ─────────────────────────────────────────────────────────────

describe("Container › Scope avancé", () => {
  it("Scope.clean() → get retourne null", () => {
    const c = new Container();
    c.set("key", "value");
    c.addScope("req");
    const scope = c.enterScope("req");
    c.leaveScope(scope);
    expect(scope.get("key")).to.be.null;
  });

  it("scope a son propre id unique", () => {
    const c = new Container();
    c.addScope("req");
    const s1 = c.enterScope("req");
    const s2 = c.enterScope("req");
    expect(s1.id).to.not.equal(s2.id);
  });
});

describe("Container › Scope — étanchéité (#482)", () => {
  it("un scope imbriqué voit les services propres de son scope parent", () => {
    const root = new Container();
    root.set("db", "DB");
    root.addScope("req");
    const s1 = root.enterScope("req");
    s1.set("controller", "C");
    s1.addScope("sub");
    const sub = s1.enterScope("sub");

    expect(sub.get("controller")).to.equal("C");
    expect(sub.get("db")).to.equal("DB");
    // Et l'écriture reste locale au sous-scope.
    sub.set("controller", "C2");
    expect(sub.get("controller")).to.equal("C2");
    expect(s1.get("controller")).to.equal("C");
  });

  it("reset() lève sur un scope au lieu de le détacher de son parent", () => {
    const root = new Container();
    root.set("db", "DB");
    root.addScope("req");
    const s1 = root.enterScope("req");
    expect(() => s1.reset()).to.throw(/scope/i);
    expect(s1.get("db")).to.equal("DB");
  });

  it("remove() sur le parent ne retire pas la surcharge propre d'un scope ouvert", () => {
    const root = new Container();
    root.set("db", "DB");
    root.addScope("req");
    const s1 = root.enterScope("req");
    s1.set("db", "DB-tenant");

    expect(root.remove("db")).to.equal(true);
    expect(root.get("db")).to.be.null;
    expect(s1.get("db")).to.equal("DB-tenant");
  });

  it("remove() sur le parent retire le service hérité d'un scope ouvert", () => {
    const root = new Container();
    root.set("db", "DB");
    root.addScope("req");
    const s1 = root.enterScope("req");
    root.remove("db");
    expect(s1.get("db")).to.be.null;
  });

  it("les noms hérités d'Object.prototype ne sont pas des services", () => {
    const root = new Container();
    root.addScope("req");
    const s1 = root.enterScope("req");
    for (const c of [root, s1]) {
      expect(c.has("toString")).to.equal(false);
      expect(c.has("constructor")).to.equal(false);
      expect(c.get("hasOwnProperty")).to.be.null;
    }
  });
});

describe("Container › registre des scopes ouverts (#483)", () => {
  // Le registre ne sert qu'à COMPTER les scopes ouverts et à tous les refermer
  // au clean(). Indexé par un identifiant chaîne fabriqué à chaque ouverture,
  // il coûtait ~515 ns des ~720 ns du cycle enterScope + leaveScope ; un Set
  // tenu par l'objet lui-même rend le même service sans fabriquer de clé.

  it("le registre d'un nom est un Set qui tient les scopes ouverts eux-mêmes", () => {
    const c = new Container();
    const bucket = c.addScope("req");
    const s = c.enterScope("req");
    expect(bucket).to.be.instanceOf(Set);
    expect(bucket.has(s)).to.equal(true);
    c.leaveScope(s);
    expect(bucket.has(s)).to.equal(false);
    expect(bucket.size).to.equal(0);
  });

  it("enterScope ne fabrique pas d'identifiant : il naît à sa première lecture, puis ne change plus", () => {
    const c = new Container();
    c.addScope("req");
    const a = c.enterScope("req");
    const b = c.enterScope("req");
    // Lu d'abord sur b, l'identifiant de b est fabriqué AVANT celui de a : la
    // numérotation suit la lecture, pas l'ouverture.
    const idB = b.id;
    const idA = a.id;
    expect(parseInt(idB, 36)).to.be.lessThan(parseInt(idA, 36));
    expect(a.id).to.equal(idA);
    expect(b.id).to.equal(idB);
  });

  it("leaveScope ne referme qu'une fois : un second appel ne rappelle pas clean()", () => {
    const c = new Container();
    c.addScope("req");
    const s = c.enterScope("req");
    let cleans = 0;
    const clean = s.clean.bind(s);
    s.clean = () => {
      cleans++;
      clean();
    };
    c.leaveScope(s);
    c.leaveScope(s);
    expect(cleans).to.equal(1);
    expect(c.scopeCount("req")).to.equal(0);
  });

  it("leaveScope ignore un scope ouvert par un AUTRE conteneur, sous le même nom", () => {
    const c1 = new Container();
    c1.addScope("req");
    const c2 = new Container();
    c2.set("db", "DB2");
    c2.addScope("req");
    const s2 = c2.enterScope("req");
    c1.leaveScope(s2);
    expect(c2.scopeCount("req")).to.equal(1);
    expect(s2.get("db")).to.equal("DB2");
  });

  it("un scope quitte le registre même si son clean() lève — jamais épinglé", () => {
    const c = new Container();
    c.addScope("req");
    const s = c.enterScope("req");
    s.clean = () => {
      throw new Error("clean en échec");
    };
    expect(() => c.leaveScope(s)).to.throw("clean en échec");
    expect(c.scopeCount("req")).to.equal(0);
  });

  it("removeScope referme CHACUN des scopes ouverts du nom, puis oublie le nom", () => {
    const c = new Container();
    c.set("db", "DB");
    c.addScope("req");
    const opened = [0, 1, 2, 3, 4].map(() => c.enterScope("req"));
    c.removeScope("req");
    for (const s of opened) expect(s.get("db")).to.be.null;
    expect(c.scopeCount("req")).to.equal(0);
    expect(() => c.enterScope("req")).to.throw("not declared");
  });

  it("clean() du conteneur referme les scopes ouverts de TOUS les noms", () => {
    const c = new Container();
    c.set("db", "DB");
    c.addScope("req");
    c.addScope("job");
    const r = c.enterScope("req");
    const j = c.enterScope("job");
    c.clean();
    expect(r.get("db")).to.be.null;
    expect(j.get("db")).to.be.null;
  });

  it("quitter un scope referme aussi ses sous-scopes ouverts", () => {
    const c = new Container();
    c.set("db", "DB");
    c.addScope("req");
    const s1 = c.enterScope("req");
    s1.addScope("sub");
    const sub = s1.enterScope("sub");
    c.leaveScope(s1);
    expect(sub.get("db")).to.be.null;
    expect(s1.scopeCount("sub")).to.equal(0);
  });
});

describe("Container › closed (#484)", () => {
  it("un scope est ouvert à l'entrée, fermé après leaveScope — et ne se rouvre pas", () => {
    const root = new Container();
    root.addScope("request");
    const scope = root.enterScope("request");
    expect(scope.closed).to.equal(false);
    root.leaveScope(scope);
    expect(scope.closed).to.equal(true);
    expect(() => scope.reset()).to.throw(/reset\(\) is not allowed/);
    expect(scope.closed).to.equal(true);
  });

  it("une racine est fermée par clean(), rendue utilisable par reset()", () => {
    const root = new Container();
    expect(root.closed).to.equal(false);
    root.clean();
    expect(root.closed).to.equal(true);
    root.reset();
    expect(root.closed).to.equal(false);
  });

  it("fermer la racine ferme aussi les scopes encore ouverts", () => {
    const root = new Container();
    root.addScope("request");
    const scope = root.enterScope("request");
    root.clean();
    expect(scope.closed).to.equal(true);
  });
});
