import assert from "node:assert";

import {
  defineEnv,
  envString,
  envNumber,
  envBoolean,
  envEnum,
  getEnvCatalog,
} from "../config/defineEnv";
import type { NamedEnvVarMeta } from "../config/defineEnv";
import { renderEnvExample } from "../config/envExample";
import { composeEnvExample, applyEnvExample, parseEnvArgv } from "../cli/env";
import * as fsForExample from "node:fs";
import * as osForExample from "node:os";
import * as pathForExample from "node:path";

describe("defineEnv — introspection (getEnvCatalog)", () => {
  it("expose les métadonnées de chaque variable (kind/default/optional/values/desc)", () => {
    const env = defineEnv(
      {
        NF_DRIVER: envEnum(["stdout", "file"] as const, {
          default: "stdout",
          description: "Sink de log.",
        }),
        NF_SYNC: envBoolean({ default: false }),
        NF_PORT: envNumber({ optional: true }),
        NF_URL: envString({ optional: true, description: "URL Loki." }),
      },
      {}, // source vide → défauts/undefined, aucun requis → defineEnv ne lève pas
    );
    const cat = getEnvCatalog(env);
    assert.strictEqual(cat.length, 4);
    const by = Object.fromEntries(cat.map((m) => [m.name, m]));
    assert.strictEqual(by.NF_DRIVER.kind, "enum");
    assert.deepStrictEqual(by.NF_DRIVER.values, ["stdout", "file"]);
    assert.strictEqual(by.NF_DRIVER.default, "stdout");
    assert.strictEqual(by.NF_DRIVER.optional, false);
    assert.strictEqual(by.NF_DRIVER.description, "Sink de log.");
    assert.strictEqual(by.NF_SYNC.kind, "boolean");
    assert.strictEqual(by.NF_SYNC.default, false);
    assert.strictEqual(by.NF_PORT.kind, "number");
    assert.strictEqual(by.NF_PORT.optional, true);
    assert.strictEqual(by.NF_PORT.default, undefined);
    assert.strictEqual(by.NF_URL.kind, "string");
    assert.strictEqual(by.NF_URL.optional, true);
  });

  it("le catalogue est NON-énumérable (n'altère pas les valeurs de `env`)", () => {
    const env = defineEnv({ NF_X: envString({ default: "a" }) }, {});
    assert.deepStrictEqual(Object.keys(env), ["NF_X"]); // pas de clé parasite
    assert.strictEqual(env.NF_X, "a");
  });

  it("objet non reconnu → []", () => {
    assert.deepStrictEqual(getEnvCatalog({ foo: 1 }), []);
    assert.deepStrictEqual(getEnvCatalog(null), []);
  });
});

describe("envExample — renderEnvExample", () => {
  const cat: NamedEnvVarMeta[] = [
    {
      name: "NF_DRIVER",
      kind: "enum",
      optional: false,
      default: "stdout",
      values: ["stdout", "file", "null"],
      description: "Sink de log.",
    },
    {
      name: "NF_PORT",
      kind: "number",
      optional: true,
      description: "Port optionnel.",
    },
    {
      name: "NF_REQUIRED",
      kind: "string",
      optional: false,
      description: "Champ requis.",
    },
    {
      name: "GITHUB_CLIENT_SECRET",
      kind: "string",
      optional: true,
      description: "Secret OAuth.",
    },
  ];

  it("rend chaque variable COMMENTÉE avec doc + drapeaux", () => {
    const out = renderEnvExample(cat);
    assert.match(out, /# Sink de log\./);
    assert.match(out, /valeurs: stdout \| file \| null/);
    assert.match(out, /défaut: stdout/);
    assert.match(out, /# NF_DRIVER=stdout/);
    assert.match(out, /# NF_PORT=$/m); // optionnel sans défaut → vide
    assert.match(out, /optionnel/);
    assert.match(out, /REQUIS/);
  });

  it("masque la valeur des variables sensibles (secret)", () => {
    const out = renderEnvExample(cat);
    assert.match(out, /# GITHUB_CLIENT_SECRET=$/m); // jamais de valeur
    assert.match(out, /secret → \.env\.local/);
  });

  it("place l'en-tête curé en tête", () => {
    const out = renderEnvExample(cat, { header: "# MODÈLE" });
    assert.ok(out.startsWith("# MODÈLE\n"));
  });

  it("AUCUNE ligne de variable n'est active (un .example ne pose rien)", () => {
    const out = renderEnvExample(cat);
    const active = out.split("\n").filter((l) => /^[A-Z]/.test(l));
    assert.deepStrictEqual(active, []);
  });

  it("se termine par UN saut de ligne, jamais plusieurs", () => {
    assert.ok(renderEnvExample(cat).endsWith("\n"));
    assert.doesNotMatch(renderEnvExample(cat), /\n\n$/u);
    assert.doesNotMatch(
      renderEnvExample(cat, { header: "# H\n\n\n" }),
      /\n\n$/u,
    );
  });

  it("catalogue vide et en-tête blanc → fichier VIDE (pas une ligne vide)", () => {
    // Le rendu par `/\n+$/` laissait ici un `"\n"` solitaire : un en-tête fait
    // de blancs n'est pas un en-tête, et un fichier d'une ligne vide n'est pas
    // un fichier vide. Bord figé — c'est le SEUL écart avec l'ancien rendu.
    assert.strictEqual(renderEnvExample([]), "");
    assert.strictEqual(renderEnvExample([], { header: "   " }), "");
  });
});

describe("env --example — composition et application (la commande)", () => {
  const { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } =
    fsForExample;
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(pathForExample.join(osForExample.tmpdir(), "nf-envex-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const catalogue = () =>
    getEnvCatalog(
      defineEnv(
        {
          NF_DRIVER: envEnum(["stdout", "file"] as const, {
            default: "stdout",
          }),
          NF_API_SECRET: envString({ optional: true }),
        },
        {},
      ),
    );

  it("composeEnvExample : en-tête GÉNÉRIQUE (la commande, pas le script du dépôt)", () => {
    const out = composeEnvExample(catalogue());
    assert.match(out, /npx nodefony env --example/u);
    assert.match(out, /# NF_DRIVER=stdout/u);
    // Un secret ne reçoit JAMAIS de valeur d'exemple (règle du rendu).
    assert.match(out, /# NF_API_SECRET=\n/u);
  });

  it("🔴 applyEnvExample : pose, IDEMPOTENT au mtime, --check dit la dérive sans écrire", () => {
    const contenu = composeEnvExample(catalogue());
    const target = pathForExample.join(root, ".env.example");

    // check sur fichier ABSENT : désync, rien d'écrit.
    assert.deepStrictEqual(applyEnvExample(root, contenu, true), {
      synced: false,
      wrote: false,
    });
    assert.throws(() => readFileSync(target, "utf8"));

    // pose.
    assert.deepStrictEqual(applyEnvExample(root, contenu, false), {
      synced: true,
      wrote: true,
    });
    assert.strictEqual(readFileSync(target, "utf8"), contenu);

    // idempotence FORTE : le second passage ne touche pas au fichier.
    const avant = statSync(target).mtimeMs;
    assert.deepStrictEqual(applyEnvExample(root, contenu, false), {
      synced: true,
      wrote: false,
    });
    assert.strictEqual(statSync(target).mtimeMs, avant);

    // édité à la main → --check le dit, et n'écrase PAS.
    writeFileSync(target, `${contenu}\n# ajout manuel\n`);
    assert.deepStrictEqual(applyEnvExample(root, contenu, true), {
      synced: false,
      wrote: false,
    });
    assert.match(readFileSync(target, "utf8"), /ajout manuel/u);
  });

  it("--check sans --example est un refus d'usage", () => {
    const parsed = parseEnvArgv(["node", "nodefony", "env", "--check"]);
    assert.ok("error" in parsed);
  });
});
