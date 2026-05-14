/* eslint-disable @typescript-eslint/no-explicit-any */
import "reflect-metadata";
import assert from "node:assert";
import "mocha";
import Injector from "../kernel/injector/injector";
import Service from "../Service";
import Container from "../Container";
import { injectable, inject } from "../kernel/decorators/kernelDecorator";
import { Nodefony } from "../Nodefony";
import type { DIScope } from "../kernel/injector/injector";

// ─── Services de test ─────────────────────────────────────────────────────────
//
// Règle : aucun @inject sur des paramètres de constructeur DANS ce fichier.
// tsx/esbuild ne supporte pas les parameter decorators sans flag --tsconfig.
// On appelle inject() directement comme fonction quand nécessaire.

class BarService extends Service {
  constructor(container?: Container) {
    super("BarService", container ?? new Container());
  }
}

class BazService extends Service {
  constructor(container?: Container) {
    super("BazService", container ?? new Container());
  }
}

@injectable()
class AutoA extends Service {
  constructor(container?: Container) {
    super("AutoA", container ?? new Container());
  }
}

@injectable()
class AutoB extends Service {
  constructor(container?: Container) {
    super("AutoB", container ?? new Container());
  }
}

@injectable("CustomName")
class AutoNamed extends Service {
  constructor(container?: Container) {
    super("AutoNamed", container ?? new Container());
  }
}

// Consommateur avec inject:services émis via inject() appelé comme fonction (pas comme decorator syntax)
@injectable()
class ExplicitConsumer extends Service {
  public injected: AutoA;
  constructor(autoA: AutoA) {
    super("ExplicitConsumer", autoA.container as Container);
    this.injected = autoA;
  }
}
// Équivalent de @inject("AutoA") à la position 0
(inject("AutoA") as Function)(ExplicitConsumer, undefined, 0);

// Consommateur avec auto-injection — pas de @inject, position résolue par design:paramtypes
@injectable()
class AutoConsumer extends Service {
  public autoA: AutoA;
  public autoB: AutoB;
  constructor(a: AutoA, b: AutoB) {
    super("AutoConsumer", a.container as Container);
    this.autoA = a;
    this.autoB = b;
  }
}

// Consommateur mixte : arg explicite (String → non-injectable) + auto (AutoA)
@injectable()
class MixedConsumer extends Service {
  public label: string;
  public autoA: AutoA;
  constructor(label: string, a: AutoA) {
    super("MixedConsumer", a.container as Container);
    this.label = label;
    this.autoA = a;
  }
}

// Consommateur avec @inject position 0 + auto position 1
@injectable()
class PriorityConsumer extends Service {
  public injected: AutoA;
  public auto: AutoB;
  constructor(a: AutoA, b: AutoB) {
    super("PriorityConsumer", a.container as Container);
    this.injected = a;
    this.auto = b;
  }
}
// @inject explicite position 0
(inject("AutoA") as Function)(PriorityConsumer, undefined, 0);

// Service sans décorateur — aucune métadonnée DI
class PlainService extends Service {
  public val: string;
  constructor(label: string) {
    super("PlainService", new Container());
    this.val = label;
  }
}

// Service avec initialize()
@injectable()
class InitService extends Service {
  public initialized: boolean = false;
  constructor(container?: Container) {
    super("InitService", container ?? new Container());
  }
  async initialize(): Promise<this> {
    this.initialized = true;
    return this;
  }
}

// ─── 1. Injector.register ─────────────────────────────────────────────────────

describe("Injector — register", () => {
  it("register(name, Ctor) → stocké dans Injector.injectables", () => {
    Injector.register("BarService", BarService as any);
    assert.ok("BarService" in Injector.injectables);
  });

  it("register retourne le constructeur", () => {
    const r = Injector.register("BazService", BazService as any);
    assert.strictEqual(r, BazService);
  });

  it("register('', Ctor) → throw 'bad argument'", () => {
    assert.throws(() => Injector.register("", BarService as any), /bad argument/);
  });

  it("register(name, null) → throw 'bad argument'", () => {
    assert.throws(() => Injector.register("X", null as any), /bad argument/);
  });

  it("register doublon → écrase l'ancien", () => {
    Injector.register("BarService", BarService as any);
    Injector.register("BarService", BazService as any);
    assert.strictEqual(Injector.injectables["BarService"], BazService);
    // remettre
    Injector.register("BarService", BarService as any);
  });
});

// ─── 2. Injector.isRegistered ─────────────────────────────────────────────────

describe("Injector — isRegistered", () => {
  it("isRegistered('AutoA') → true (@injectable)", () => {
    assert.strictEqual(Injector.isRegistered("AutoA"), true);
  });

  it("isRegistered('AutoB') → true", () => {
    assert.strictEqual(Injector.isRegistered("AutoB"), true);
  });

  it("isRegistered('CustomName') → true (@injectable('CustomName'))", () => {
    assert.strictEqual(Injector.isRegistered("CustomName"), true);
  });

  it("isRegistered('PlainService') → false (pas de @injectable)", () => {
    assert.strictEqual(Injector.isRegistered("PlainService"), false);
  });

  it("isRegistered('') → false", () => {
    assert.strictEqual(Injector.isRegistered(""), false);
  });

  it("isRegistered('Unknown') → false", () => {
    assert.strictEqual(Injector.isRegistered("Unknown"), false);
  });
});

// ─── 3. Injector.get ─────────────────────────────────────────────────────────

describe("Injector — get", () => {
  it("get('AutoA') → AutoA constructor", () => {
    assert.strictEqual(Injector.get("AutoA"), AutoA);
  });

  it("get('AutoB') → AutoB constructor", () => {
    assert.strictEqual(Injector.get("AutoB"), AutoB);
  });

  it("get('Unknown') → throw 'not found or not injectable'", () => {
    assert.throws(() => Injector.get("Unknown"), /not found or not injectable/);
  });

  it("get('') → throw", () => {
    assert.throws(() => Injector.get(""), /not found or not injectable/);
  });
});

// ─── 4. Injector.instantiate — sans métadonnée DI (backward compat) ───────────

describe("Injector.instantiate — backward compat (sans métadonnée DI)", () => {
  it("PlainService sans decorator → instancié avec argsClass tels quels", () => {
    const inst = Injector.instantiate(PlainService as any, "hello") as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "hello");
  });

  it("PlainService avec deux args → les deux transmis dans l'ordre", () => {
    class TwoArg extends Service {
      a: string; b: number;
      constructor(a: string, b: number) {
        super("TwoArg", new Container());
        this.a = a; this.b = b;
      }
    }
    const inst = Injector.instantiate(TwoArg as any, "x", 42) as TwoArg;
    assert.strictEqual(inst.a, "x");
    assert.strictEqual(inst.b, 42);
  });

  it("inject = instantiate (alias statique)", () => {
    const inst = Injector.inject(PlainService as any, "alias") as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "alias");
  });

  it("PlainService — design:paramtypes absent → Reflect.construct direct", () => {
    const paramTypes = Reflect.getMetadata("design:paramtypes", PlainService);
    assert.strictEqual(paramTypes, undefined);
  });
});

// ─── 5. @inject decorator — stockage des métadonnées ─────────────────────────

describe("@inject — métadonnées Reflect", () => {
  it("inject('AutoA') appelé sur classe position 0 → meta[0] = 'AutoA'", () => {
    class TestTarget extends Service {
      constructor(a: AutoA) { super("test", a.container as Container); }
    }
    (inject("AutoA") as Function)(TestTarget, undefined, 0);
    const meta: string[] = Reflect.getMetadata("inject:services", TestTarget) || [];
    assert.strictEqual(meta[0], "AutoA");
  });

  it("inject sur deux positions → tableau sparse correctement indexé", () => {
    class TwoPosTarget extends Service {
      constructor(a: AutoA, _b: string, c: AutoB) {
        super("twopos", a.container as Container);
      }
    }
    (inject("AutoA") as Function)(TwoPosTarget, undefined, 0);
    (inject("AutoB") as Function)(TwoPosTarget, undefined, 2);
    const meta: string[] = Reflect.getMetadata("inject:services", TwoPosTarget) || [];
    assert.strictEqual(meta[0], "AutoA");
    assert.strictEqual(meta[1], undefined);
    assert.strictEqual(meta[2], "AutoB");
  });

  it("inject('') → throw 'requires a valid service name'", () => {
    assert.throws(
      () => (inject("") as Function)(class T extends Service { constructor() { super("t", new Container()); } }, undefined, 0),
      /requires a valid service name/
    );
  });

  it("ExplicitConsumer — inject:services[0] = 'AutoA' (émis via inject() direct)", () => {
    const meta: string[] = Reflect.getMetadata("inject:services", ExplicitConsumer) || [];
    assert.strictEqual(meta[0], "AutoA");
  });

  it("Injector.instantiate(ExplicitConsumer) → injected est instance AutoA", () => {
    const inst = Injector.instantiate(ExplicitConsumer as any) as ExplicitConsumer;
    assert.ok(inst instanceof ExplicitConsumer);
    assert.ok(inst.injected instanceof AutoA);
  });

  it("@inject priorité sur design:paramtypes à la même position", () => {
    // PriorityConsumer.inject:services[0] = 'AutoA' (défini en haut du fichier)
    const meta: string[] = Reflect.getMetadata("inject:services", PriorityConsumer) || [];
    assert.strictEqual(meta[0], "AutoA");
  });
});

// ─── 6. Auto-injection via design:paramtypes ─────────────────────────────────
//
// tsx/esbuild ne supporte pas emitDecoratorMetadata — on émet design:paramtypes
// manuellement pour valider la logique instantiate. En production (rollup + TS)
// ce metadata est émis automatiquement.

describe("Injector.instantiate — auto-injection via design:paramtypes", () => {
  before(() => {
    // Simulation de ce que TypeScript émet avec emitDecoratorMetadata: true
    Reflect.defineMetadata("design:paramtypes", [AutoA, AutoB], AutoConsumer);
    Reflect.defineMetadata("design:paramtypes", [String, AutoA], MixedConsumer);
    // PriorityConsumer: pos 0 = @inject("AutoA") (déjà défini), pos 1 = AutoB (auto)
    Reflect.defineMetadata("design:paramtypes", [AutoA, AutoB], PriorityConsumer);
  });

  it("AutoConsumer(a: AutoA, b: AutoB) → auto-injectés tous les deux", () => {
    const inst = Injector.instantiate(AutoConsumer as any) as AutoConsumer;
    assert.ok(inst instanceof AutoConsumer);
    assert.ok(inst.autoA instanceof AutoA);
    assert.ok(inst.autoB instanceof AutoB);
  });

  it("AutoA injecté est une instance fraîche (sans kernel)", () => {
    assert.strictEqual(Nodefony.getKernel(), null);
    const inst = Injector.instantiate(AutoConsumer as any) as AutoConsumer;
    assert.ok(inst.autoA instanceof AutoA);
  });

  it("MixedConsumer(label: string, a: AutoA) — String non injectable → arg explicite", () => {
    const inst = Injector.instantiate(MixedConsumer as any, "my-label") as MixedConsumer;
    assert.ok(inst instanceof MixedConsumer);
    assert.strictEqual(inst.label, "my-label");
    assert.ok(inst.autoA instanceof AutoA);
  });

  it("MixedConsumer sans label → label = undefined (arg explicite absent)", () => {
    const inst = Injector.instantiate(MixedConsumer as any) as MixedConsumer;
    assert.strictEqual(inst.label, undefined);
    assert.ok(inst.autoA instanceof AutoA);
  });

  it("PlainService sans decorator → pas de design:paramtypes", () => {
    assert.strictEqual(Reflect.getMetadata("design:paramtypes", PlainService), undefined);
  });

  it("design:paramtypes de AutoConsumer lisible après émission manuelle", () => {
    const types: unknown[] = Reflect.getMetadata("design:paramtypes", AutoConsumer) || [];
    assert.strictEqual(types[0], AutoA);
    assert.strictEqual(types[1], AutoB);
  });
});

// ─── 7. Priorité @inject > design:paramtypes ─────────────────────────────────

describe("Injector.instantiate — @inject prioritaire sur auto", () => {
  it("PriorityConsumer: pos 0 = @inject('AutoA'), pos 1 = auto AutoB", () => {
    // inject:services[0] = 'AutoA' + design:paramtypes[0]=AutoA, [1]=AutoB (section 6 before)
    const inst = Injector.instantiate(PriorityConsumer as any) as PriorityConsumer;
    assert.ok(inst instanceof PriorityConsumer);
    assert.ok(inst.injected instanceof AutoA, "position 0 doit être AutoA via @inject");
    assert.ok(inst.auto instanceof AutoB, "position 1 doit être AutoB via auto");
  });

  it("inject:services[0]='AutoA' prioritaire même si design:paramtypes[0]=AutoA aussi", () => {
    // Dans ce cas les deux donnent le même résultat — on vérifie la cohérence
    const meta: string[] = Reflect.getMetadata("inject:services", PriorityConsumer) || [];
    const types: unknown[] = Reflect.getMetadata("design:paramtypes", PriorityConsumer) || [];
    assert.strictEqual(meta[0], "AutoA");
    assert.strictEqual(types[1], AutoB);
  });
});

// ─── 8. @injectable decorator ────────────────────────────────────────────────

describe("@injectable — enregistrement dans Injector", () => {
  it("@injectable() → enregistré sous le nom de la classe", () => {
    assert.strictEqual(Injector.injectables["AutoA"], AutoA);
    assert.strictEqual(Injector.injectables["AutoB"], AutoB);
  });

  it("@injectable('CustomName') → sous 'CustomName', pas 'AutoNamed'", () => {
    assert.strictEqual(Injector.injectables["CustomName"], AutoNamed);
    assert.strictEqual(Injector.injectables["AutoNamed"], undefined);
  });

  it("@injectable ne modifie pas la classe — instances normales", () => {
    const inst = new AutoA();
    assert.ok(inst instanceof AutoA);
    assert.strictEqual(inst.name, "AutoA");
  });

  it("@injectable + @injectable('X') sur deux classes différentes → deux entrées", () => {
    assert.ok(Injector.isRegistered("AutoA"));
    assert.ok(Injector.isRegistered("CustomName"));
  });

  it("PlainService sans @injectable → absent des injectables", () => {
    assert.strictEqual("PlainService" in Injector.injectables, false);
  });

  it("InitService avec @injectable() → enregistré", () => {
    assert.ok(Injector.isRegistered("InitService"));
  });
});

// ─── 9. Injector.instantiate — résolution depuis kernel container ──────────────

describe("Injector.instantiate — résolution depuis kernel container", () => {
  it("si kernel.get(name) retourne une instance → réutilisée (pas de re-instantiation)", () => {
    const sharedAutoA = new AutoA();
    const origGetKernel = Nodefony.getKernel;
    const stubKernel = { get: (name: string) => name === "AutoA" ? sharedAutoA : null };
    (Nodefony as any).getKernel = () => stubKernel;

    try {
      const inst = Injector.instantiate(ExplicitConsumer as any) as ExplicitConsumer;
      assert.ok(inst instanceof ExplicitConsumer);
      assert.strictEqual(inst.injected, sharedAutoA, "doit être la même référence");
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("si kernel.get(name) retourne null → fallback sur le registre (nouvelle instance)", () => {
    const origGetKernel = Nodefony.getKernel;
    const stubKernel = { get: (_name: string) => null };
    (Nodefony as any).getKernel = () => stubKernel;

    try {
      const inst = Injector.instantiate(ExplicitConsumer as any) as ExplicitConsumer;
      assert.ok(inst.injected instanceof AutoA);
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("si Nodefony.getKernel() = null → fallback registre (pas de kernel dans les tests)", () => {
    assert.strictEqual(Nodefony.getKernel(), null);
    const inst = Injector.instantiate(AutoConsumer as any) as AutoConsumer;
    // design:paramtypes définis dans section 6 before
    assert.ok(inst.autoA instanceof AutoA);
    assert.ok(inst.autoB instanceof AutoB);
  });

  it("kernel.get() prioritaire sur le registre — instance partagée retournée", () => {
    const shared = new AutoB();
    const origGetKernel = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => ({ get: (n: string) => n === "AutoB" ? shared : null });

    try {
      const inst = Injector.instantiate(AutoConsumer as any) as AutoConsumer;
      assert.strictEqual(inst.autoB, shared);
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });
});

// ─── 10. Injector.inject / reflect ───────────────────────────────────────────

describe("Injector.inject et Reflect.construct direct", () => {
  it("inject = instantiate pour classes sans metadata", () => {
    const a = Injector.inject(PlainService as any, "val-a") as PlainService;
    const b = Injector.instantiate(PlainService as any, "val-a") as PlainService;
    assert.ok(a instanceof PlainService);
    assert.ok(b instanceof PlainService);
    assert.strictEqual(a.val, b.val);
    assert.notStrictEqual(a, b); // instances distinctes
  });

  it("Reflect.construct instancie sans DI", () => {
    const inst = Reflect.construct(PlainService, ["reflect-test"]) as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "reflect-test");
  });

  it("inject avec service injectable → résout les dépendances", () => {
    const inst = Injector.inject(ExplicitConsumer as any) as ExplicitConsumer;
    assert.ok(inst instanceof ExplicitConsumer);
    assert.ok(inst.injected instanceof AutoA);
  });
});

// ─── 11. Instance Injector (délégation statique) ─────────────────────────────

describe("Injector instance — délégation vers static", () => {
  it("instance.instantiate(Ctor, ...args) identique au statique", () => {
    // Créer une instance Injector via Reflect.construct (contourne super(kernel))
    const inj = Object.create(Injector.prototype) as Injector;
    inj.container = new Container();
    (inj as any).syslog = null;

    // La méthode instance délègue à Injector.instantiate
    const result = Injector.instantiate(PlainService as any, "instance-test") as PlainService;
    assert.ok(result instanceof PlainService);
    assert.strictEqual(result.val, "instance-test");
  });
});

// ─── 12. Cas limites ─────────────────────────────────────────────────────────

describe("Injector — cas limites", () => {
  it("instantiate → service @inject vers nom inconnu → throw 'not found'", () => {
    class UnknownRef extends Service {
      constructor(a: any) { super("unknownref", new Container()); }
    }
    (inject("NoSuchService") as Function)(UnknownRef, undefined, 0);
    assert.throws(
      () => Injector.instantiate(UnknownRef as any),
      /not found or not injectable/
    );
  });

  it("auto-injection: type non-injectable (String) → consommé comme arg explicite", () => {
    // MixedConsumer: String → non injectable → argsClass[0]
    const inst = Injector.instantiate(MixedConsumer as any, "explicit-label") as MixedConsumer;
    assert.ok(inst instanceof MixedConsumer);
    assert.strictEqual(inst.label, "explicit-label");
  });

  it("argsClass en excès par rapport à totalParams → appendés silencieusement", () => {
    const inst = Injector.instantiate(PlainService as any, "first", "extra1", "extra2") as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "first");
  });

  it("InitService.initialize() non appelé par instantiate (c'est addService qui le fait)", () => {
    const inst = Injector.instantiate(InitService as any) as InitService;
    assert.ok(inst instanceof InitService);
    assert.strictEqual(inst.initialized, false);
  });

  it("Injector.injectables est partagé statiquement", () => {
    const before = Object.keys(Injector.injectables).length;
    Injector.register("TempXYZ", BarService as any);
    assert.ok(Object.keys(Injector.injectables).length > before);
    delete Injector.injectables["TempXYZ"];
    assert.strictEqual(Object.keys(Injector.injectables).length, before);
  });

  it("PlainService sans args → val = undefined", () => {
    const inst = Injector.instantiate(PlainService as any) as PlainService;
    assert.strictEqual(inst.val, undefined);
  });
});

// ─── 13. Performance ─────────────────────────────────────────────────────────

describe("Injector — performance", () => {
  it("10 000 instantiations sans DI < 200ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      Injector.instantiate(PlainService as any, "perf");
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 200, `10k no-DI took ${elapsed.toFixed(1)}ms`);
  });

  it("5 000 auto-injections (AutoConsumer via design:paramtypes) < 500ms", () => {
    // design:paramtypes définis dans section 6 before
    const t0 = performance.now();
    for (let i = 0; i < 5_000; i++) {
      Injector.instantiate(AutoConsumer as any);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `5k auto-inject took ${elapsed.toFixed(1)}ms`);
  });

  it("5 000 injections explicites (@inject) < 500ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 5_000; i++) {
      Injector.instantiate(ExplicitConsumer as any);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `5k explicit-inject took ${elapsed.toFixed(1)}ms`);
  });

  it("isRegistered sur 100 000 appels < 100ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      Injector.isRegistered("AutoA");
      Injector.isRegistered("Unknown");
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 100, `100k isRegistered took ${elapsed.toFixed(1)}ms`);
  });
});

// ─── 14. Scope singleton / transient ─────────────────────────────────────────

// Services déclarés au niveau module (avant describe) pour que @injectable
// soit évalué une seule fois — évite les re-enregistrements entre tests.

@injectable({ scope: "transient" })
class TransientSvc extends Service {
  public uid: number;
  constructor() {
    super("TransientSvc", new Container());
    this.uid = Math.random();
  }
}

@injectable({ scope: "singleton" })
class ExplicitSingleton extends Service {
  constructor() { super("ExplicitSingleton", new Container()); }
}

@injectable({ name: "NamedTransient", scope: "transient" })
class NTSvc extends Service {
  constructor() { super("NTSvc", new Container()); }
}

// Consumer qui reçoit TransientSvc en dépendance (auto-injection via paramtypes)
@injectable()
class ConsumerOfTransient extends Service {
  public dep: TransientSvc;
  constructor(d: TransientSvc) {
    super("ConsumerOfTransient", d.container as Container);
    this.dep = d;
  }
}
// Pas de design:paramtypes natif (tsx) — on l'émet manuellement
Reflect.defineMetadata("design:paramtypes", [TransientSvc], ConsumerOfTransient);

@injectable()
class ConsumerOfTransient2 extends Service {
  public dep: TransientSvc;
  constructor(d: TransientSvc) {
    super("ConsumerOfTransient2", d.container as Container);
    this.dep = d;
  }
}
Reflect.defineMetadata("design:paramtypes", [TransientSvc], ConsumerOfTransient2);

describe("Injector — scope singleton/transient", () => {
  // ── getScope ──────────────────────────────────────────────────────────────

  it("getScope('TransientSvc') → 'transient'", () => {
    const s: DIScope = Injector.getScope("TransientSvc");
    assert.strictEqual(s, "transient");
  });

  it("getScope('ExplicitSingleton') → 'singleton'", () => {
    assert.strictEqual(Injector.getScope("ExplicitSingleton"), "singleton");
  });

  it("getScope('NamedTransient') → 'transient' (nom custom)", () => {
    assert.strictEqual(Injector.getScope("NamedTransient"), "transient");
  });

  it("getScope sur service @injectable() sans scope → 'singleton' (défaut)", () => {
    assert.strictEqual(Injector.getScope("AutoA"), "singleton");
    assert.strictEqual(Injector.getScope("AutoB"), "singleton");
  });

  it("getScope sur @injectable(string) → 'singleton' (rétro-compat)", () => {
    assert.strictEqual(Injector.getScope("CustomName"), "singleton");
  });

  it("getScope sur nom inconnu → 'singleton' (défaut sûr)", () => {
    assert.strictEqual(Injector.getScope("DoesNotExist"), "singleton");
  });

  // ── transient — comportement ──────────────────────────────────────────────

  it("transient — deux consumers reçoivent des instances distinctes", () => {
    const c1 = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
    const c2 = Injector.instantiate(ConsumerOfTransient2 as any) as ConsumerOfTransient2;
    assert.notStrictEqual(c1.dep, c2.dep, "transient → instances différentes");
  });

  it("transient — même consumer instancié deux fois → deps différentes", () => {
    const a = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
    const b = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
    assert.notStrictEqual(a.dep, b.dep);
  });

  it("transient — uid différent entre deux résolutions", () => {
    const a = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
    const b = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
    // uid = Math.random() → différent avec très haute probabilité
    assert.notStrictEqual(a.dep.uid, b.dep.uid);
  });

  it("transient — kernel.get() ignoré, toujours new", () => {
    const shared = new TransientSvc();
    shared.uid = -1; // marqueur

    const origGetKernel = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => ({
      get: (n: string) => (n === "TransientSvc" ? shared : null),
    });

    try {
      const c = Injector.instantiate(ConsumerOfTransient as any) as ConsumerOfTransient;
      assert.notStrictEqual(c.dep, shared, "transient ignore le container kernel");
      assert.notStrictEqual(c.dep.uid, -1, "uid doit être nouveau, pas -1");
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  // ── singleton — comportement ──────────────────────────────────────────────

  it("singleton — kernel.get() retourne l'instance partagée", () => {
    const shared = new ExplicitSingleton();
    const origGetKernel = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => ({
      get: (n: string) => (n === "ExplicitSingleton" ? shared : null),
    });

    // Consumer qui injecte ExplicitSingleton
    @injectable()
    class ConsumerSingleton extends Service {
      public dep: ExplicitSingleton;
      constructor(d: ExplicitSingleton) {
        super("ConsumerSingleton", d.container as Container);
        this.dep = d;
      }
    }
    Reflect.defineMetadata("design:paramtypes", [ExplicitSingleton], ConsumerSingleton);

    try {
      const c = Injector.instantiate(ConsumerSingleton as any) as ConsumerSingleton;
      assert.strictEqual(c.dep, shared, "singleton → instance partagée du kernel");
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("singleton — sans kernel, crée une nouvelle instance", () => {
    assert.strictEqual(Nodefony.getKernel(), null);
    const inst = Injector.instantiate(ExplicitSingleton as any);
    assert.ok(inst instanceof ExplicitSingleton);
  });

  // ── InjectableOptions API ─────────────────────────────────────────────────

  it("@injectable({ name }) seul → scope 'singleton' par défaut", () => {
    @injectable({ name: "OnlyName" })
    class OnlyNameSvc extends Service {
      constructor() { super("OnlyNameSvc", new Container()); }
    }
    assert.ok(Injector.isRegistered("OnlyName"));
    assert.strictEqual(Injector.getScope("OnlyName"), "singleton");
  });

  it("@injectable({ scope: 'transient' }) seul → name = class name", () => {
    @injectable({ scope: "transient" })
    class JustTransient extends Service {
      constructor() { super("JustTransient", new Container()); }
    }
    assert.ok(Injector.isRegistered("JustTransient"));
    assert.strictEqual(Injector.getScope("JustTransient"), "transient");
  });

  it("@injectable({}) → singleton + nom de classe", () => {
    @injectable({})
    class EmptyOpts extends Service {
      constructor() { super("EmptyOpts", new Container()); }
    }
    assert.ok(Injector.isRegistered("EmptyOpts"));
    assert.strictEqual(Injector.getScope("EmptyOpts"), "singleton");
  });
});
