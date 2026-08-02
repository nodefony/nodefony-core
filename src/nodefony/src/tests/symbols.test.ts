/**
 * Le graphe symbolique — sa RÉSOLUTION, et la commande qui l'interroge.
 *
 * Ce que ces tests protègent : le graphe répond « où est défini ce symbole, que
 * fait-il, qui l'étend » en O(1), et c'est ce qui évite à un agent de deviner.
 * Il ne servait qu'ici : lu à un chemin qui n'existe pas dans une application
 * installée depuis npm, il rendait une liste vide **sans rien dire** — le pire
 * mode de défaillance, puisqu'une absence de résultat se lit comme « ce symbole
 * n'existe pas ».
 *
 * Le cas décisif est donc le dernier : une application qui n'a QUE
 * `node_modules`, sans graphe à elle.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSymbolsArgv,
  readSymbolsGraph,
  resolveSymbolsFile,
  runSymbolsCommand,
} from "../cli/symbols";
import { SysExit } from "../cli/sysexits";

const GRAPHE = {
  generated: "2026-08-02T00:00:00.000Z",
  version: "2.0.0",
  symbols: {
    Kernel: {
      name: "Kernel",
      kind: "class",
      module: "@nodefony/core",
      file: "src/nodefony/src/kernel/Kernel.ts",
      line: 42,
      exported: true,
      description: "Orchestrateur central.",
      extends: "Service",
    },
  },
};

/** Capture stdout+stderr : la commande ÉCRIT, elle ne retourne pas son texte. */
async function capture(
  run: () => number,
): Promise<{ out: string; err: string; code: number }> {
  const outs: string[] = [];
  const errs: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => (outs.push(String(s)), true)) as never;
  process.stderr.write = ((s: string) => (errs.push(String(s)), true)) as never;
  try {
    return { code: run(), out: outs.join(""), err: errs.join("") };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

describe("graphe symbolique — résolution", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-sym-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"app"}');
    writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};\n");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ecrire = (sous: string): string => {
    const cible = path.join(dir, sous, ".ai");
    mkdirSync(cible, { recursive: true });
    const file = path.join(cible, "symbols.json");
    writeFileSync(file, JSON.stringify(GRAPHE));
    return file;
  };

  it("⭐ trouve le graphe PUBLIÉ quand l'application n'en a pas", () => {
    // LE cas qui motive tout : une app installée depuis npm. Avant, la lecture
    // portait sur un chemin absent et rendait une liste vide, en silence.
    const publie = ecrire(path.join("node_modules", "nodefony"));
    assert.strictEqual(resolveSymbolsFile(dir), publie);
    assert.strictEqual(readSymbolsGraph(dir)?.symbols.Kernel?.line, 42);
  });

  it("préfère le graphe du PROJET — il décrit le code en cours d'écriture", () => {
    const local = ecrire(".");
    ecrire(path.join("node_modules", "nodefony"));
    assert.strictEqual(resolveSymbolsFile(dir), local);
  });

  it("rend null quand aucun graphe n'est atteignable", () => {
    assert.isNull(resolveSymbolsFile(dir));
    assert.isNull(readSymbolsGraph(dir));
  });

  it("rend null sur un graphe CORROMPU, sans throw", () => {
    mkdirSync(path.join(dir, ".ai"), { recursive: true });
    writeFileSync(path.join(dir, ".ai", "symbols.json"), "{ pas du json");
    assert.isNull(readSymbolsGraph(dir));
  });

  it("rend null sur un JSON valide qui n'est PAS un graphe", () => {
    mkdirSync(path.join(dir, ".ai"), { recursive: true });
    writeFileSync(path.join(dir, ".ai", "symbols.json"), '{"autre":true}');
    assert.isNull(readSymbolsGraph(dir));
  });

  describe("la commande", () => {
    it("rend la définition, le TSDoc et la parenté d'un symbole", async () => {
      ecrire(".");
      const { out, code } = await capture(() =>
        runSymbolsCommand([
          "node",
          "nodefony",
          "symbols",
          "Kernel",
          "--cwd",
          dir,
        ]),
      );
      assert.strictEqual(code, SysExit.OK);
      assert.include(out, "Kernel — class (@nodefony/core)");
      assert.include(out, "Kernel.ts:42");
      assert.include(out, "Orchestrateur central.");
      assert.include(out, "étend      : Service");
    });

    it("sort en DATAERR sur un symbole inconnu, en disant la taille du graphe", async () => {
      ecrire(".");
      const { err, code } = await capture(() =>
        runSymbolsCommand(["symbols", "NExistePas", "--cwd", dir]),
      );
      assert.strictEqual(code, SysExit.DATAERR);
      assert.include(err, "introuvable");
    });

    it("⭐ NOMME le geste quand aucun graphe n'est atteignable", async () => {
      // Sans ce message, l'absence de graphe se lit comme « ce symbole n'existe
      // pas » — une ignorance déguisée en réponse.
      const { err, code } = await capture(() =>
        runSymbolsCommand(["symbols", "Kernel", "--cwd", dir]),
      );
      assert.strictEqual(code, SysExit.NOINPUT);
      assert.include(err, "generate-symbols");
      assert.include(err, "node_modules/nodefony");
    });

    it("filtre par paquet", async () => {
      ecrire(".");
      const { out } = await capture(() =>
        runSymbolsCommand([
          "symbols",
          "--module",
          "@nodefony/core",
          "--cwd",
          dir,
        ]),
      );
      assert.include(out, "Kernel");
      assert.include(out, "1 symbole(s) — @nodefony/core");
    });

    it("sans argument, dit D'OÙ vient le graphe", async () => {
      const file = ecrire(".");
      const { out } = await capture(() =>
        runSymbolsCommand(["symbols", "--cwd", dir]),
      );
      assert.include(out, file);
      assert.include(out, "1 symboles exportés");
    });

    it("refuse une option inconnue", () => {
      assert.property(parseSymbolsArgv(["symbols", "--nawak"]), "error");
    });

    it("refuse un second nom au lieu de l'ignorer", () => {
      assert.property(parseSymbolsArgv(["symbols", "A", "B"]), "error");
    });
  });
});
