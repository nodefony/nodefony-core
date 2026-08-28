import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import Kernel from "../kernel/Kernel";
import { ReadinessRegistry } from "../kernel/readinessRegistry";

/**
 * SPEC — « un pod qui écoute n'est pas un pod qui peut servir ».
 *
 * Le registre de disponibilité donne à un composant qui a un état d'amorçage le
 * seul mot qui lui manquait : « pas encore ». Trois propriétés le rendent
 * utilisable sur le chemin le plus chaud du framework, et ce sont elles que ces
 * cas figent :
 *
 * 1. **un seul suffit à retenir**, et il faut TOUS les prêts pour libérer ;
 * 2. **le verdict est déjà calculé** — le lire est un entier, la sonde ne
 *    déclenche rien et ne peut donc tomber avec aucune dépendance ;
 * 3. **rien n'est alloué tant que personne ne s'inscrit**, et tout est LIBÉRÉ
 *    quand le dernier se retire — un cycle démarrage/arrêt répété n'empile rien.
 */

// `initCluster` écrit sur la sortie standard à la construction d'un Kernel.
let origConsoleLog: typeof console.log;
beforeAll(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = origConsoleLog;
});

const mkKernel = (): Kernel =>
  new Kernel("development", null, { log: { active: false } });

/** Le champ privé, lu pour PROUVER la libération — pas seulement son effet. */
const registryOf = (kernel: Kernel): ReadinessRegistry | null =>
  (kernel as unknown as { readiness: ReadinessRegistry | null }).readiness;

describe("ReadinessRegistry — l'agrégat, tenu à l'écriture", () => {
  it("un seul contributeur non prêt retient, tous prêts libèrent", () => {
    const reg = new ReadinessRegistry();
    reg.set("schema", true);
    reg.set("cache", true);
    reg.set("upstream", true);
    expect(reg.blocked).to.equal(0);

    reg.set("cache", false, "cache froid");
    expect(reg.blocked).to.equal(1);
    expect(
      reg
        .report()
        .filter((c) => !c.ready)
        .map((c) => c.name),
    ).to.deep.equal(["cache"]);

    // Les deux autres restent prêts : le verdict agrégé reste RETENU.
    reg.set("schema", true);
    reg.set("upstream", true);
    expect(reg.blocked).to.equal(1);

    reg.set("cache", true);
    expect(reg.blocked).to.equal(0);
    expect(reg.report().filter((c) => !c.ready)).to.deep.equal([]);
  });

  it("le même nom réenregistré ne compte QU'UNE voix", () => {
    const reg = new ReadinessRegistry();
    reg.set("schema", false, "en retard");
    reg.set("schema", false, "toujours en retard");
    reg.set("schema", false, "encore");
    expect(reg.size).to.equal(1);
    expect(reg.blocked).to.equal(1);

    // Un seul geste suffit alors à libérer — s'il avait compté trois voix, le
    // pod serait resté retenu pour toujours.
    reg.set("schema", true);
    expect(reg.blocked).to.equal(0);
  });

  it("signale la BASCULE du verdict agrégé, et elle seule", () => {
    const reg = new ReadinessRegistry();
    expect(reg.set("a", false, "x")).to.equal(true); // libre → retenu
    expect(reg.set("b", false, "y")).to.equal(false); // déjà retenu
    expect(reg.set("a", false, "z")).to.equal(false); // même verdict
    expect(reg.set("a", true)).to.equal(false); // b retient encore
    expect(reg.set("b", true)).to.equal(true); // retenu → libre
  });

  it("retirer un contributeur retenant libère (et retirer un inconnu ne fait rien)", () => {
    const reg = new ReadinessRegistry();
    reg.set("schema", false, "en retard");
    expect(reg.clear("inconnu")).to.equal(false);
    expect(reg.blocked).to.equal(1);
    expect(reg.clear("schema")).to.equal(true);
    expect(reg.blocked).to.equal(0);
    expect(reg.size).to.equal(0);
  });

  it("restitue la raison de ceux qui retiennent, et l'efface quand ils libèrent", () => {
    const reg = new ReadinessRegistry();
    reg.set("schema", false, "3 migrations en attente");
    expect(reg.report()).to.deep.equal([
      { name: "schema", ready: false, reason: "3 migrations en attente" },
    ]);
    reg.set("schema", true);
    expect(reg.report()).to.deep.equal([{ name: "schema", ready: true }]);
  });
});

describe("Kernel — le registre naît au premier inscrit et meurt avec le dernier", () => {
  it("aucun inscrit : rien n'est alloué, et la disponibilité est acquise", () => {
    const kernel = mkKernel();
    expect(registryOf(kernel)).to.equal(null);
    expect(kernel.readinessBlocked).to.equal(0);
    expect(kernel.readinessReport()).to.deep.equal([]);
    // Retirer un contributeur jamais inscrit n'alloue rien non plus.
    kernel.clearReadiness("jamais-vu");
    expect(registryOf(kernel)).to.equal(null);
  });

  it("un contributeur retient la mise en service, puis la libère", () => {
    const kernel = mkKernel();
    kernel.setReadiness("drizzle:schema", false, "2 migrations en attente");
    expect(kernel.readinessBlocked).to.equal(1);
    expect(kernel.readinessReport()).to.deep.equal([
      {
        name: "drizzle:schema",
        ready: false,
        reason: "2 migrations en attente",
      },
    ]);

    kernel.setReadiness("drizzle:schema", true);
    expect(kernel.readinessBlocked).to.equal(0);
  });

  it("10 cycles inscription/retrait n'empilent RIEN — le registre est libéré", () => {
    const kernel = mkKernel();
    for (let i = 0; i < 10; i++) {
      kernel.setReadiness("drizzle:schema", false, "en retard");
      kernel.setReadiness("cache", false, "froid");
      expect(kernel.readinessBlocked).to.equal(2);
      kernel.clearReadiness("drizzle:schema");
      kernel.clearReadiness("cache");
      expect(kernel.readinessBlocked).to.equal(0);
      expect(kernel.readinessReport()).to.have.length(0);
      // Le point qui compte : le registre lui-même a disparu, la sonde retrouve
      // le coût qu'elle avait avant toute inscription.
      expect(registryOf(kernel)).to.equal(null);
    }
  });

  /**
   * Le contrat lui-même interdit la sonde ACTIVE — et c'est ce qui garantit
   * qu'aucune dépendance ne peut faire tomber `/readyz` avec elle. On ne peut
   * pas confier au registre « quelque chose à exécuter » : il ne prend qu'un
   * booléen déjà décidé. Vérifié par `npm run typecheck` (tsgo) : le jour où
   * quelqu'un élargit la signature, ce `@ts-expect-error` cesse de mordre et la
   * passe de types échoue.
   */
  function _typeOnly(): void {
    const kernel = mkKernel();
    // @ts-expect-error une VÉRIFICATION n'est pas un verdict — interdite ici.
    kernel.setReadiness("schema", () => true);
    // @ts-expect-error une promesse non plus : la sonde n'attend jamais rien.
    kernel.setReadiness("schema", Promise.resolve(true));
  }
  void _typeOnly;

  it("un contributeur inscrit PRÊT n'empêche pas les autres de retenir", () => {
    const kernel = mkKernel();
    kernel.setReadiness("cache", true);
    expect(kernel.readinessBlocked).to.equal(0);
    // Il est bien inscrit : c'est lui qui, plus tard, dira « plus prêt ».
    expect(kernel.readinessReport()).to.have.length(1);
    kernel.setReadiness("cache", false, "vidé");
    expect(kernel.readinessBlocked).to.equal(1);
  });
});
