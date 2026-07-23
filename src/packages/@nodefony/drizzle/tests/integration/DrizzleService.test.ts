import assert from "node:assert/strict";
import { ormRegistry } from "@nodefony/orm-core";
import type { Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

// Le Service est testé HORS kernel : un module mock fournit la config Zod déjà
// validée (`drizzleConfig`). On exerce connectAll/disconnectAll/getOrm — la
// logique d'orchestration NÔTRE — sans booter un vrai Kernel.
const makeModule = (drizzleConfig: unknown): Module =>
  ({
    // Le service lit sa config via `this.module.config` (getter uniforme).
    config: drizzleConfig,
    // Le service pose sa connexion AU NOM du module (`Module.hookKernel`) pour
    // en hériter la criticité de boot. Ces bancs appellent `connectAll()` en
    // direct, sans cycle de vie : le hook n'a rien à déclencher, mais il doit
    // exister — un double qui omet un membre du contrat fait échouer le
    // constructeur, pas le comportement testé.
    hookKernel: () => undefined,
  }) as unknown as Module;

describe("DrizzleService — orchestration boot (hors kernel)", () => {
  afterEach(() => {
    ormRegistry.unregister("svc_a");
    ormRegistry.unregister("svc_b");
  });

  it("connectAll : instancie + connecte un ORM par connecteur (enregistré dans ormRegistry)", async () => {
    const service = new DrizzleService(
      makeModule({ connectors: { svc_a: { filename: ":memory:" } } }),
    );
    await service.connectAll();

    const orm = service.getOrm("svc_a");
    assert.ok(orm, "ORM du connecteur absent");
    assert.equal(orm.isConnected(), true);
    assert.equal(ormRegistry.has("svc_a"), true);

    await service.disconnectAll();
  });

  it("connectAll : plusieurs connecteurs → un ORM chacun", async () => {
    const service = new DrizzleService(
      makeModule({
        connectors: {
          svc_a: { filename: ":memory:" },
          svc_b: { filename: ":memory:" },
        },
      }),
    );
    await service.connectAll();
    assert.equal(service.getOrm("svc_a")?.isConnected(), true);
    assert.equal(service.getOrm("svc_b")?.isConnected(), true);
    await service.disconnectAll();
  });

  it("disconnectAll : ferme tout et vide le registre interne", async () => {
    const service = new DrizzleService(
      makeModule({ connectors: { svc_a: { filename: ":memory:" } } }),
    );
    await service.connectAll();
    await service.disconnectAll();
    assert.equal(service.getOrm("svc_a"), undefined);
  });

  it("config absente / sans connecteurs → connectAll ne fait rien (pas de crash)", async () => {
    const service = new DrizzleService(makeModule(undefined));
    await service.connectAll(); // #config() undefined → connectors {} → no-op
    assert.equal(service.getOrm("svc_a"), undefined);
  });

  it("connecteur configuré INJOIGNABLE → BootConfigurationError (boot fatal, jamais de dégradation silencieuse)", async () => {
    // postgres vers un port fermé : l'utilisateur a DÉCLARÉ cette infra → un
    // échec de connexion est une erreur de CONFIGURATION, fatale dev ET prod
    // (le kernel interrompt le boot sur BootConfigurationError — vécu : ORM
    // default mort en fail-soft = session/users/tokens morts, login impossible).
    const service = new DrizzleService(
      makeModule({
        connectors: {
          svc_dead: {
            dialect: "postgres",
            url: "postgres://nobody:wrong@127.0.0.1:1/nodefony",
          },
        },
      }),
    );
    await assert.rejects(
      () => service.connectAll(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "BootConfigurationError");
        assert.match(err.message, /svc_dead/, "nomme le connecteur");
        assert.match(err.message, /postgres/, "nomme le dialecte");
        assert.doesNotMatch(
          err.message,
          /nobody:wrong/,
          "l'URL est RÉDIGÉE (jamais de credentials dans l'erreur)",
        );
        return true;
      },
    );
    assert.equal(service.getOrm("svc_dead"), undefined);
  });
});
