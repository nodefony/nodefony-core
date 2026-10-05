import assert from "node:assert";
import { vi } from "vitest";

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
import {
  composeEnvExample,
  applyEnvExample,
  parseEnvArgv,
  readExampleHeader,
} from "../cli/env";
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
    assert.strictEqual(by.NF_DRIVER!.kind, "enum");
    assert.deepStrictEqual(by.NF_DRIVER!.values, ["stdout", "file"]);
    assert.strictEqual(by.NF_DRIVER!.default, "stdout");
    assert.strictEqual(by.NF_DRIVER!.optional, false);
    assert.strictEqual(by.NF_DRIVER!.description, "Sink de log.");
    assert.strictEqual(by.NF_SYNC!.kind, "boolean");
    assert.strictEqual(by.NF_SYNC!.default, false);
    assert.strictEqual(by.NF_PORT!.kind, "number");
    assert.strictEqual(by.NF_PORT!.optional, true);
    assert.strictEqual(by.NF_PORT!.default, undefined);
    assert.strictEqual(by.NF_URL!.kind, "string");
    assert.strictEqual(by.NF_URL!.optional, true);
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
    assert.match(out, /^# @type=enum\(stdout, file, null\)$/m);
    assert.match(out, /# NF_DRIVER=stdout/);
    assert.match(out, /# NF_PORT=$/m); // optionnel sans défaut → vide
    assert.match(out, /^# @optional$/m);
    assert.match(out, /^# @required$/m);
  });

  it("🔴 CONVENTION : bandeau de titre, explication repliée, décorateurs @, @default TOUJOURS", () => {
    const out = renderEnvExample([
      {
        name: "NF_DRIVER",
        kind: "enum",
        optional: false,
        default: "stdout",
        values: ["stdout", "file"],
        title: "Destination des journaux",
        description: "Où partent les journaux.",
      },
      {
        name: "NF_ADMIN_PASSWORD",
        kind: "string",
        optional: true,
        requiredIn: ["production"],
        defaultNote: "secret-de-dev-42 en dev, aucun en production",
        title: "Mot de passe administrateur",
        description:
          "Le compte admin est créé au premier démarrage.\nAnnonce :\n    nodefony security:secrets\nSuite.",
        example: "un-mot-de-passe-long",
      },
      { name: "NF_NU", kind: "string", optional: true },
    ]);
    const band = (t: string): string => {
      const head = `# ─── ${t} `;
      return head + "─".repeat(78 - head.length);
    };
    assert.ok(
      out.includes(
        [
          band("Destination des journaux"),
          "#",
          "# Où partent les journaux.",
          "#",
          "# @optional",
          "# @type=enum(stdout, file)",
          "# @default=stdout",
          "# NF_DRIVER=stdout",
          "",
          "",
          band("Mot de passe administrateur"),
          "#",
          "# Le compte admin est créé au premier démarrage.",
          "#",
          "# Annonce :",
          "#     nodefony security:secrets",
          "#",
          "# Suite.",
          "#",
          "# @optional",
          "# @required=forEnv(production)",
          "# @sensitive",
          '# @default="secret-de-dev-42 en dev, aucun en production"',
          "# @example=un-mot-de-passe-long",
          "# NF_ADMIN_PASSWORD=",
          "",
          "",
          // Sans titre : le nom sert de bandeau ; sans défaut : « aucun ».
          band("NF_NU"),
          "#",
          "# @optional",
          "# @default=aucun",
          "# NF_NU=",
        ].join("\n"),
      ),
      out,
    );
    // Une explication longue est repliée à 78 colonnes.
    const long = renderEnvExample([
      {
        name: "NF_LONG",
        kind: "string",
        optional: true,
        description: "mot ".repeat(60).trim(),
      },
    ]);
    for (const line of long.split("\n")) {
      assert.ok(
        line.length <= 78,
        `ligne de ${line.length} colonnes : ${line}`,
      );
    }
    // Toute ligne de métadonnée se lit d'UNE expression régulière.
    const decorators = out
      .split("\n")
      .filter((l) => l.startsWith("# @"))
      .map((l) => /^# @(\w+)(?:=(.*))?$/u.exec(l)?.[1]);
    assert.ok(decorators.every(Boolean), "un décorateur illisible");
    assert.deepStrictEqual([...new Set(decorators)].sort(), [
      "default",
      "example",
      "optional",
      "required",
      "sensitive",
      "type",
    ]);
  });

  it("🔴 SECTIONS : sommaire en tête, sections numérotées dans l'ordre d'apparition", () => {
    const v = (name: string, section?: string): (typeof cat)[number] => ({
      name,
      kind: "string",
      optional: true,
      ...(section ? { section } : {}),
    });
    const out = renderEnvExample([
      v("NF_PORT", "Réseau"),
      v("NF_KC_ISSUER", "Connexion Keycloak"),
      v("NF_LIBRE"),
      v("NF_PORT_HTTPS", "Réseau"),
      v("NF_KC_SECRET", "Connexion Keycloak"),
    ]);
    // Le sommaire dit OÙ chercher : section numérotée, puis ses variables.
    assert.ok(
      out.includes(
        [
          "#   1. Réseau",
          "#        NF_PORT, NF_PORT_HTTPS",
          "#   2. Connexion Keycloak",
          "#        NF_KC_ISSUER, NF_KC_SECRET",
          "#   3. Autres réglages",
          "#        NF_LIBRE",
        ].join("\n"),
      ),
      out,
    );
    // Les variables d'une section sont REGROUPÉES, même déclarées en désordre.
    const order = [...out.matchAll(/^# (NF_\w+)=/gmu)].map((m) => m[1]);
    assert.deepStrictEqual(order, [
      "NF_PORT",
      "NF_PORT_HTTPS",
      "NF_KC_ISSUER",
      "NF_KC_SECRET",
      "NF_LIBRE",
    ]);
    // Le bandeau de section est un SÉPARATEUR @env-spec (`# ===`), encadrant
    // un commentaire autonome.
    assert.match(out, /^# ={76}\n#  2\. CONNEXION KEYCLOAK\n# ={76}$/mu);
    // Une seule section : ni sommaire ni bandeau — rien d'inutile.
    const single = renderEnvExample([v("NF_A"), v("NF_B")]);
    assert.doesNotMatch(single, /SOMMAIRE|^# ===/mu);
  });

  it("🔴 `sensitive` DÉCLARÉ fait foi — le nom ne décide qu'à défaut", () => {
    const out = renderEnvExample([
      // « KEY » dans KEYCLOAK : le nom tromperait, la déclaration tranche.
      {
        name: "NF_KEYCLOAK_ISSUER",
        kind: "string",
        optional: true,
        sensitive: false,
        default: "https://kc.example/realms/app",
      },
      // Un nom anodin peut porter un secret : déclaré, il est masqué.
      {
        name: "NF_DSN",
        kind: "string",
        optional: true,
        sensitive: true,
        default: "postgres://u:p@h/db",
      },
      // Sans déclaration, le nom décide (repli).
      { name: "NF_API_TOKEN", kind: "string", optional: true },
    ]);
    const block = (name: string): string =>
      out.split("\n\n\n").find((b) => b.includes(`# ${name}=`)) ?? "";
    assert.doesNotMatch(block("NF_KEYCLOAK_ISSUER"), /@sensitive/u);
    assert.match(block("NF_KEYCLOAK_ISSUER"), /# NF_KEYCLOAK_ISSUER=https:/u);
    assert.match(block("NF_DSN"), /@sensitive/u);
    assert.match(
      block("NF_DSN"),
      /# NF_DSN=$/mu,
      "un secret n'a jamais de valeur",
    );
    assert.match(block("NF_API_TOKEN"), /@sensitive/u);
  });

  it("masque la valeur des variables sensibles (secret)", () => {
    const out = renderEnvExample(cat);
    assert.match(out, /# GITHUB_CLIENT_SECRET=$/m); // jamais de valeur
    assert.match(out, /^# @sensitive$/m);
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

describe("env --example — en-tête curé du projet (.env.example.head)", () => {
  const { mkdtempSync, rmSync, writeFileSync } = fsForExample;

  it("🔴 l'en-tête custom PRIME, le corps reste dérivé du catalogue", () => {
    const cat = getEnvCatalog(
      defineEnv({ NF_X: envString({ optional: true }) }, {}),
    );
    const custom = composeEnvExample(cat, "# MON ONBOARDING À MOI");
    assert.match(custom, /^# MON ONBOARDING À MOI\n/u);
    assert.doesNotMatch(custom, /npx nodefony env --example/u);
    assert.match(custom, /# NF_X=/u);
    // Sans custom : l'en-tête générique.
    assert.match(composeEnvExample(cat), /npx nodefony env --example/u);
    // La règle des deux fichiers, dite à qui ouvre la notice.
    assert.match(composeEnvExample(cat), /\.env +TES valeurs.*JAMAIS commité/u);
    assert.match(composeEnvExample(cat), /cp \.env\.example \.env/u);
    assert.doesNotMatch(composeEnvExample(cat), /\.env\.local/u);
  });

  it("readExampleHeader : le fichier s'il existe, null sinon", () => {
    const root = mkdtempSync(
      pathForExample.join(osForExample.tmpdir(), "nf-envhead-"),
    );
    try {
      assert.strictEqual(readExampleHeader(root), null);
      writeFileSync(
        pathForExample.join(root, ".env.example.head"),
        "# curé\n\n",
      );
      assert.strictEqual(readExampleHeader(root), "# curé");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("catalogue d'env — reconnu entre DEUX instances de nodefony (#304)", () => {
  it("🔴 un env construit par une autre instance du module est lu", async () => {
    // `npm create nodefony` tourne dans l'instance du cache npx ; l'`env.ts` de
    // l'app importe le `nodefony` de l'app. Deux instances, deux `Symbol()` :
    // zéro variable, et un doctor qui accuse un build absent.
    vi.resetModules();
    const autre = await import("../config/defineEnv");
    assert.notStrictEqual(
      autre.defineEnv,
      defineEnv,
      "le décor exige deux instances",
    );
    const env = autre.defineEnv(
      { NF_X: autre.envString({ default: "1", description: "x" }) },
      {},
    );
    assert.strictEqual(getEnvCatalog(env).length, 1);
    assert.strictEqual(getEnvCatalog(env)[0]?.name, "NF_X");
  });
});
