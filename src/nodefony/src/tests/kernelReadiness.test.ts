import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  vi,
} from "vitest";
import type { MockInstance } from "vitest";
import Kernel from "../kernel/Kernel";
import { KernelReadinessPublisher } from "../kernel/kernelReadiness";
import type { IReadinessContributor } from "../kernel/readinessRegistry";
import type { Pci, Severity } from "../syslog/Pdu";
import {
  readReadinessState,
  readinessStateFile,
} from "../service/dev/devProcess";

/**
 * Caractérisation de la famille READY du noyau (#488) : le journal de bascule,
 * la publication anti-réécriture sur disque, et la règle `servable` /
 * `readinessBlocked`. Les blocs « Kernel — … » ont été écrits et vus verts sur
 * le code d'ORIGINE avant tout déplacement : ils ne passent que par l'API
 * publique du Kernel (`setReadiness`, `clearReadiness`, `readinessReport`),
 * donc ils tiennent quel que soit l'endroit où vit l'implémentation. Les blocs
 * qui nomment le publieur (`KernelReadinessPublisher`, `readinessPublisher`)
 * sont nés avec l'extraction.
 *
 * Le registre lui-même (agrégat, laziness, libération, `blocking:false`) est
 * verrouillé par `readinessRegistry.test.ts` ; ici on ne couvre que ce qui
 * l'ENTOURE.
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

/** Racine temporaire : le noyau publie sous sa `path` (`process.cwd()` par défaut). */
let root = "";
let spies: MockInstance[] = [];

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "nf-kernel-ready-"));
});
afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  spies = [];
  rmSync(root, { recursive: true, force: true });
});

/** Kernel isolé + les appels à `log` posés depuis sa construction. */
function bench(): { kernel: Kernel; logged: () => unknown[][] } {
  const kernel = new Kernel("development", null, { log: { active: false } });
  kernel.path = root;
  const spy = vi.spyOn(kernel, "log");
  spies.push(spy);
  return { kernel, logged: () => spy.mock.calls };
}

const FREED = "Mise en service libérée — /readyz rend de nouveau 200";

describe("Kernel — le journal de bascule de la mise en service", () => {
  it("journalise UNE fois par changement du verdict AGRÉGÉ, pas à chaque pose", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("drizzle:schema", false, "2 migrations en attente");
    assert.deepEqual(logged(), [
      [
        "Mise en service RETENUE — /readyz rend 503 : drizzle:schema (2 migrations en attente)",
        "CRITIC",
      ],
    ]);
    // Même verdict reposé, ou second retenant : l'agrégat ne bouge pas.
    kernel.setReadiness("drizzle:schema", false, "2 migrations en attente");
    kernel.setReadiness("cache", false, "froid");
    assert.equal(logged().length, 1, "aucune bascule, donc aucune ligne");
  });

  it("dit « libérée » en INFO quand le dernier retenant se libère", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("drizzle:schema", false, "en retard");
    kernel.setReadiness("drizzle:schema", true);
    assert.deepEqual(logged()[1], [FREED, "INFO"]);
    assert.equal(logged().length, 2);
  });

  it("retirer le dernier retenant libère aussi — registre déjà vide au moment du journal", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("drizzle:schema", false, "en retard");
    kernel.clearReadiness("drizzle:schema");
    assert.deepEqual(logged()[1], [FREED, "INFO"]);
    assert.equal(logged().length, 2);
  });

  it("retirer un retenant quand un autre retient encore ne journalise rien", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("a", false, "x");
    kernel.setReadiness("b", false, "y");
    kernel.clearReadiness("a");
    assert.equal(logged().length, 1, "seule la bascule initiale est dite");
  });

  it("retirer un contributeur inconnu, ou sur un registre vide, ne journalise rien", () => {
    const { kernel, logged } = bench();
    kernel.clearReadiness("jamais-vu");
    kernel.setReadiness("a", false, "x");
    kernel.clearReadiness("jamais-vu");
    assert.equal(logged().length, 1);
  });

  it("une première pose « prête » ne bascule pas : le verdict agrégé reste « disponible »", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("cache", true);
    assert.deepEqual(logged(), []);
  });

  it("nomme les contributeurs triés avec leur raison, et omet la parenthèse sans raison", () => {
    const { kernel, logged } = bench();
    // `alpha` est non prêt mais NON bloquant : il ne fait pas basculer
    // l'agrégat, il est pourtant listé quand `zeta` bascule — le journal liste
    // tous les non-prêts (comportement d'origine, verrouillé tel quel).
    kernel.setReadiness("alpha", false, undefined, false);
    assert.deepEqual(logged(), []);
    kernel.setReadiness("zeta", false, "froid");
    assert.deepEqual(logged(), [
      [
        "Mise en service RETENUE — /readyz rend 503 : alpha, zeta (froid)",
        "CRITIC",
      ],
    ]);
  });

  it("rebasculer rejoue la ligne : retenue, libérée, retenue = trois lignes", () => {
    const { kernel, logged } = bench();
    kernel.setReadiness("a", false, "x");
    kernel.setReadiness("a", true);
    kernel.setReadiness("a", false, "y");
    assert.deepEqual(
      logged().map((c) => c[1]),
      ["CRITIC", "INFO", "CRITIC"],
    );
    assert.equal(
      logged()[2]?.[0],
      "Mise en service RETENUE — /readyz rend 503 : a (y)",
    );
  });
});

describe("Kernel — publication de l'état sur le disque (anti-réécriture)", () => {
  it("l'état identique reposé ne réécrit pas, y compris à travers un cycle retrait → pose", () => {
    const { kernel } = bench();
    kernel.setReadiness("a", false, "x");
    const file = readinessStateFile(root);
    writeFileSync(file, "SENTINELLE", "utf8");
    kernel.setReadiness("a", false, "x");
    assert.equal(readFileSync(file, "utf8"), "SENTINELLE");

    // Dernier contributeur parti : fichier effacé, signature de l'état vide.
    kernel.clearReadiness("a");
    assert.equal(existsSync(file), false);
    // Le même état qu'avant le retrait doit repartir sur le disque : la
    // signature mémorisée est celle de l'état VIDE, pas celle de « a ».
    kernel.setReadiness("a", false, "x");
    assert.equal(existsSync(file), true);
    assert.equal(readReadinessState(root)?.[0]?.reason, "x");
  });

  it("retirer un inconnu depuis un registre non vide n'écrit rien", () => {
    const { kernel } = bench();
    kernel.setReadiness("a", false, "x");
    const file = readinessStateFile(root);
    writeFileSync(file, "SENTINELLE", "utf8");
    kernel.clearReadiness("inconnu");
    assert.equal(readFileSync(file, "utf8"), "SENTINELLE");
  });

  it("un contributeur prêt est publié aussi (état dit, rien ne retient)", () => {
    const { kernel } = bench();
    kernel.setReadiness("cache", true);
    assert.deepEqual(readReadinessState(root), [
      { name: "cache", ready: true },
    ]);
    kernel.clearReadiness("cache");
    assert.equal(existsSync(readinessStateFile(root)), false);
  });

  it("la raison d'un contributeur redevenu prêt quitte le fichier", () => {
    const { kernel } = bench();
    kernel.setReadiness("a", false, "en retard");
    kernel.setReadiness("a", true);
    assert.deepEqual(readReadinessState(root), [{ name: "a", ready: true }]);
  });

  it("publie sous la `path` LUE À L'APPEL — posée après la construction", () => {
    const { kernel } = bench();
    const other = mkdtempSync(path.join(os.tmpdir(), "nf-kernel-ready-bis-"));
    try {
      // Le publieur naît sous `root` : une `path` mémorisée à sa construction
      // écrirait encore là après le changement.
      kernel.setReadiness("a", false, "x");
      assert.equal(existsSync(readinessStateFile(root)), true);
      kernel.path = other;
      kernel.setReadiness("a", false, "y");
      assert.equal(existsSync(readinessStateFile(other)), true);
      assert.deepEqual(readReadinessState(other), [
        { name: "a", ready: false, reason: "y" },
      ]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("Kernel — servable et readinessBlocked", () => {
  it("servable exige postReady ET aucun retenant", () => {
    const { kernel } = bench();
    assert.equal(kernel.postReady, false);
    assert.equal(kernel.servable, false, "cycle de démarrage non terminé");

    kernel.postReady = true;
    assert.equal(kernel.servable, true);

    kernel.setReadiness("drizzle:schema", false, "en retard");
    assert.equal(kernel.readinessBlocked, 1);
    assert.equal(kernel.servable, false);

    kernel.setReadiness("drizzle:schema", true);
    assert.equal(kernel.readinessBlocked, 0);
    assert.equal(kernel.servable, true);
  });

  it("un contributeur NON bloquant ne retient pas le trafic", () => {
    const { kernel } = bench();
    kernel.postReady = true;
    kernel.setReadiness("drizzle:schema", false, "toléré", false);
    assert.equal(kernel.readinessBlocked, 0);
    assert.equal(kernel.servable, true);
    assert.equal(kernel.readinessReport().length, 1);
  });

  it("le registre est libéré quand le dernier part : le compte retombe à 0 sans registre", () => {
    const { kernel } = bench();
    kernel.postReady = true;
    kernel.setReadiness("a", false, "x");
    kernel.setReadiness("b", false, "y");
    assert.equal(kernel.readinessBlocked, 2);
    kernel.clearReadiness("a");
    assert.equal(kernel.readinessBlocked, 1);
    kernel.clearReadiness("b");
    assert.equal(kernel.readinessBlocked, 0);
    assert.equal(kernel.servable, true);
    assert.deepEqual(kernel.readinessReport(), []);
    assert.equal(Reflect.get(kernel, "readiness"), null);
  });
});

describe("Kernel — le publieur survit à la libération du registre", () => {
  const publisherOf = (kernel: Kernel): unknown =>
    Reflect.get(kernel, "readinessPublisher");

  it("aucun inscrit : le publieur n'est pas alloué non plus", () => {
    const { kernel } = bench();
    assert.equal(publisherOf(kernel), null);
    kernel.clearReadiness("jamais-vu");
    assert.equal(publisherOf(kernel), null);
  });

  it("alloué au premier setReadiness, puis le MÊME objet à travers les cycles", () => {
    const { kernel } = bench();
    kernel.setReadiness("a", false, "x");
    const first = publisherOf(kernel);
    assert.ok(first instanceof KernelReadinessPublisher);
    for (let i = 0; i < 3; i++) {
      kernel.clearReadiness("a");
      assert.equal(Reflect.get(kernel, "readiness"), null);
      assert.equal(publisherOf(kernel), first, "libéré avec le registre");
      kernel.setReadiness("a", false, "x");
      assert.equal(publisherOf(kernel), first);
    }
  });
});

describe("KernelReadinessPublisher — seul propriétaire de la signature publiée", () => {
  /** Hôte fictif : `path` modifiable, journal enregistré. */
  function host(initial: string): {
    path: string;
    log: (pci: Pci, severity?: Severity) => void;
    lines: [Pci, Severity | undefined][];
  } {
    const lines: [Pci, Severity | undefined][] = [];
    return {
      path: initial,
      lines,
      log(pci, severity) {
        lines.push([pci, severity]);
      },
    };
  }
  const held = (name: string, reason?: string): IReadinessContributor =>
    reason === undefined
      ? { name, ready: false }
      : { name, ready: false, reason };

  it("publish n'écrit qu'une fois pour un état identique", () => {
    const publisher = new KernelReadinessPublisher(host(root));
    publisher.publish([held("a", "x")]);
    const file = readinessStateFile(root);
    writeFileSync(file, "SENTINELLE", "utf8");
    publisher.publish([held("a", "x")]);
    assert.equal(readFileSync(file, "utf8"), "SENTINELLE");
    publisher.publish([held("a", "y")]);
    assert.equal(readReadinessState(root)?.[0]?.reason, "y");
  });

  it("deux publieurs ne partagent RIEN : la signature est par instance", () => {
    const one = new KernelReadinessPublisher(host(root));
    const two = new KernelReadinessPublisher(host(root));
    one.publish([held("a", "x")]);
    rmSync(readinessStateFile(root), { force: true });
    one.publish([held("a", "x")]);
    assert.equal(existsSync(readinessStateFile(root)), false, "même instance");
    two.publish([held("a", "x")]);
    assert.equal(existsSync(readinessStateFile(root)), true, "autre instance");
  });

  it("un premier état VIDE efface le fichier (la signature de départ n'est pas « vide »)", () => {
    const publisher = new KernelReadinessPublisher(host(root));
    publisher.publish([held("a", "x")]);
    // Un fichier laissé par un autre run : un état vide doit le balayer.
    publisher.publish([]);
    assert.equal(existsSync(readinessStateFile(root)), false);
    const fresh = new KernelReadinessPublisher(host(root));
    writeFileSync(readinessStateFile(root), "RESTE", "utf8");
    fresh.publish([]);
    assert.equal(existsSync(readinessStateFile(root)), false);
  });

  it("lit `path` à l'APPEL, pas à la construction", () => {
    const h = host("/chemin/inexistant/au-boot");
    const publisher = new KernelReadinessPublisher(h);
    h.path = root;
    publisher.publish([held("a", "x")]);
    assert.equal(existsSync(readinessStateFile(root)), true);
  });

  it("logFlip : CRITIC avec noms et raisons si quelqu'un est non prêt, INFO sinon", () => {
    const h = host(root);
    const publisher = new KernelReadinessPublisher(h);
    publisher.logFlip([held("b"), held("a", "froid")]);
    publisher.logFlip([]);
    publisher.logFlip([{ name: "a", ready: true }]);
    assert.deepEqual(h.lines, [
      ["Mise en service RETENUE — /readyz rend 503 : b, a (froid)", "CRITIC"],
      ["Mise en service libérée — /readyz rend de nouveau 200", "INFO"],
      ["Mise en service libérée — /readyz rend de nouveau 200", "INFO"],
    ]);
  });
});
