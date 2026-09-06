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

  /**
   * 🔴 La RACINE d'un monorepo ne se fait crier dessus NI dans un sens NI dans
   * l'autre.
   *
   * Le code prévoyait déjà le cas — `workspaceMembers()` verse les membres dans
   * l'ensemble « déclaré », en disant pourquoi : « exiger qu'il les redéclare en
   * dépendances serait exiger le contraire de ce que npm attend, et ferait crier
   * l'outil sur la racine de tout monorepo — donc lui apprendrait à être
   * ignoré ». Mais la garde n'a été posée qu'à UN des deux endroits : l'ensemble
   * qui juge l'ORDRE ne connaissait pas les membres. Un membre échappait donc au
   * verdict « non déclaré » pour tomber dans « déclaré en peerDependencies
   * SEULE » — un message doublement trompeur, puisque la racine n'a aucune
   * peerDependency, et qu'il prescrit exactement ce que le commentaire dit de ne
   * pas exiger. Vécu : `nodefony doctor` rendait 9 manquements sur ce dépôt.
   *
   * Le fond : le champ `workspaces` ORDONNE. C'est par lui que npm installe et
   * relie ses membres, et que turbo construit le graphe — c'est même la seule
   * façon correcte de le dire à la racine.
   */
  it("🔴 la racine d'un monorepo n'a rien à redéclarer — `workspaces` ORDONNE", () => {
    paquet("@nodefony/fixture-core", {});
    // La racine du dépôt de fixture : elle déclare ses membres par `workspaces`
    // et RIEN d'autre — exactement la forme de ce dépôt.
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-racine",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*"],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(root, "index.ts"),
      'import { socle } from "@nodefony/fixture-core";\nexport const x = socle;\n',
    );
    const { findings } = checkPackageDeps({
      roots: [path.join(root, "packages"), root],
      cwd: root,
    });
    const surLaRacine = findings.filter((f) => f.package === "fixture-racine");
    assert.isEmpty(surLaRacine, JSON.stringify(surLaRacine, null, 2));
  });

  it("sens négatif : la garde ne dispense QUE les membres, pas les autres", () => {
    // Élargir « workspaces ORDONNE » en « la racine ne se trompe jamais » serait
    // rendre l'outil aveugle là où il sert : un paquet du dépôt qui n'est PAS un
    // membre déclaré doit continuer d'être réclamé.
    paquet("@nodefony/fixture-core", {});
    mkdirSync(path.join(root, "autre"), { recursive: true });
    writeFileSync(
      path.join(root, "autre", "package.json"),
      `${JSON.stringify(
        {
          name: "@nodefony/fixture-hors-workspace",
          version: "1.0.0",
          private: true,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-racine",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*"],
          peerDependencies: { "@nodefony/fixture-hors-workspace": "*" },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(root, "index.ts"),
      'import { y } from "@nodefony/fixture-hors-workspace";\nexport const x = y;\n',
    );
    const { findings } = checkPackageDeps({
      roots: [path.join(root, "packages"), path.join(root, "autre"), root],
      cwd: root,
    });
    const surLaRacine = findings.filter((f) => f.package === "fixture-racine");
    assert.lengthOf(surLaRacine, 1, JSON.stringify(findings, null, 2));
    assert.equal(surLaRacine[0]?.kind, "peer-only-sibling");
  });
});
