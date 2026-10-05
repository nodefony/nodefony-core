/**
 * Le graphe symbolique du code d'une APPLICATION — sa production.
 *
 * Ce que ces tests protègent : l'onglet « API » d'un module de l'application,
 * dans la console d'administration, était toujours vide — rien ne produisait le
 * graphe de son code, seul le framework publiait le sien. Le générateur est
 * celui du dépôt du framework (une implémentation, deux appelants), exécuté
 * avec le compilateur TypeScript de l'application.
 */
import { describe, it, beforeEach, afterEach, assert } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import {
  lookupSymbol,
  readSymbolsGraph,
  runSymbolsCli,
  runSymbolsCommand,
} from "../cli/symbols";
import {
  generateProjectSymbols,
  refreshProjectSymbols,
} from "../cli/symbolsGenerate";
import {
  buildSymbolsGraph,
  SYMBOLS_PRODUCER_APPLICATION,
  SYMBOLS_PRODUCER_REPOSITORY,
  type ISymbolsDocument,
} from "../cli/symbolsGraph";
import { SysExit } from "../cli/sysexits";

/** Capture stdout+stderr d'une commande asynchrone. */
async function capture(
  run: () => Promise<number> | number,
): Promise<{ out: string; err: string; code: number }> {
  const outs: string[] = [];
  const errs: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s: string | Uint8Array) => (
    outs.push(String(s)),
    true
  );
  process.stderr.write = (s: string | Uint8Array) => (
    errs.push(String(s)),
    true
  );
  try {
    const code = await run();
    return { code, out: outs.join(""), err: errs.join("") };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

const ecrire = (root: string, rel: string, contenu: string): void => {
  const file = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contenu);
};

/** Le dossier du paquet `typescript` qu'emploie cette suite. */
const TYPESCRIPT_DIR = path.dirname(
  createRequire(import.meta.url).resolve("typescript/package.json"),
);

/** Graphe d'un seul fichier, pour éprouver l'extraction. */
const grapheDe = (texte: string): ISymbolsDocument =>
  buildSymbolsGraph(
    ts,
    [{ file: "a.ts", module: "m", text: texte }],
    SYMBOLS_PRODUCER_APPLICATION,
  ).stable;

describe("graphe symbolique — extraction", () => {
  it("⭐ décrit un symbole par le bloc TSDoc le plus PROCHE qui porte une description", () => {
    // L'ancien générateur prenait le PREMIER bloc : l'en-tête du fichier
    // décrivait alors sa première déclaration (178 descriptions fausses).
    const g = grapheDe(
      [
        "/** En-tête du fichier. */",
        "/** La vraie description. */",
        "export interface IA {}",
        "/** Description de B. */",
        "/** @typeParam T - balise seule */",
        "export interface IB<T> { x: T }",
      ].join("\n"),
    );
    assert.strictEqual(g.symbols.IA?.description, "La vraie description.");
    assert.strictEqual(g.symbols.IB?.description, "Description de B.");
  });

  it("⭐ retient les exports par clause, alias compris, et `export default Nom`", () => {
    const g = grapheDe(
      [
        "const schema = {};",
        "const interne = 1;",
        "class Kernel {}",
        "export { schema as sessionSchema };",
        "export default Kernel;",
        'export { ailleurs } from "./b";',
      ].join("\n"),
    );
    assert.isTrue(g.symbols.schema?.exported, "export aliasé");
    assert.isTrue(g.symbols.Kernel?.exported, "export default d'une classe");
    assert.isUndefined(g.symbols.interne, "une constante non exportée");
    assert.isUndefined(
      g.symbols.ailleurs,
      "un ré-export appartient à son fichier",
    );
  });

  it("⭐ un nom PUBLIÉ sous un autre nom se retrouve — même fichier, autre fichier, autre paquet", () => {
    // Chercher le nom qu'on lit dans un `import` rendait « introuvable » pour
    // un symbole qui existe sous son nom de déclaration (8 noms dans le dépôt).
    const g = buildSymbolsGraph(
      ts,
      [
        {
          file: "user/index.ts",
          module: "@a/user",
          text: "/** Une ligne de la table. */\nexport interface IUserRow { id: string }",
        },
        {
          file: "front/presets/react.ts",
          module: "@a/front",
          text: "/** Preset React. */\nconst react19Preset = { name: 1 };\nexport default react19Preset;",
        },
        {
          file: "front/index.ts",
          module: "@a/front",
          text: [
            'export { default as reactPreset } from "./presets/react";',
            'export { IUserRow as UserRow } from "@a/user";',
            'export { z as zod } from "zod";',
            "const schema = {};",
            "export { schema as sessionSchema };",
          ].join("\n"),
        },
      ],
      SYMBOLS_PRODUCER_APPLICATION,
    ).stable;
    const graphe = g as unknown as Parameters<typeof lookupSymbol>[0];
    assert.strictEqual(lookupSymbol(graphe, "sessionSchema")?.name, "schema");
    assert.strictEqual(lookupSymbol(graphe, "UserRow")?.name, "IUserRow");
    // La constante exportée PAR DÉFAUT entre au graphe parce qu'on la publie.
    assert.strictEqual(
      lookupSymbol(graphe, "reactPreset")?.name,
      "react19Preset",
    );
    assert.strictEqual(
      lookupSymbol(graphe, "reactPreset")?.description,
      "Preset React.",
    );
    // Un paquet tiers ne désigne rien ici : pas d'alias pendant.
    assert.isUndefined(g.relations.aliases.zod);
  });

  it("ne compte pas une signature de surcharge comme une fonction de plus", () => {
    const g = buildSymbolsGraph(
      ts,
      [
        {
          file: "a.ts",
          module: "m",
          text: [
            "export function f(a: string): string;",
            "export function f(a: number): number;",
            "export function f(a: unknown): unknown { return a; }",
          ].join("\n"),
        },
      ],
      SYMBOLS_PRODUCER_APPLICATION,
    );
    assert.strictEqual(g.stable.stats.functions, 1);
  });

  it("range un homonyme d'un autre module sous `Module:Nom`, et se reproduit à l'octet", () => {
    const entrees = [
      { file: "a/x.ts", module: "@a/a", text: "export class User {}" },
      {
        file: "b/x.ts",
        module: "@a/b",
        text: "export class User extends Base {}",
      },
    ];
    const une = buildSymbolsGraph(ts, entrees, SYMBOLS_PRODUCER_APPLICATION);
    const deux = buildSymbolsGraph(ts, entrees, SYMBOLS_PRODUCER_APPLICATION);
    assert.strictEqual(une.stable.symbols.User?.module, "@a/a");
    assert.strictEqual(une.stable.symbols["@a/b:User"]?.extends, "Base");
    assert.lengthOf(une.homonyms, 1);
    // AUCUN horodatage : un code inchangé rend un graphe identique.
    assert.strictEqual(JSON.stringify(une.stable), JSON.stringify(deux.stable));
  });
});

describe("graphe symbolique — `nodefony symbols --generate`", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-symgen-"));
    ecrire(dir, "package.json", '{"name":"monapp","workspaces":["modules/*"]}');
    ecrire(dir, "nodefony.config.ts", "export default {};\n");
    ecrire(
      dir,
      "index.ts",
      "/** Le module racine de l'application. */\nexport class AppModule {}\n",
    );
    ecrire(dir, "modules/blog/package.json", '{"name":"@monapp/blog"}');
    ecrire(
      dir,
      "modules/blog/nodefony/service/BlogService.ts",
      "/** Publie les billets du blog. */\nexport class BlogService {}\n",
    );
    ecrire(
      dir,
      "modules/blog/index.ts",
      'export { BlogService as Billets } from "./nodefony/service/BlogService";\n',
    );
    // Ce qui ne doit PAS entrer au graphe.
    ecrire(
      dir,
      "modules/blog/tests/blog.test.ts",
      "export class TestOnly {}\n",
    );
    ecrire(dir, "modules/blog/frontend/App.ts", "export class FrontOnly {}\n");
    ecrire(dir, "rolldown.config.ts", "export const ConfigOnly = 1;\n");
    // Le framework installé publie le sien.
    ecrire(
      dir,
      "node_modules/nodefony/.ai/symbols.json",
      JSON.stringify({
        version: "2.0.0",
        producer: SYMBOLS_PRODUCER_REPOSITORY,
        symbols: {
          HttpKernel: {
            name: "HttpKernel",
            kind: "class",
            module: "@nodefony/http",
            file: "src/packages/@nodefony/http/HttpKernel.ts",
            exported: true,
          },
          BlogService: {
            name: "BlogService",
            kind: "class",
            module: "@nodefony/http",
            file: "src/packages/@nodefony/http/BlogService.ts",
            exported: true,
          },
        },
      }),
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Rend le compilateur atteignable depuis l'application, comme après `npm i -D typescript`. */
  const installerTypescript = (): void => {
    // `junction` : un lien de dossier que Windows crée sans privilège.
    symlinkSync(
      TYPESCRIPT_DIR,
      path.join(dir, "node_modules", "typescript"),
      "junction",
    );
  };

  it("⭐ écrit le graphe de l'application, et la lecture le FUSIONNE avec celui du framework", async () => {
    installerTypescript();
    const { code, out } = await capture(() =>
      runSymbolsCli([
        "symbols",
        "--generate",
        "--cwd",
        path.join(dir, "modules", "blog"),
      ]),
    );
    assert.strictEqual(code, SysExit.OK, out);
    assert.include(out, "@monapp/blog");

    const ecrit = JSON.parse(
      readFileSync(path.join(dir, ".ai", "symbols.json"), "utf8"),
    ) as ISymbolsDocument;
    assert.strictEqual(ecrit.producer, SYMBOLS_PRODUCER_APPLICATION);
    // Le module = le `name` du package.json le plus proche — la clé que lit la console.
    assert.strictEqual(ecrit.symbols.AppModule?.module, "monapp");
    assert.strictEqual(ecrit.symbols.BlogService?.module, "@monapp/blog");
    assert.strictEqual(
      ecrit.symbols.BlogService?.file,
      "modules/blog/nodefony/service/BlogService.ts",
    );
    for (const absent of ["TestOnly", "FrontOnly", "ConfigOnly"]) {
      assert.isUndefined(ecrit.symbols[absent], absent);
    }

    const fusion = readSymbolsGraph(dir);
    assert.strictEqual(fusion?.symbols.HttpKernel?.module, "@nodefony/http");
    // Homonyme d'un AUTRE module : le projet prend le nom, le framework reste
    // atteignable — sans quoi il disparaissait de la fiche de son module.
    assert.strictEqual(fusion?.symbols.BlogService?.module, "@monapp/blog");
    assert.strictEqual(
      fusion?.symbols["@nodefony/http:BlogService"]?.module,
      "@nodefony/http",
    );

    const lu = await capture(() =>
      runSymbolsCommand(["symbols", "BlogService", "--cwd", dir]),
    );
    assert.strictEqual(lu.code, SysExit.OK);
    assert.include(lu.out, "Publie les billets du blog.");

    // Cherché par le nom que l'application IMPORTE : trouvé, et dit comme tel.
    const publie = await capture(() =>
      runSymbolsCommand(["symbols", "Billets", "--cwd", dir]),
    );
    assert.strictEqual(publie.code, SysExit.OK);
    assert.include(publie.out, "BlogService — class (@monapp/blog)");
    assert.include(publie.out, "publié sous : Billets");
  });

  it("⭐ sans compilateur TypeScript, refuse en NOMMANT la commande d'installation", async () => {
    const { code, err } = await capture(() =>
      runSymbolsCli(["symbols", "--generate", "--cwd", dir]),
    );
    assert.strictEqual(code, SysExit.UNAVAILABLE);
    assert.include(err, "npm install -D typescript");
  });

  it("🔴 ne réécrit JAMAIS le graphe d'un autre producteur (le dépôt du framework)", async () => {
    installerTypescript();
    const file = path.join(dir, ".ai", "symbols.json");
    const original = JSON.stringify({
      version: "2.0.0",
      producer: SYMBOLS_PRODUCER_REPOSITORY,
      symbols: {},
    });
    ecrire(dir, ".ai/symbols.json", original);
    const manuel = await generateProjectSymbols(dir);
    assert.isFalse(manuel.ok);
    assert.strictEqual(!manuel.ok && manuel.code, SysExit.CANTCREAT);
    const auto = await refreshProjectSymbols(dir);
    assert.deepEqual(auto, { ok: false, skipped: "foreign" });
    assert.strictEqual(readFileSync(file, "utf8"), original);
  });

  it("régénère SON graphe, et se tait sans compilateur (geste automatique du superviseur)", async () => {
    assert.deepEqual(await refreshProjectSymbols(dir), {
      ok: false,
      skipped: "no-typescript",
    });
    installerTypescript();
    const premier = await refreshProjectSymbols(dir);
    assert.isTrue(premier.ok);
    const file = path.join(dir, ".ai", "symbols.json");
    const avant = statSync(file).size;
    ecrire(
      dir,
      "modules/blog/nodefony/service/Autre.ts",
      "export class Autre {}\n",
    );
    const second = await refreshProjectSymbols(dir);
    assert.isTrue(second.ok);
    assert.isAbove(statSync(file).size, avant);
  });

  it("hors d'une application, sort en NOINPUT", async () => {
    const vide = mkdtempSync(path.join(tmpdir(), "nf-symgen-vide-"));
    try {
      const { code } = await capture(() =>
        runSymbolsCli(["symbols", "--generate", "--cwd", vide]),
      );
      assert.strictEqual(code, SysExit.NOINPUT);
    } finally {
      rmSync(vide, { recursive: true, force: true });
    }
  });

  it("refuse --generate avec un symbole, et ne l'ignore pas sur la porte synchrone", async () => {
    const avecNom = await capture(() =>
      runSymbolsCli(["symbols", "Kernel", "--generate", "--cwd", dir]),
    );
    assert.strictEqual(avecNom.code, SysExit.USAGE);
    const synchrone = await capture(() =>
      runSymbolsCommand(["symbols", "--generate", "--cwd", dir]),
    );
    assert.strictEqual(synchrone.code, SysExit.USAGE);
  });
});
