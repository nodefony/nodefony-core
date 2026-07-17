/* eslint-disable @typescript-eslint/no-explicit-any */
//
// ─── RED-TEAM — brique « injection de dépendances » ───────────────────────────
//
// Matrice d'attaque conçue depuis l'ARCHITECTURE (actif × chemin), pas depuis
// l'implémentation — un test d'attaque n'a de valeur que s'il PEUT virer au
// rouge sur une implémentation vulnérable.
//
// Actifs   : le registre `injectables` · l'identité/l'état des instances ·
//            le container kernel · les métadonnées Reflect (`di:scope`).
// Chemins  : @injectable (register) · @inject (par nom) · auto-injection par
//            TYPE (`design:paramtypes`) · @Inject (propriété) · Module.addService.
//
// Invariant central du scope `singleton` : **deux résolutions du même service
// rendent la MÊME instance**. C'est ce que le nom promet à l'appelant.
//
import "reflect-metadata";
import assert from "node:assert";
import Injector from "../kernel/injector/injector";
import Service from "../Service";
import Container from "../Container";
import Event from "../Event";
import { injectable } from "../kernel/decorators/kernelDecorator";
import { Nodefony } from "../Nodefony";

/** Accès au registre interne — c'est l'actif qu'on attaque. */
const registry = () => Injector.injectables as Record<string, any>;

/** Retire une entrée du registre (le registre est un singleton de module). */
const unregister = (...names: string[]) => {
  for (const n of names) delete registry()[n];
};

/**
 * Kernel factice minimal : `get`/`set` sur une map — le contrat que l'Injector
 * attend réellement du container (le vrai Kernel les tient de `Service`).
 * Rend le mock au travers d'un `try/finally` qui restaure `getKernel`.
 */
const withKernel = <T>(seed: Record<string, unknown>, fn: () => T): T => {
  const store = new Map(Object.entries(seed));
  const orig = Nodefony.getKernel;
  (Nodefony as any).getKernel = () => ({
    get: (n: string) => store.get(n) ?? null,
    set: (n: string, v: unknown) => store.set(n, v),
  });
  try {
    return fn();
  } finally {
    (Nodefony as any).getKernel = orig;
  }
};

// ─── A. Registre — hijack d'un nom déjà pris ─────────────────────────────────

describe("RED-TEAM Injector — A. hijack du registre", () => {
  class VictimSvc extends Service {
    constructor() {
      super("VictimSvc", new Container());
    }
    public readonly kind = "victim";
  }
  class AttackerSvc extends Service {
    constructor() {
      super("AttackerSvc", new Container());
    }
    public readonly kind = "attacker";
  }

  afterEach(() => unregister("HijackTarget"));

  // CONTRAT ASSUMÉ (gravé aussi par `Injector.test.ts` — « register doublon →
  // écrase l'ancien ») : le dernier enregistré gagne, pour qu'une app puisse
  // surcharger un service du framework.
  //
  // Ce n'est PAS une élévation de privilège : qui peut appeler `@injectable`
  // exécute déjà du code arbitraire dans le process — aucune frontière de
  // confiance n'est franchie. Le risque réel est la COLLISION ACCIDENTELLE de
  // noms, silencieuse. Le garde-fou est la visibilité, pas l'interdiction —
  // `Module.addService` logge déjà un WARNING quand il écrase un service du
  // container ; le registre, lui, n'a pas de logger (API statique).
  it("A1 — sentinelle : le dernier register() gagne (override assumé)", () => {
    Injector.register("HijackTarget", VictimSvc as any);
    Injector.register("HijackTarget", AttackerSvc as any);

    assert.strictEqual(
      Injector.get("HijackTarget"),
      AttackerSvc as any,
      "l'override du registre est un contrat : si ce test change, c'est une " +
        "décision de design, pas un accident",
    );
  });
});

// ─── B. Pollution de prototype du registre ───────────────────────────────────
//
// `injectables` est-il un dictionnaire SÛR ? Un objet littéral hérite de
// Object.prototype : ses membres deviennent des « services » fantômes que
// personne n'a enregistrés.

describe("RED-TEAM Injector — B. pollution de prototype du registre", () => {
  class PollutionSvc extends Service {
    constructor() {
      super("PollutionSvc", new Container());
    }
  }

  // Prototype légitime du registre, capturé AVANT toute attaque : le cleanup le
  // restaure tel quel. (Ne jamais « réparer » vers Object.prototype en dur — ce
  // serait réintroduire soi-même la pollution qu'on prétend interdire.)
  const pristineProto = Object.getPrototypeOf(registry());

  afterEach(() => {
    unregister("constructor");
    if (Object.getPrototypeOf(registry()) !== pristineProto) {
      Object.setPrototypeOf(registry(), pristineProto);
    }
  });

  for (const ghost of [
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
  ]) {
    it(`B1 — isRegistered("${ghost}") doit être FAUX (aucun service ne porte ce nom)`, () => {
      assert.strictEqual(
        Injector.isRegistered(ghost),
        false,
        `"${ghost}" est hérité d'Object.prototype et se fait passer pour un service enregistré`,
      );
    });
  }

  it("B2 — get() sur un membre du prototype doit lever, pas rendre une fonction native", () => {
    assert.throws(
      () => Injector.get("toString"),
      /not found or not injectable/,
      "Injector.get('toString') a rendu Object.prototype.toString comme s'il " +
        "s'agissait d'un constructeur de service",
    );
  });

  it('B3 — register("__proto__") doit créer une CLÉ, pas déraciner le registre', () => {
    Injector.register("__proto__", PollutionSvc as any);

    assert.strictEqual(
      Object.getPrototypeOf(registry()),
      pristineProto,
      "register('__proto__') a remplacé le PROTOTYPE du registre au lieu d'y " +
        "poser une clé : le registre entier est corrompu",
    );
    assert.strictEqual(
      registry()["__proto__"],
      PollutionSvc as any,
      "'__proto__' doit être une clé ordinaire du registre",
    );
    assert.strictEqual(
      Injector.isRegistered("call"),
      false,
      "après pollution, les membres de Function.prototype (call/apply/bind) " +
        "répondent présents comme des services injectables",
    );
  });
});

// ─── C. Le contrat du scope « singleton » ────────────────────────────────────
//
// Le cœur du sujet : `singleton` promet UNE instance partagée.

// NB — portée réelle du scope : `Injector.instantiate(X)` CONSTRUIT toujours X
// (elle appelle `_instantiateWithStack` sans passer par la résolution). Le scope
// ne gouverne que les DÉPENDANCES résolues. L'invariant testable est donc :
// « deux consumers du même service singleton reçoivent la MÊME instance ».
describe("RED-TEAM Injector — C. contrat du scope singleton", () => {
  /** Service ALIGNÉ : son nom de classe EST sa clé container. */
  @injectable()
  class AlignedSvc extends Service {
    public readonly uid = Math.random();
    constructor() {
      super("AlignedSvc", new Container());
    }
  }

  const consumerOf = (dep: any, label: string) => {
    class Consumer extends Service {
      public dep: any;
      constructor(d: any) {
        super(label, new Container());
        this.dep = d;
      }
    }
    Reflect.defineMetadata("design:paramtypes", [dep], Consumer);
    return Consumer;
  };

  it("C1 — CONTRÔLE POSITIF : deux consumers d'un singleton DÉJÀ au container le partagent", () => {
    const shared = new AlignedSvc();
    withKernel({ AlignedSvc: shared }, () => {
      const a = Injector.instantiate<any>(consumerOf(AlignedSvc, "CA") as any);
      const b = Injector.instantiate<any>(consumerOf(AlignedSvc, "CB") as any);
      assert.strictEqual(a.dep, shared);
      assert.strictEqual(b.dep, shared, "deux consumers → même singleton");
    });
  });

  it("C2 — un singleton ABSENT du container est instancié UNE fois, puis partagé", () => {
    // Le cœur du contrat : personne ne l'a posé au container. La 1ʳᵉ résolution
    // l'instancie ET le mémoïse ; la 2ᵈᵉ doit retrouver la MÊME instance.
    withKernel({}, () => {
      const a = Injector.instantiate<any>(consumerOf(AlignedSvc, "CC") as any);
      const b = Injector.instantiate<any>(consumerOf(AlignedSvc, "CD") as any);

      assert.strictEqual(
        a.dep,
        b.dep,
        "le scope 'singleton' a rendu DEUX instances distinctes : tout état " +
          "porté par le service (cache, compteur, connexion) est dupliqué et perdu",
      );
    });
  });

  it("C2b — LIMITE ASSUMÉE : sans kernel, aucune mémoïsation possible", () => {
    // La mémoïsation range dans le container du kernel — qui meurt avec lui (pas
    // de cache statique : il fuirait d'un kernel à l'autre, tests compris). Sans
    // kernel, il n'existe donc AUCUN endroit où mémoriser : deux instances.
    assert.strictEqual(Nodefony.getKernel(), null);
    const a = Injector.instantiate<any>(consumerOf(AlignedSvc, "CE") as any);
    const b = Injector.instantiate<any>(consumerOf(AlignedSvc, "CF") as any);
    assert.notStrictEqual(a.dep, b.dep);
  });

  // LE trou historique : un service est enregistré au registre sous son NOM DE
  // CLASSE ("Router") mais rangé au container sous la clé de son `super()`
  // ("router"). Ces deux chaînes ne peuvent pas round-tripper — `@injectable`
  // s'exécute au CHARGEMENT de la classe, `super("router", …)` à la CONSTRUCTION.
  // Résolution par le NOM → `kernel.get("Router")` → null → service reconstruit,
  // cache vide, en silence. 1 seul des 7 `@injectable` y échappait (`HttpKernel`,
  // par coïncidence de casse).
  //
  // Depuis : le nom ne sert qu'à retrouver la CLASSE, et c'est ELLE qui dit où
  // l'instance vit (clé apprise quand le service est posé — cf. `addService`).
  it("C3 — nom divergent : le consumer reçoit le singleton du container, pas une copie", () => {
    @injectable()
    class DivergentSvc extends Service {
      public readonly uid = Math.random();
      constructor() {
        // Clé container DIFFÉRENTE du nom de classe — le cas de
        // Router("router") / SessionsService("sessions") / AdminBroker(…).
        super("divergentSvc", new Container());
      }
    }

    const shared = new DivergentSvc();
    class ConsumerByType extends Service {
      public dep: DivergentSvc;
      constructor(d: DivergentSvc) {
        super("ConsumerByType", new Container());
        this.dep = d;
      }
    }
    Reflect.defineMetadata("design:paramtypes", [DivergentSvc], ConsumerByType);

    try {
      // Ce que fait `Module.addService` en posant l'instance : il apprend le
      // couple (classe, clé). On le rejoue ici — le vrai flux est prouvé de bout
      // en bout par `services.attack.test.ts` H1/H2 (kernel + module réels).
      Injector.rememberContainerKey(DivergentSvc as any, "divergentSvc");

      // Le kernel ne le connaît que sous sa clé container réelle.
      withKernel({ divergentSvc: shared }, () => {
        const c = Injector.instantiate<any>(ConsumerByType as any);
        assert.strictEqual(
          c.dep,
          shared,
          "le consumer a reçu un service NEUF au lieu du singleton du container : " +
            "le nom de classe ne retrouve pas la clé container",
        );
      });
    } finally {
      unregister("DivergentSvc");
    }
  });
});

// ─── E. `Fetch` — le service core est POSÉ, pas seulement déclaré ────────────

describe("RED-TEAM Injector — E. Fetch est un vrai singleton", () => {
  it("E1 — construire l'Injector POSE une instance de Fetch au container du kernel", () => {
    // Déclarer sans poser laissait `kernel.get("Fetch")` vide → un `new Fetch()`
    // à chaque `@inject("Fetch")`, donc un service par requête (mesuré : 10
    // requêtes = 10 instances), construit avec le Context du controller au lieu
    // d'un Module. Poser l'instance ici est ce qui rend la branche container
    // atteignable — et donc le scope honnête.
    const store = new Map<string, unknown>();
    const container = new Container();
    const fakeKernel = {
      container,
      notificationsCenter: new Event(),
      set: (n: string, v: unknown) => store.set(n, v),
      get: (n: string) => store.get(n) ?? null,
    };

    new Injector(fakeKernel as any);

    const posed = store.get("Fetch");
    assert.ok(posed, "aucune instance de Fetch n'a été posée au container");
    assert.strictEqual((posed as Service).name, "Fetch");
    assert.ok(
      typeof (posed as any).fetch === "function",
      "l'instance posée doit exposer un fetch() utilisable",
    );
  });
});

// ─── D. Propagation des args aux dépendances ─────────────────────────────────

describe("RED-TEAM Injector — D. propagation d'argsClass aux dépendances", () => {
  it("D1 — les args du consumer ne doivent pas être injectés dans sa dépendance", () => {
    @injectable()
    class LeafSvc extends Service {
      public received: unknown;
      constructor(first?: unknown) {
        super("LeafSvc", new Container());
        this.received = first;
      }
    }

    class ParentSvc extends Service {
      public dep: LeafSvc;
      constructor(d: LeafSvc) {
        super("ParentSvc", new Container());
        this.dep = d;
      }
    }
    Reflect.defineMetadata("design:paramtypes", [LeafSvc], ParentSvc);

    const secret = { iAmTheParentsArgument: true };
    try {
      const p = Injector.instantiate<any>(ParentSvc as any, secret);
      assert.notStrictEqual(
        p.dep.received,
        secret,
        "l'argument destiné au PARENT a été passé au constructeur de sa " +
          "DÉPENDANCE : une dépendance reçoit un objet d'un type qu'elle " +
          "n'attend pas (ne tient que par duck-typing)",
      );
    } finally {
      unregister("LeafSvc");
    }
  });
});
