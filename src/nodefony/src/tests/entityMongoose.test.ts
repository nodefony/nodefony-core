/*
 *   `create entity` sur MongoDB — la voie DOCUMENT du générateur, aux limites.
 *
 *   Trois familles : la traduction des champs en schéma Mongoose (chaque type,
 *   chaque modificateur), les gardes qui refusent en le disant (options SQL,
 *   casse, types d'un autre outil), et les COPIES que ce générateur alimente —
 *   exemples de commande et table des types écrits dans les gabarits, l'aide et
 *   les skills. Une copie qui n'est confrontée à rien diverge au premier ajout :
 *   c'est ainsi qu'`AGENTS.md` a continué d'enseigner `!` après #431.
 */

import assert from "node:assert";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEntityCodegen,
  buildMongooseEntityCodegen,
  describeColumnTypes,
  ENTITY_FIELD_TYPES,
  EntityFieldError,
  OBJECT_ID_PATTERN,
  parseEntityFields,
  suggestFieldType,
} from "../cli/scaffold/entityFields";
import {
  assertNoSqlOnlyOptions,
  importsName,
  invalidBodyOf,
  lastImportEnd,
  MONGOOSE_CONNECTOR,
  resolveEntityOrm,
  scaffoldCaps,
} from "../cli/scaffold/engine";
import { capAllows, getScaffoldSpec } from "../cli/scaffold/spec";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, "../..");
const repo = path.resolve(core, "../..");
const devkitSkills = path.join(repo, "src/packages/@nodefony/devkit/skills");

/** Rendu Mongoose d'une déclaration de champs, ligne par ligne. */
const lines = (
  fields: string,
  options = { timestamps: true, softDelete: false },
): string[] =>
  buildMongooseEntityCodegen(
    parseEntityFields(fields),
    options,
  ).schemaFields.split("\n  ");

describe("create entity — traduction Mongoose, type par type", () => {
  it("chaque type obligatoire : type Mongoose + required", () => {
    const expected: Record<string, string> = {
      "a:string": "a: { type: String, maxlength: 255, required: true },",
      "a:string(40)": "a: { type: String, maxlength: 40, required: true },",
      "a:text": "a: { type: String, required: true },",
      "a:int": "a: { type: Number, required: true },",
      "a:float": "a: { type: Number, required: true },",
      "a:bool": "a: { type: Boolean, required: true },",
      "a:json": 'a: { type: "Mixed", required: true },',
      "a:date": "a: { type: Date, required: true },",
      "a:uuid": "a: { type: String, required: true },",
      "a:decimal(10,2)": "a: { type: String, required: true },",
      "a:char(2)":
        "a: { type: String, minlength: 2, maxlength: 2, required: true },",
      "a:enum(x,y)": 'a: { type: String, enum: ["x", "y"], required: true },',
    };
    for (const [decl, line] of Object.entries(expected)) {
      assert.deepStrictEqual(lines(decl), [line], decl);
    }
  });

  it("facultatif → `default: null`, JAMAIS required", () => {
    assert.deepStrictEqual(lines("a:text?"), [
      "a: { type: String, default: null },",
    ]);
  });

  it("un défaut rend `required` inutile ; il est typé selon le champ", () => {
    assert.deepStrictEqual(lines("n:int=0"), [
      "n: { type: Number, default: 0 },",
    ]);
    assert.deepStrictEqual(lines("b:bool=false"), [
      "b: { type: Boolean, default: false },",
    ]);
    assert.deepStrictEqual(lines("s:enum(x,y)=y"), [
      's: { type: String, enum: ["x", "y"], default: "y" },',
    ]);
  });

  it("un JSON facultatif : `Mixed`, nul par défaut (la grammaire refuse un défaut `json`)", () => {
    assert.deepStrictEqual(lines("t:json?"), [
      't: { type: "Mixed", default: null },',
    ]);
  });

  it(":unique pose l'unicité (qui indexe), :index l'index — jamais les deux", () => {
    assert.deepStrictEqual(lines("s:string:unique"), [
      "s: { type: String, maxlength: 255, required: true, unique: true },",
    ]);
    assert.deepStrictEqual(lines("s:string:index"), [
      "s: { type: String, maxlength: 255, required: true, index: true },",
    ]);
  });

  it("une référence : ObjectId, cible, indexée d'office — facultative → null", () => {
    assert.deepStrictEqual(lines("author:ref:User"), [
      'author: { type: "ObjectId", ref: "User", required: true, index: true }, // → User.id',
    ]);
    assert.deepStrictEqual(lines("parent:ref:Category?"), [
      'parent: { type: "ObjectId", ref: "Category", default: null, index: true }, // → Category.id',
    ]);
  });

  it("json facultatif : `unknown` seul dans la ligne, sans `| null` redondant (les DEUX ORM)", () => {
    // `unknown | null` compile, mais rougit le lint de l'app générée
    // (`no-redundant-type-constituents`) — vu en CI sur le moteur mongodb.
    const fields = parseEntityFields("tags:json? label:string?");
    const mongo = buildMongooseEntityCodegen(fields, {
      timestamps: false,
      softDelete: false,
    });
    const sql = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "items",
    });
    for (const rows of [mongo.rowProps, sql.rowProps]) {
      assert.match(rows, /tags: unknown;/u);
      assert.match(rows, /label: string \| null;/u);
    }
  });

  it("horodatages : dans la LIGNE, pas dans le schéma (option du descripteur)", () => {
    const withTs = buildMongooseEntityCodegen(parseEntityFields("a:text"), {
      timestamps: true,
      softDelete: false,
    });
    assert.ok(!withTs.schemaFields.includes("createdAt"));
    assert.match(withTs.rowProps, /createdAt: Date;/u);
    const without = buildMongooseEntityCodegen(parseEntityFields("a:text"), {
      timestamps: false,
      softDelete: false,
    });
    assert.ok(!without.rowProps.includes("createdAt"));
  });

  it("suppression douce : deletedAt nul par défaut, dans le schéma ET la ligne", () => {
    const out = buildMongooseEntityCodegen(parseEntityFields("a:text"), {
      timestamps: false,
      softDelete: true,
    });
    assert.match(
      out.schemaFields,
      /deletedAt: \{ type: Date, default: null \},/u,
    );
    assert.match(out.rowProps, /deletedAt: Date \| null;/u);
  });

  it("la clé est `id: string` en tête de la ligne — le virtuel d'un ObjectId", () => {
    const out = buildMongooseEntityCodegen(parseEntityFields("a:int"), {
      timestamps: false,
      softDelete: false,
    });
    assert.strictEqual(out.rowProps.split("\n  ")[0], "id: string;");
    assert.strictEqual(out.idType, "string");
  });
});

describe("create entity — une référence MongoDB se valide AVANT Mongoose", () => {
  const re = new RegExp(OBJECT_ID_PATTERN, "iu");

  it("accepte 24 hexadécimaux, minuscules comme majuscules", () => {
    assert.ok(re.test("0123456789abcdef01234567"));
    assert.ok(re.test("0123456789ABCDEF01234567"));
  });

  it("refuse 23 et 25 caractères, un UUID, un caractère hors hexadécimal", () => {
    for (const bad of [
      "0123456789abcdef0123456",
      "0123456789abcdef012345678",
      "00000000-0000-4000-8000-000000000001",
      "0123456789abcdef0123456g",
      "",
    ]) {
      assert.ok(!re.test(bad), bad);
    }
  });

  it("le schéma Zod rendu porte CETTE regex — pas z.string() nu", () => {
    const { zodProps } = buildMongooseEntityCodegen(
      parseEntityFields("author:ref:User"),
      {
        timestamps: false,
        softDelete: false,
      },
    );
    assert.ok(zodProps.includes(`regex(/${OBJECT_ID_PATTERN}/iu`), zodProps);
  });

  it("l'échantillon généré satisfait la regex, pour n petit comme grand", () => {
    // Même expression que celle écrite dans l'entité (`objectIdSample`).
    const sample = (n: number): string => n.toString(16).padStart(24, "0");
    for (const n of [0, 1, 15, 16, 255, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      assert.ok(re.test(sample(n)), String(n));
    }
  });
});

describe("create entity — la casse et les habitudes d'un autre outil", () => {
  it("`ref:user` propose `ref:User` — la forme exacte à retaper", () => {
    assert.throws(
      () => parseEntityFields("author:ref:user"),
      (e: unknown) =>
        e instanceof EntityFieldError &&
        e.message.includes("→ author:ref:User ?"),
    );
  });

  it("un type en majuscules propose sa forme en minuscules", () => {
    assert.throws(
      () => parseEntityFields("title:String"),
      (e: unknown) =>
        e instanceof EntityFieldError && e.message.includes("→ title:string ?"),
    );
  });

  it("les synonymes courants proposent le type Nodefony, sans être ACCEPTÉS", () => {
    const hints: Record<string, string> = {
      boolean: "bool",
      Integer: "int",
      number: "float",
      datetime: "date",
      object: "json",
      varchar: "string",
    };
    for (const [typed, fixed] of Object.entries(hints)) {
      assert.strictEqual(suggestFieldType(typed), fixed, typed);
      assert.throws(
        () => parseEntityFields(`x:${typed}`),
        EntityFieldError,
        typed,
      );
    }
    assert.strictEqual(suggestFieldType("blob"), null);
  });

  it("le `!` reste REFUSÉ (#431)", () => {
    assert.throws(() => parseEntityFields("content:text!"), EntityFieldError);
  });
});

describe("create entity — choix de l'ORM et refus des options SQL", () => {
  const set = (...deps: string[]): Set<string> => new Set(deps);

  it("Drizzle gagne quand les deux ORM sont là ; Mongoose seul → document", () => {
    assert.strictEqual(
      resolveEntityOrm(
        set("@nodefony/drizzle", "@nodefony/mongoose"),
        set(),
        "app",
      ),
      "drizzle",
    );
    assert.strictEqual(
      resolveEntityOrm(set("@nodefony/mongoose"), set(), "app"),
      "mongoose",
    );
  });

  it("l'ORM déclaré par l'APP seule suffit à un module (peerDependencies)", () => {
    assert.strictEqual(
      resolveEntityOrm(set(), set("@nodefony/mongoose"), "@app/blog"),
      "mongoose",
    );
  });

  it("aucun ORM → refus qui nomme les DEUX voies", () => {
    assert.throws(
      () => resolveEntityOrm(set(), set(), "app"),
      /@nodefony\/drizzle \(SQL\) ou @nodefony\/mongoose \(MongoDB\)/u,
    );
  });

  it("les défauts de la spec passent — un appel sans option SQL n'est pas refusé", () => {
    const [spec] = getScaffoldSpec("entity");
    const defaults = Object.fromEntries(
      spec.questions.map((q) => [q.key, q.default]),
    );
    assert.doesNotThrow(() => assertNoSqlOnlyOptions(defaults, "Post"));
    assert.doesNotThrow(() =>
      assertNoSqlOnlyOptions(
        { ...defaults, connector: "analytics", route: "/x" },
        "Post",
      ),
    );
  });

  it("chaque option SQL est refusée, en la NOMMANT", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["--table", { table: "posts" }],
      ["--column-case", { columnCase: "snake" }],
      ["--id-name", { idName: "post_id" }],
      ["--dialect", { dialect: "postgres" }],
      ["--id", { id: "serial" }],
      ["--id", { id: "uuid4" }],
      ["--index", { index: ["a,b"] }],
      ["--unique", { uniqueIndex: ["a,b"] }],
    ];
    for (const [option, answers] of cases) {
      assert.throws(
        () => assertNoSqlOnlyOptions(answers as never, "Post"),
        (e: unknown) =>
          e instanceof Error && e.message.includes(`« ${option} »`),
        option,
      );
    }
  });

  it("le connecteur recopié est celui de @nodefony/mongoose", () => {
    const source = readFileSync(
      path.join(
        repo,
        "src/packages/@nodefony/mongoose/nodefony/registerStores.ts",
      ),
      "utf8",
    );
    const declared = /export const FRAMEWORK_CONNECTOR = "([^"]+)"/u.exec(
      source,
    )?.[1];
    assert.strictEqual(MONGOOSE_CONNECTOR, declared);
  });
});

describe("create entity — ce que le dialogue demande dépend du projet", () => {
  const app = (pkg: string): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nf-caps-"));
    writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};\n");
    writeFileSync(path.join(dir, "package.json"), pkg);
    return dir;
  };
  const idQuestion = getScaffoldSpec("entity")[0].questions.find(
    (q) => q.key === "id",
  );

  it("application MongoDB → hasSqlOrm faux → la clé primaire n'est PAS demandée", () => {
    const dir = app(
      JSON.stringify({ dependencies: { "@nodefony/mongoose": "*" } }),
    );
    try {
      const caps = scaffoldCaps(dir);
      assert.strictEqual(caps.hasSqlOrm, false);
      assert.ok(idQuestion && !capAllows(idQuestion, caps));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("application SQL (même avec Mongoose en plus) → la question reste posée", () => {
    const dir = app(
      JSON.stringify({
        dependencies: { "@nodefony/drizzle": "*", "@nodefony/mongoose": "*" },
      }),
    );
    try {
      const caps = scaffoldCaps(dir);
      assert.strictEqual(caps.hasSqlOrm, true);
      assert.ok(idQuestion && capAllows(idQuestion, caps));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hors projet, sans ORM, ou manifeste illisible → on ne tait RIEN", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "nf-caps-out-"));
    const none = app(JSON.stringify({ dependencies: {} }));
    const broken = app("{ pas du json");
    try {
      for (const dir of [outside, none, broken]) {
        const caps = scaffoldCaps(dir);
        assert.strictEqual(caps.hasSqlOrm, undefined, dir);
        assert.ok(idQuestion && capAllows(idQuestion, caps), dir);
      }
    } finally {
      for (const dir of [outside, none, broken])
        rmSync(dir, { recursive: true, force: true });
    }
  });

  it("capAllows : sans askIf toujours vrai ; capacité ABSENTE ≠ capacité fausse", () => {
    assert.ok(capAllows({}, { hasCheckout: false }));
    assert.ok(!capAllows({ askIf: "hasCheckout" }, { hasCheckout: false }));
    assert.ok(capAllows({ askIf: "hasSqlOrm" }, { hasCheckout: false }));
    assert.ok(
      !capAllows(
        { askIf: "hasSqlOrm" },
        { hasCheckout: true, hasSqlOrm: false },
      ),
    );
  });
});

/** Tous les fichiers texte sous `dir` (récursif, `node_modules` et `dist` exclus). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(md|tpl|ts)$/u.test(name)) out.push(abs);
  }
  return out;
}

/** Découpe une ligne de commande en mots, guillemets respectés. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

/** Options de `create entity` qui prennent une valeur — leur valeur n'est pas un champ. */
const VALUED = new Set([
  "--fields",
  "--id",
  "--route",
  "--module",
  "--connector",
  "--dialect",
  "--table",
  "--column-case",
  "--id-name",
  "--index",
  "--unique",
  "--answers-json",
]);

describe("create entity — les EXEMPLES écrits se parsent", () => {
  // Un exemple de commande AGIT : un agent le copie. Celui qui ne passe pas le
  // parseur enseigne une forme refusée (vécu : `!` dans AGENTS.md après #431,
  // `ref:Article` sans nom de champ dans le skill add-crud).
  const sources = [
    ...walk(path.join(core, "templates")),
    path.join(core, "src/cli/scaffold/help.ts"),
    ...walk(devkitSkills),
    ...walk(path.join(core, "docs")),
    ...walk(path.join(repo, "docs/guides")),
  ];
  const examples: Array<{ file: string; fields: string }> = [];
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /create entity ([A-Z][A-Za-z0-9]*)([^\n`|&#]*)/gu,
    )) {
      // Dans un `.ts`, la commande est une chaîne : son guillemet fermant et la
      // virgule qui suit ne font pas partie du dernier mot.
      const tokens = words(match[2] ?? "")
        .map((t) => t.replace(/["']+,?$/u, ""))
        .filter((t) => t.length > 0);
      const fields: string[] = [];
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] ?? "";
        if (token === "--fields") {
          fields.push(tokens[i + 1] ?? "");
          i += 1;
        } else if (VALUED.has(token)) {
          i += 1;
        } else if (
          !token.startsWith("-") &&
          !token.startsWith("<") &&
          !token.includes("…")
        ) {
          fields.push(token);
        }
      }
      if (fields.length > 0) {
        examples.push({
          file: path.relative(repo, file),
          fields: fields.join(" "),
        });
      }
    }
  }

  it("le relevé n'est pas vide (sinon ce test ne garde rien)", () => {
    assert.ok(examples.length >= 10, `${examples.length} exemples relevés`);
  });

  it("chaque exemple passe le VRAI parseur de champs", () => {
    const refused = examples.flatMap(({ file, fields }) => {
      try {
        parseEntityFields(fields);
        return [];
      } catch (e) {
        return [`${file} : « ${fields} » — ${(e as Error).message}`];
      }
    });
    assert.deepStrictEqual(refused, []);
  });
});

/** Nom SQL de chaque constructeur Drizzle — ce qu'une table de doc doit écrire. */
const DRIZZLE_SQL: Readonly<Record<string, string>> = {
  text: "text",
  integer: "integer",
  int: "int",
  real: "real",
  doublePrecision: "double",
  double: "double",
  numeric: "numeric",
  decimal: "decimal",
  varchar: "varchar",
  char: "char",
  boolean: "boolean",
  jsonb: "jsonb",
  json: "json",
  timestamp: "timestamptz",
  datetime: "datetime",
  uuid: "uuid",
};

// Deux copies de la table, pour deux lecteurs : le skill (livré par npm, lu par
// l'agent) et le guide (lu par l'humain). Chacune est confrontée au générateur.
for (const [label, file] of [
  ["skill add-crud", path.join(devkitSkills, "nodefony-add-crud/SKILL.md")],
  ["guide generer-du-code", path.join(repo, "docs/guides/generer-du-code.md")],
] as const)
  describe(`create entity — la table des types (${label}) suit le GÉNÉRATEUR`, () => {
    const skill = readFileSync(file, "utf8");
    const rows = new Map<string, string[]>();
    for (const line of skill.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      const head = /^`([a-z]+)[(:]?/u.exec(cells[1] ?? "")?.[1];
      if (head && cells.length >= 7) rows.set(head, cells.slice(3, 7));
    }
    const firstTick = (cell: string): string =>
      /`([A-Za-z]+)/u.exec(cell)?.[1] ?? "";

    it("chaque type du vocabulaire a sa ligne — et aucune ligne n'est inventée", () => {
      assert.deepStrictEqual(
        [...rows.keys()].sort(),
        [...ENTITY_FIELD_TYPES, "ref"].sort(),
      );
    });

    it("chaque cellule SQL nomme le type que le générateur émet, moteur par moteur", () => {
      const columns = ["sqlite", "postgres", "mysql"] as const;
      const drift: string[] = [];
      for (const { type, byDialect } of describeColumnTypes()) {
        if (type === "ref") continue; // dépend de la clé VISÉE : la note ³ le dit
        columns.forEach((dialect, i) => {
          const fn = /^(\w+)\(/u.exec(byDialect[dialect] ?? "")?.[1] ?? "";
          const written = firstTick(rows.get(type)?.[i] ?? "");
          if (DRIZZLE_SQL[fn] !== written) {
            drift.push(
              `${type} × ${dialect} : doc « ${written} », générateur ${fn} → ${DRIZZLE_SQL[fn]}`,
            );
          }
        });
      }
      assert.deepStrictEqual(drift, []);
    });

    it("chaque cellule MongoDB nomme le type Mongoose que le générateur écrit", () => {
      const drift: string[] = [];
      for (const { type, byDialect } of describeColumnTypes()) {
        const emitted = /type: "?(\w+)/u.exec(byDialect["mongodb"] ?? "")?.[1];
        const written = firstTick(rows.get(type)?.[3] ?? "");
        if (emitted !== written)
          drift.push(`${type} : doc « ${written} », générateur ${emitted}`);
      }
      assert.deepStrictEqual(drift, []);
    });
  });

describe("create entity — correctifs de l'audit, aux limites", () => {
  it("facultatif ET unique : index PARTIEL sur le type — deux `null` ne se heurtent pas", () => {
    assert.deepStrictEqual(lines("email:string?:unique"), [
      'email: { type: String, maxlength: 255, default: null, index: { unique: true, partialFilterExpression: { email: { $type: "string" } } } },',
    ]);
    assert.deepStrictEqual(lines("owner:ref:User?:unique"), [
      'owner: { type: "ObjectId", ref: "User", default: null, index: { unique: true, partialFilterExpression: { owner: { $type: "objectId" } } } }, // → User.id',
    ]);
    // Obligatoire et unique : l'index plein, inchangé.
    assert.deepStrictEqual(lines("sku:string:unique"), [
      "sku: { type: String, maxlength: 255, required: true, unique: true },",
    ]);
  });

  it("corps invalide : `{}` si un champ est obligatoire, sinon le MAUVAIS type, sinon rien", () => {
    const body = (fields: string): string | null =>
      invalidBodyOf(parseEntityFields(fields));
    assert.strictEqual(body("a:string b:int=0"), "{}");
    assert.strictEqual(body("n:int=0"), '{"n":"abc"}');
    assert.strictEqual(body("b:bool=true"), '{"b":"oui"}');
    assert.strictEqual(body("d:date?"), '{"d":"pas-une-date"}');
    assert.strictEqual(body("s:string?"), '{"s":12345}');
    // Le JSON accepte tout : on passe au champ suivant, et sans suivant, rien.
    assert.strictEqual(body("j:json? s:text?"), '{"s":12345}');
    assert.strictEqual(body("j:json?"), null);
  });

  it("les imports se lisent en DÉCLARATIONS entières — multi-ligne, type, dynamique", () => {
    const src =
      'import { Module } from "nodefony";\n' +
      'import {\n  controllers,\n  route,\n} from "@nodefony/framework";\n' +
      'import type { entities } from "@nodefony/orm-core";\n' +
      'import "./side";\n\n' +
      "const m = import.meta.url;\n" +
      'import("./late");\n';
    const end = lastImportEnd(src) ?? -1;
    assert.ok(
      src.slice(0, end).endsWith('import "./side";'),
      src.slice(0, end),
    );
    assert.ok(src.slice(end).startsWith("\n\nconst m = import.meta"));
    assert.ok(importsName(src, "controllers", "@nodefony/framework"));
    assert.ok(importsName(src, "route", "@nodefony/framework"));
    // Un import de TYPE ne rend pas le décorateur disponible à l'exécution.
    assert.ok(!importsName(src, "entities", "@nodefony/orm-core"));
    assert.ok(!importsName(src, "controllers", "nodefony"));
    assert.strictEqual(lastImportEnd("const a = 1;\n"), undefined);
    assert.ok(
      importsName(
        'import { services as s } from "nodefony";',
        "services",
        "nodefony",
      ),
    );
  });

  it("la liste des options SQL vient de la SPEC — refusée, annotée et tue d'une source", () => {
    const [spec] = getScaffoldSpec("entity");
    const sqlOnly = spec.questions
      .filter((q) => q.askIf === "hasSqlOrm")
      .map((q) => q.key)
      .sort();
    assert.deepStrictEqual(sqlOnly, [
      "columnCase",
      "dialect",
      "id",
      "idName",
      "index",
      "table",
      "uniqueIndex",
    ]);
  });
});
