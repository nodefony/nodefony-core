import assert from "node:assert/strict";
import { Orm } from "../../nodefony/src/Orm";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { connectionMonitor } from "../../nodefony/src/ConnectionMonitor";
import { buildOrmLeanHealth } from "../../nodefony/src/buildOrmLeanHealth";
import type {
  IRepository,
  ITransaction,
} from "../../nodefony/interfaces/index";

/**
 * **Ce qu'un adapter ORM doit fournir — et surtout ce qu'il n'est PAS obligé
 * de fournir.**
 *
 * Question posée par l'auteur du framework, et à laquelle ce fichier répond par
 * l'exécution : « si on change ou ajoute un ORM, y aura-t-il des problèmes de
 * compatibilité ? » Un contrat de résilience mal conçu se paie exactement là —
 * au moment où quelqu'un branche Prisma, Kysely ou un driver maison.
 *
 * La garantie tenue ici : un adapter qui implémente le STRICT minimum
 * historique (`onConnect`, `disconnect`, `getRepository`, `transaction`,
 * `getNativeConnection`) fonctionne, sans connaître un seul des mécanismes
 * ajoutés pour la résilience — et surtout, son ignorance est VISIBLE au lieu
 * d'être maquillée en certitude.
 */

/** Adapter minimal — exactement ce qu'un ORM tiers écrirait, sans plus. */
class AdapterMinimal extends Orm {
  protected async onConnect(): Promise<void> {
    /* un driver quelconque */
  }
  async disconnect(): Promise<void> {
    this.alive = false;
  }
  getRepository<T = unknown>(): IRepository<T> {
    return {} as IRepository<T>;
  }
  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    return work({} as ITransaction);
  }
  getNativeConnection<C = unknown>(): C {
    return null as C;
  }
}

/** Adapter qui, lui, sait traduire les signaux de son driver. */
class AdapterAvecSignaux extends AdapterMinimal {
  override get liveness(): "events" | "assumed" {
    return "events";
  }
  perdre(raison: string): void {
    this.connectionLost(raison);
  }
  reprendre(): void {
    this.connectionRestored();
  }
}

describe("Orm — compatibilité d'un adapter TIERS", () => {
  const noms: string[] = [];
  const mk = <T extends Orm>(f: (n: string) => T, n: string): T => {
    noms.push(n);
    return f(n);
  };
  afterEach(() => {
    for (const n of noms.splice(0)) {
      ormRegistry.unregister(n);
    }
  });

  it("un adapter MINIMAL se connecte sans rien savoir de la résilience", async () => {
    const orm = mk((n) => new AdapterMinimal(n), "compat-minimal");
    await orm.connect();
    assert.equal(orm.isConnected(), true);
    await orm.disconnect();
    assert.equal(orm.isConnected(), false);
  });

  it("un adapter MINIMAL est compté SUPPOSÉ vivant, jamais constaté", async () => {
    const base = buildOrmLeanHealth();
    const orm = mk((n) => new AdapterMinimal(n), "compat-suppose");
    await orm.connect();
    const apres = buildOrmLeanHealth();
    assert.equal(apres.connected - base.connected, 1);
    assert.equal(
      apres.assumed - base.assumed,
      1,
      "sans signal de driver, l'état est une SUPPOSITION et doit se dire tel quel",
    );
  });

  it("un adapter qui TRADUIT ses signaux est compté constaté", async () => {
    const base = buildOrmLeanHealth();
    const orm = mk((n) => new AdapterAvecSignaux(n), "compat-constate");
    await orm.connect();
    const apres = buildOrmLeanHealth();
    assert.equal(apres.connected - base.connected, 1);
    assert.equal(apres.assumed - base.assumed, 0);
  });

  it("le défaut de `liveness` est le PRUDENT — un oubli ne se lit pas comme un constat", () => {
    const orm = mk((n) => new AdapterMinimal(n), "compat-defaut");
    assert.equal(orm.liveness, "assumed");
  });

  it("un ORM du registre qui n'étend même pas `Orm` est compté SUPPOSÉ", () => {
    const base = buildOrmLeanHealth();
    // Cas d'un adapter qui implémente `IOrm` sans hériter de la classe de base.
    ormRegistry.register("compat-etranger", {
      name: "compat-etranger",
      isConnected: () => true,
    } as never);
    noms.push("compat-etranger");
    const apres = buildOrmLeanHealth();
    assert.equal(apres.connected - base.connected, 1);
    assert.equal(
      apres.assumed - base.assumed,
      1,
      "aucune information ⇒ supposé ; l'absence de preuve n'est pas une preuve",
    );
  });

  it("aucun compteur de résilience ne bouge pour un adapter qui n'en fait rien", async () => {
    const orm = mk((n) => new AdapterMinimal(n), "compat-compteurs");
    await orm.connect();
    const s = connectionMonitor.snapshot("compat-compteurs");
    assert.equal(s.connectCount, 1);
    assert.equal(s.reconnectCount, 0, "un boot n'est pas une reprise");
    assert.equal(s.lostCount, 0);
    assert.equal(s.errorCount, 0);
  });

  it("le contrat n'exige AUCUNE méthode neuve : la surface abstraite est inchangée", () => {
    // Si l'un de ces membres devenait abstrait, tout adapter tiers cesserait de
    // compiler — c'est le coût qu'on refuse de faire porter à l'ajout d'un ORM.
    // `AdapterMinimal` ne déclare rien d'autre que l'historique, et il compile.
    const orm = mk((n) => new AdapterMinimal(n), "compat-surface");
    assert.equal(typeof orm.isConnected, "function");
    assert.equal(typeof orm.connect, "function");
    assert.equal(typeof orm.liveness, "string");
  });
});
