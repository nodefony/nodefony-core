/**
 * La surface d'un paquet — et l'ORDRE dans lequel les frères se construisent.
 *
 * Ce que ces tests protègent : une faute qui ne se paie jamais là où on
 * travaille. Dans un dépôt à espaces de travail, la sortie de la construction
 * précédente masque une dépendance non ordonnée jusqu'au premier nettoyage —
 * ensuite c'est la forge qui tombe, sur une machine où personne ne débogue.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkPackageDeps } from "../kernel/checks/packageDeps";

let root = "";

/** Pose un paquet du dépôt de fixture : manifeste + une source qui importe. */
const paquet = (
  name: string,
  manifest: Record<string, unknown>,
  source = "",
): void => {
  const dir = path.join(root, "packages", name.replace(/^@[^/]+\//, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0", private: true, ...manifest }, null, 2)}\n`,
  );
  if (source) {
    writeFileSync(path.join(dir, "index.ts"), source);
  }
};

const analyse = (): ReturnType<typeof checkPackageDeps> =>
  checkPackageDeps({ roots: [path.join(root, "packages")], cwd: root });

describe("checkPackageDeps — un frère du dépôt doit être ORDONNÉ", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nf-pkgdeps-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Le cas vécu : `@nodefony/devkit` importait `nodefony/bundler` dans son
   * `rolldown.config.ts` en ne déclarant `nodefony` qu'en peerDependencies.
   * turbo n'ordonne que `dependencies` et `devDependencies` — le module se
   * construisait donc avant que le fichier importé existe.
   */
  it("signale un import d'exécution déclaré en peerDependencies SEULE", () => {
    paquet("@nodefony/fixture-core", {});
    paquet(
      "@nodefony/fixture-outil",
      { peerDependencies: { "@nodefony/fixture-core": "*" } },
      'import { socle } from "@nodefony/fixture-core";\nexport const x = socle;\n',
    );
    const { findings } = analyse();
    const f = findings.filter((x) => x.kind === "peer-only-sibling");
    assert.lengthOf(f, 1, JSON.stringify(findings, null, 2));
    assert.equal(f[0]?.package, "@nodefony/fixture-outil");
    assert.include(f[0]?.message ?? "", "devDependencies");
  });

  it("se tait dès que la dépendance ORDONNE la construction", () => {
    paquet("@nodefony/fixture-core", {});
    paquet(
      "@nodefony/fixture-outil",
      {
        peerDependencies: { "@nodefony/fixture-core": "*" },
        devDependencies: { "@nodefony/fixture-core": "*" },
      },
      'import { socle } from "@nodefony/fixture-core";\nexport const x = socle;\n',
    );
    assert.isEmpty(
      analyse().findings.filter((x) => x.kind === "peer-only-sibling"),
    );
  });

  /**
   * Un type est effacé à la compilation : il n'impose aucun ordre. Les paquets
   * lus en source pointent d'ailleurs leurs `types` vers `./index.ts`
   * précisément pour ne pas exiger d'être construits — exiger une arête ici
   * ferait crier la garde sur un dépôt sain, donc lui apprendrait à être ignorée.
   */
  it("ne dit rien d'un import de TYPE — il n'impose aucun ordre", () => {
    paquet("@nodefony/fixture-core", {});
    paquet(
      "@nodefony/fixture-outil",
      { peerDependencies: { "@nodefony/fixture-core": "*" } },
      'import type { ISocle } from "@nodefony/fixture-core";\nexport type X = ISocle;\n',
    );
    assert.isEmpty(
      analyse().findings.filter((x) => x.kind === "peer-only-sibling"),
    );
  });

  /** Un cycle assumé interdit la réciproque : la réclamer serait un contresens. */
  it("ne réclame rien sur un cycle DÉCLARÉ", () => {
    paquet("@nodefony/fixture-core", {});
    paquet(
      "@nodefony/fixture-outil",
      {},
      'import { socle } from "@nodefony/fixture-core";\nexport const x = socle;\n',
    );
    const { findings } = checkPackageDeps({
      roots: [path.join(root, "packages")],
      cwd: root,
      typeCycles: { "@nodefony/fixture-outil": ["@nodefony/fixture-core"] },
    });
    assert.isEmpty(findings.filter((x) => x.kind === "peer-only-sibling"));
  });

  /**
   * Hors du dépôt, la règle ne doit pas mordre : un paquet venu de
   * `node_modules` arrive déjà construit. C'est ce qui la rend utilisable dans
   * une application, où `nodefony` n'est jamais un frère.
   */
  it("ignore un paquet qui n'est pas construit ici", () => {
    paquet(
      "@nodefony/fixture-outil",
      { peerDependencies: { "@nodefony/fixture-absent": "*" } },
      'import { z } from "@nodefony/fixture-absent";\nexport const x = z;\n',
    );
    assert.isEmpty(
      analyse().findings.filter((x) => x.kind === "peer-only-sibling"),
    );
  });
});
