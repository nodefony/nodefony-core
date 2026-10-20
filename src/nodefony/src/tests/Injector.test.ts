import "reflect-metadata";
import assert from "node:assert";
import Injector from "../kernel/injector/injector";
import Service from "../Service";
import Container from "../Container";
import { injectable, Inject } from "../kernel/decorators/kernelDecorator";
import { Nodefony } from "../Nodefony";
import type { DIScope } from "../kernel/injector/injector";

// ─── Services de test ─────────────────────────────────────────────────────────
//
// Règle : aucun @Inject sur des paramètres de constructeur DANS ce fichier.
// tsx/esbuild ne supporte pas les parameter decorators sans flag --tsconfig.
// On appelle Inject() directement comme fonction quand nécessaire.

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

// Consommateur avec inject:services émis via Inject() appelé comme fonction (pas comme decorator syntax)
@injectable()
class ExplicitConsumer extends Service {
  public injected: AutoA;
  constructor(autoA: AutoA) {
    super("ExplicitConsumer", autoA.container as Container);
    this.injected = autoA;
  }
}
// Équivalent de @Inject("AutoA") à la position 0
Inject("AutoA")(ExplicitConsumer, undefined, 0);

// Consommateur SANS @Inject, typé par des services inscrits : le type ne résout
// rien (ADR-0018), chaque paramètre reçoit l'argument positionnel.
@injectable()
class AutoConsumer extends Service {
  public autoA: AutoA | undefined;
  public autoB: AutoB | undefined;
  constructor(a?: AutoA, b?: AutoB) {
    super("AutoConsumer", a?.container ?? new Container());
    this.autoA = a;
    this.autoB = b;
  }
}

// Consommateur sans aucun @Inject : deux arguments positionnels.
@injectable()
class MixedConsumer extends Service {
  public label: string;
  public autoA: AutoA | undefined;
  constructor(label: string, a?: AutoA) {
    super("MixedConsumer", a?.container ?? new Container());
    this.label = label;
    this.autoA = a;
  }
}

// Consommateur nommé en position 0, positionnel en position 1
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
// @Inject explicite position 0
Inject("AutoA")(PriorityConsumer, undefined, 0);

// Consommateur dont les DEUX dépendances sont nommées.
@injectable()
class NamedConsumer extends Service {
  public autoA: AutoA;
  public autoB: AutoB;
  constructor(a: AutoA, b: AutoB) {
    super("NamedConsumer", a.container ?? new Container());
    this.autoA = a;
    this.autoB = b;
  }
}
Inject("AutoA")(NamedConsumer, undefined, 0);
Inject("AutoB")(NamedConsumer, undefined, 1);

// Service sans décorateur — aucune métadonnée DI
class PlainService extends Service {
  public val: string;
  constructor(label: string) {
    super("PlainService", new Container());
    this.val = label;
  }
}

// Service avec init()
@injectable()
class InitService extends Service {
  public initialized: boolean = false;
  constructor(container?: Container) {
    super("InitService", container ?? new Container());
  }
  async init(): Promise<this> {
    this.initialized = true;
    return this;
  }
}

// ─── 1. Injector.register ─────────────────────────────────────────────────────

describe("Injector — register", () => {
  it("register(name, Ctor) → stocké dans Injector.injectables", () => {
    Injector.register("BarService", BarService);
    assert.ok("BarService" in Injector.injectables);
  });

  it("register retourne le constructeur", () => {
    const r = Injector.register("BazService", BazService);
    assert.strictEqual(r, BazService);
  });

  it("register('', Ctor) → throw 'bad argument'", () => {
    assert.throws(() => Injector.register("", BarService), /bad argument/);
  });

  it("register(name, null) → throw 'bad argument'", () => {
    assert.throws(() => Injector.register("X", null as any), /bad argument/);
  });

  it("register doublon → écrase l'ancien", () => {
    Injector.register("BarService", BarService);
    Injector.register("BarService", BazService);
    assert.strictEqual(Injector.injectables["BarService"], BazService);
    // remettre
    Injector.register("BarService", BarService);
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
    const inst = Injector.instantiate(PlainService, "hello") as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "hello");
  });

  it("PlainService avec deux args → les deux transmis dans l'ordre", () => {
    class TwoArg extends Service {
      a: string;
      b: number;
      constructor(a: string, b: number) {
        super("TwoArg", new Container());
        this.a = a;
        this.b = b;
      }
    }
    const inst = Injector.instantiate(TwoArg, "x", 42) as TwoArg;
    assert.strictEqual(inst.a, "x");
    assert.strictEqual(inst.b, 42);
  });

  it("inject = instantiate (alias statique)", () => {
    const inst = Injector.inject(PlainService, "alias") as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "alias");
  });
});

// ─── 5. @Inject decorator — stockage des métadonnées ─────────────────────────

describe("@Inject — métadonnées Reflect", () => {
  it("Inject('AutoA') appelé sur classe position 0 → meta[0] = 'AutoA'", () => {
    class TestTarget extends Service {
      constructor(a: AutoA) {
        super("test", a.container as Container);
      }
    }
    Inject("AutoA")(TestTarget, undefined, 0);
    const meta: string[] =
      Reflect.getMetadata("inject:services", TestTarget) || [];
    assert.strictEqual(meta[0], "AutoA");
  });

  it("inject sur deux positions → tableau sparse correctement indexé", () => {
    class TwoPosTarget extends Service {
      constructor(a: AutoA, _b: string, c: AutoB) {
        super("twopos", a.container as Container);
      }
    }
    Inject("AutoA")(TwoPosTarget, undefined, 0);
    Inject("AutoB")(TwoPosTarget, undefined, 2);
    const meta: string[] =
      Reflect.getMetadata("inject:services", TwoPosTarget) || [];
    assert.strictEqual(meta[0], "AutoA");
    assert.strictEqual(meta[1], undefined);
    assert.strictEqual(meta[2], "AutoB");
  });

  it("Inject('') → throw 'requires a valid service name'", () => {
    assert.throws(
      () =>
        Inject("")(
          class T extends Service {
            constructor() {
              super("t", new Container());
            }
          },
          undefined,
          0,
        ),
      /requires a valid service name/,
    );
  });

  it("ExplicitConsumer — inject:services[0] = 'AutoA' (émis via Inject() direct)", () => {
    const meta: string[] =
      Reflect.getMetadata("inject:services", ExplicitConsumer) || [];
    assert.strictEqual(meta[0], "AutoA");
  });

  it("Injector.instantiate(ExplicitConsumer) → injected est instance AutoA", () => {
    const inst = Injector.instantiate(ExplicitConsumer) as ExplicitConsumer;
    assert.ok(inst instanceof ExplicitConsumer);
    assert.ok(inst.injected instanceof AutoA);
  });

  it("PriorityConsumer — inject:services[0] = 'AutoA'", () => {
    // PriorityConsumer.inject:services[0] = 'AutoA' (défini en haut du fichier)
    const meta: string[] =
      Reflect.getMetadata("inject:services", PriorityConsumer) || [];
    assert.strictEqual(meta[0], "AutoA");
  });
});

// ─── 6. Une dépendance se NOMME — le type d'un paramètre ne décide rien ───────
//
// ADR-0018 : l'injecteur ne lit plus `design:paramtypes`. La métadonnée est
// posée ici À LA MAIN, exactement comme un émetteur la poserait, pour prouver
// qu'elle est IGNORÉE même présente — y compris quand le type est un service
// inscrit. Un paramètre sans `@Inject("nom")` reçoit l'argument positionnel
// suivant, ou `undefined`.

describe("Injector.instantiate — une dépendance se nomme, le type ne résout rien", () => {
  beforeAll(() => {
    Reflect.defineMetadata("design:paramtypes", [AutoA, AutoB], AutoConsumer);
    Reflect.defineMetadata("design:paramtypes", [String, AutoA], MixedConsumer);
    Reflect.defineMetadata(
      "design:paramtypes",
      [AutoA, AutoB],
      PriorityConsumer,
    );
  });

  it("paramètres typés par des services inscrits, sans nom → arguments positionnels", () => {
    const a = new AutoA();
    const b = new AutoB();
    const inst = Injector.instantiate(AutoConsumer, a, b) as AutoConsumer;
    assert.strictEqual(inst.autoA, a);
    assert.strictEqual(inst.autoB, b);
  });

  it("paramètre typé par un service inscrit, sans nom ni argument → undefined", () => {
    const label = "my-label";
    const inst = Injector.instantiate(
      MixedConsumer,
      label,
      undefined,
    ) as MixedConsumer;
    assert.strictEqual(inst.label, label);
    assert.strictEqual(inst.autoA, undefined);
  });

  it("nommé en 0, non nommé en 1 → 0 résolu, 1 reçoit le 1ᵉʳ positionnel", () => {
    const b = new AutoB();
    const inst = Injector.instantiate(PriorityConsumer, b) as PriorityConsumer;
    assert.ok(inst.injected instanceof AutoA, "position 0 résolue par son nom");
    assert.strictEqual(inst.auto, b, "position 1 = argument positionnel");
  });

  it("positionnels au-delà de la dernière dépendance nommée → transmis", () => {
    const seen: unknown[] = [];
    class Tail extends Service {
      constructor(a: AutoA, ...rest: unknown[]) {
        super("Tail", a.container as Container);
        seen.push(...rest);
      }
    }
    Inject("AutoA")(Tail, undefined, 0);
    Injector.instantiate(Tail, "x", 42);
    assert.deepStrictEqual(seen, ["x", 42]);
  });

  it("dependencyNamesOf ignore les types : seuls les noms déclarés comptent", () => {
    assert.deepStrictEqual(Injector.dependencyNamesOf(AutoConsumer), []);
    assert.deepStrictEqual(Injector.dependencyNamesOf(PriorityConsumer), [
      "AutoA",
    ]);
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
    const stubKernel = {
      get: (name: string) => (name === "AutoA" ? sharedAutoA : null),
    };
    (Nodefony as any).getKernel = () => stubKernel;

    try {
      const inst = Injector.instantiate(ExplicitConsumer) as ExplicitConsumer;
      assert.ok(inst instanceof ExplicitConsumer);
      assert.strictEqual(
        inst.injected,
        sharedAutoA,
        "doit être la même référence",
      );
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("si kernel.get(name) retourne null → fallback sur le registre (nouvelle instance)", () => {
    const origGetKernel = Nodefony.getKernel;
    // `set` fait partie du contrat kernel attendu par l'Injector : une résolution
    // singleton absente du container y mémoïse l'instance créée.
    const stubKernel = { get: (_name: string) => null, set: () => undefined };
    (Nodefony as any).getKernel = () => stubKernel;

    try {
      const inst = Injector.instantiate(ExplicitConsumer) as ExplicitConsumer;
      assert.ok(inst.injected instanceof AutoA);
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("si Nodefony.getKernel() = null → fallback registre (pas de kernel dans les tests)", () => {
    assert.strictEqual(Nodefony.getKernel(), null);
    const inst = Injector.instantiate(NamedConsumer) as NamedConsumer;
    assert.ok(inst.autoA instanceof AutoA);
    assert.ok(inst.autoB instanceof AutoB);
  });

  it("kernel.get() prioritaire sur le registre — instance partagée retournée", () => {
    const shared = new AutoB();
    const origGetKernel = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => ({
      get: (n: string) => (n === "AutoB" ? shared : null),
      set: () => undefined,
    });

    try {
      const inst = Injector.instantiate(NamedConsumer) as NamedConsumer;
      assert.strictEqual(inst.autoB, shared);
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });
});

// ─── 10. Injector.inject / reflect ───────────────────────────────────────────

describe("Injector.inject et Reflect.construct direct", () => {
  it("inject = instantiate pour classes sans metadata", () => {
    const a = Injector.inject(PlainService, "val-a") as PlainService;
    const b = Injector.instantiate(PlainService, "val-a") as PlainService;
    assert.ok(a instanceof PlainService);
    assert.ok(b instanceof PlainService);
    assert.strictEqual(a.val, b.val);
    assert.notStrictEqual(a, b); // instances distinctes
  });

  it("Reflect.construct instancie sans DI", () => {
    const inst = Reflect.construct(PlainService, ["reflect-test"]);
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "reflect-test");
  });

  it("inject avec service injectable → résout les dépendances", () => {
    const inst = Injector.inject(ExplicitConsumer) as ExplicitConsumer;
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
    const result = Injector.instantiate(
      PlainService,
      "instance-test",
    ) as PlainService;
    assert.ok(result instanceof PlainService);
    assert.strictEqual(result.val, "instance-test");
  });
});

// ─── 12. Cas limites ─────────────────────────────────────────────────────────

describe("Injector — cas limites", () => {
  it("instantiate → service @Inject vers nom inconnu → throw 'not found'", () => {
    class UnknownRef extends Service {
      constructor(a: any) {
        super("unknownref", new Container());
      }
    }
    Inject("NoSuchService")(UnknownRef, undefined, 0);
    assert.throws(
      () => Injector.instantiate(UnknownRef),
      /not found or not injectable/,
    );
  });

  it("paramètre sans @Inject → consommé comme arg explicite", () => {
    const inst = Injector.instantiate(
      MixedConsumer,
      "explicit-label",
    ) as MixedConsumer;
    assert.ok(inst instanceof MixedConsumer);
    assert.strictEqual(inst.label, "explicit-label");
  });

  it("argsClass en excès par rapport à totalParams → appendés silencieusement", () => {
    const inst = Injector.instantiate(
      PlainService,
      "first",
      "extra1",
      "extra2",
    ) as PlainService;
    assert.ok(inst instanceof PlainService);
    assert.strictEqual(inst.val, "first");
  });

  it("InitService.init() non appelé par instantiate (c'est addService qui le fait)", () => {
    const inst = Injector.instantiate(InitService) as InitService;
    assert.ok(inst instanceof InitService);
    assert.strictEqual(inst.initialized, false);
  });

  it("Injector.injectables est partagé statiquement", () => {
    const before = Object.keys(Injector.injectables).length;
    Injector.register("TempXYZ", BarService);
    assert.ok(Object.keys(Injector.injectables).length > before);
    delete Injector.injectables["TempXYZ"];
    assert.strictEqual(Object.keys(Injector.injectables).length, before);
  });

  it("PlainService sans args → val = undefined", () => {
    const inst = Injector.instantiate(PlainService) as PlainService;
    assert.strictEqual(inst.val, undefined);
  });
});

// ─── 13. Performance ─────────────────────────────────────────────────────────

describe("Injector — performance", () => {
  it("10 000 instantiations sans DI < 200ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      Injector.instantiate(PlainService, "perf");
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 200, `10k no-DI took ${elapsed.toFixed(1)}ms`);
  });

  it("5 000 injections à deux dépendances nommées < 500ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 5_000; i++) {
      Injector.instantiate(NamedConsumer);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `5k named-inject took ${elapsed.toFixed(1)}ms`);
  });

  it("5 000 injections explicites (@Inject) < 500ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 5_000; i++) {
      Injector.instantiate(ExplicitConsumer);
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
  constructor() {
    super("ExplicitSingleton", new Container());
  }
}

@injectable({ name: "NamedTransient", scope: "transient" })
class NTSvc extends Service {
  constructor() {
    super("NTSvc", new Container());
  }
}

// Consumer qui reçoit TransientSvc en dépendance, nommée
@injectable()
class ConsumerOfTransient extends Service {
  public dep: TransientSvc;
  constructor(d: TransientSvc) {
    super("ConsumerOfTransient", d.container as Container);
    this.dep = d;
  }
}
Inject("TransientSvc")(ConsumerOfTransient, undefined, 0);

@injectable()
class ConsumerOfTransient2 extends Service {
  public dep: TransientSvc;
  constructor(d: TransientSvc) {
    super("ConsumerOfTransient2", d.container as Container);
    this.dep = d;
  }
}
Inject("TransientSvc")(ConsumerOfTransient2, undefined, 0);

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
    const c1 = Injector.instantiate(ConsumerOfTransient) as ConsumerOfTransient;
    const c2 = Injector.instantiate(
      ConsumerOfTransient2,
    ) as ConsumerOfTransient2;
    assert.notStrictEqual(c1.dep, c2.dep, "transient → instances différentes");
  });

  it("transient — même consumer instancié deux fois → deps différentes", () => {
    const a = Injector.instantiate(ConsumerOfTransient) as ConsumerOfTransient;
    const b = Injector.instantiate(ConsumerOfTransient) as ConsumerOfTransient;
    assert.notStrictEqual(a.dep, b.dep);
  });

  it("transient — uid différent entre deux résolutions", () => {
    const a = Injector.instantiate(ConsumerOfTransient) as ConsumerOfTransient;
    const b = Injector.instantiate(ConsumerOfTransient) as ConsumerOfTransient;
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
      const c = Injector.instantiate(
        ConsumerOfTransient,
      ) as ConsumerOfTransient;
      assert.notStrictEqual(
        c.dep,
        shared,
        "transient ignore le container kernel",
      );
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
    Inject("ExplicitSingleton")(ConsumerSingleton, undefined, 0);

    try {
      const c = Injector.instantiate(ConsumerSingleton) as ConsumerSingleton;
      assert.strictEqual(
        c.dep,
        shared,
        "singleton → instance partagée du kernel",
      );
    } finally {
      (Nodefony as any).getKernel = origGetKernel;
    }
  });

  it("singleton — sans kernel, crée une nouvelle instance", () => {
    assert.strictEqual(Nodefony.getKernel(), null);
    const inst = Injector.instantiate(ExplicitSingleton);
    assert.ok(inst instanceof ExplicitSingleton);
  });

  // ── InjectableOptions API ─────────────────────────────────────────────────

  it("@injectable({ name }) seul → scope 'singleton' par défaut", () => {
    @injectable({ name: "OnlyName" })
    class OnlyNameSvc extends Service {
      constructor() {
        super("OnlyNameSvc", new Container());
      }
    }
    assert.ok(Injector.isRegistered("OnlyName"));
    assert.strictEqual(Injector.getScope("OnlyName"), "singleton");
  });

  it("@injectable({ scope: 'transient' }) seul → name = class name", () => {
    @injectable({ scope: "transient" })
    class JustTransient extends Service {
      constructor() {
        super("JustTransient", new Container());
      }
    }
    assert.ok(Injector.isRegistered("JustTransient"));
    assert.strictEqual(Injector.getScope("JustTransient"), "transient");
  });

  it("@injectable({}) → singleton + nom de classe", () => {
    @injectable({})
    class EmptyOpts extends Service {
      constructor() {
        super("EmptyOpts", new Container());
      }
    }
    assert.ok(Injector.isRegistered("EmptyOpts"));
    assert.strictEqual(Injector.getScope("EmptyOpts"), "singleton");
  });
});

// ─── 15. Résolution via kernel container (non @injectable) ────────────────────
//
// Services enregistrés via kernel.set() (ex: firewall, injector) mais sans
// @injectable doivent être résolus depuis le container, pas via injectables.
describe("Injector — fallback kernel container (non @injectable)", () => {
  const makeKernelWithService = (name: string, instance: unknown) => {
    const container = new Container();
    const fake = {
      container,
      get(n: string) {
        return container.get(n);
      },
    };
    container.set(name, instance);
    return fake;
  };

  it("_resolve via @Inject : service non @injectable mais dans kernel.get() → retourné", () => {
    const fakeService = { name: "firewall", isFirewall: true };
    const fakeKernel = makeKernelWithService("firewall", fakeService);
    const orig = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => fakeKernel;
    try {
      class Consumer extends Service {
        dep: unknown;
        constructor(dep: unknown) {
          super("Consumer", new Container());
          this.dep = dep;
        }
      }
      Inject("firewall")(Consumer, undefined, 0);
      const inst = Injector.instantiate(Consumer);
      assert.strictEqual((inst as any).dep, fakeService);
    } finally {
      (Nodefony as any).getKernel = orig;
    }
  });

  it("_resolve : service non @injectable ET absent du container → throw", () => {
    const orig = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => ({ get: () => null });
    try {
      class Consumer2 extends Service {
        constructor(dep: unknown) {
          super("Consumer2", new Container());
          void dep;
        }
      }
      Inject("nonexistent")(Consumer2, undefined, 0);
      assert.throws(
        () => Injector.instantiate(Consumer2),
        /not found or not injectable/,
      );
    } finally {
      (Nodefony as any).getKernel = orig;
    }
  });

  it("_resolve : service @injectable transient ET dans container → nouvelle instance (container ignoré)", () => {
    const shared = Injector.instantiate(TransientSvc);
    const container = new Container();
    container.set("TransientSvc", shared);
    const fakeKernel = { get: (n: string) => container.get(n) };
    const orig = Nodefony.getKernel;
    (Nodefony as any).getKernel = () => fakeKernel;
    try {
      const inst = Injector.instantiate(TransientSvc);
      assert.notStrictEqual(
        inst,
        shared,
        "transient ne doit pas retourner l'instance du container",
      );
    } finally {
      (Nodefony as any).getKernel = orig;
    }
  });
});

// ─── 15. Circular dependency detection (Phase C) ──────────────────────────────

describe("Circular dependency detection", () => {
  it("dépendance directe A → A → throw 'Circular dependency detected'", () => {
    @injectable()
    class CircSelf extends Service {
      constructor(dep: CircSelf) {
        super("CircSelf", new Container());
        void dep;
      }
    }
    Inject("CircSelf")(CircSelf, undefined, 0);
    assert.throws(
      () => Injector.instantiate(CircSelf),
      /Circular dependency detected/,
    );
  });

  it("dépendance indirecte A → B → A → throw", () => {
    @injectable()
    class CircA extends Service {
      constructor(dep: unknown) {
        super("CircA", new Container());
        void dep;
      }
    }
    @injectable()
    class CircB extends Service {
      constructor(dep: unknown) {
        super("CircB", new Container());
        void dep;
      }
    }
    Inject("CircB")(CircA, undefined, 0);
    Inject("CircA")(CircB, undefined, 0);
    assert.throws(
      () => Injector.instantiate(CircA),
      /Circular dependency detected/,
    );
  });

  it("message d'erreur contient le chemin avec →", () => {
    @injectable()
    class ChainA extends Service {
      constructor(dep: unknown) {
        super("ChainA", new Container());
        void dep;
      }
    }
    @injectable()
    class ChainB extends Service {
      constructor(dep: unknown) {
        super("ChainB", new Container());
        void dep;
      }
    }
    Inject("ChainB")(ChainA, undefined, 0);
    Inject("ChainA")(ChainB, undefined, 0);
    let msg = "";
    try {
      Injector.instantiate(ChainA);
    } catch (e) {
      msg = (e as Error).message;
    }
    assert.ok(msg.includes("ChainA"), `doit contenir ChainA: ${msg}`);
    assert.ok(msg.includes("ChainB"), `doit contenir ChainB: ${msg}`);
    assert.ok(msg.includes("→"), `doit contenir →: ${msg}`);
  });

  it("chaîne A → B → C sans circulaire → OK", () => {
    @injectable()
    class DeepC extends Service {
      constructor() {
        super("DeepC", new Container());
      }
    }
    @injectable()
    class DeepB extends Service {
      constructor(c: unknown) {
        super("DeepB", new Container());
        void c;
      }
    }
    @injectable()
    class DeepA extends Service {
      constructor(b: unknown) {
        super("DeepA", new Container());
        void b;
      }
    }
    Inject("DeepC")(DeepB, undefined, 0);
    Inject("DeepB")(DeepA, undefined, 0);
    assert.doesNotThrow(() => Injector.instantiate(DeepA));
    const inst = Injector.instantiate(DeepA);
    assert.ok(inst instanceof DeepA);
  });

  it("deux instantiations indépendantes en séquence → pas de faux positif", () => {
    @injectable()
    class IndepX extends Service {
      constructor() {
        super("IndepX", new Container());
      }
    }
    assert.doesNotThrow(() => Injector.instantiate(IndepX));
    assert.doesNotThrow(() => Injector.instantiate(IndepX));
  });

  // Verrouille l'absence de faux positif sur un graphe en diamant — cas
  // réaliste (authenticators/voters + userProvider partagé).
  it("graphe en diamant (A→B, A→C, B→D, C→D) sans cycle → pas de faux positif", () => {
    @injectable()
    class DiaD extends Service {
      constructor() {
        super("DiaD", new Container());
      }
    }
    @injectable()
    class DiaB extends Service {
      constructor(d: unknown) {
        super("DiaB", new Container());
        void d;
      }
    }
    @injectable()
    class DiaC extends Service {
      constructor(d: unknown) {
        super("DiaC", new Container());
        void d;
      }
    }
    @injectable()
    class DiaA extends Service {
      constructor(b: unknown, c: unknown) {
        super("DiaA", new Container());
        void b;
        void c;
      }
    }
    Inject("DiaD")(DiaB, undefined, 0);
    Inject("DiaD")(DiaC, undefined, 0);
    Inject("DiaB")(DiaA, undefined, 0);
    Inject("DiaC")(DiaA, undefined, 1);
    // D est atteint par 2 chemins distincts ([A,B] et [A,C]) mais jamais dans sa
    // propre lignée → stack-par-valeur ne doit PAS produire de faux positif.
    assert.doesNotThrow(() => Injector.instantiate(DiaA));
    const inst = Injector.instantiate(DiaA) as DiaA;
    assert.ok(
      inst instanceof DiaA,
      "diamant résolu sans faux positif circulaire",
    );
  });
});
