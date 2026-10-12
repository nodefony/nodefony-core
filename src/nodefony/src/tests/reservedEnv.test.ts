import { describe, it } from "vitest";
import { assert } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESERVED_ENV } from "../config/reservedEnv";

/**
 * Le registre des variables RÉSERVÉES ne doit pas se périmer.
 *
 * Il existe parce que `nodefony env` accusait l'utilisateur de fautes de frappe
 * sur des variables que le framework pose lui-même. Une liste écrite à la main
 * répare le jour où on l'écrit et ment le mois suivant : ce contrôle relit donc
 * les SOURCES du runtime et exige que chaque `NF_*` qu'elles lisent soit
 * expliquée — par le catalogue d'une application, par le registre réservé, ou
 * par une famille dont le nom dit déjà qu'elle n'appartient pas à une app
 * installée (bancs et interrupteurs de coût du dépôt).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** Racine du dépôt : `src/nodefony/src/tests` → quatre crans plus haut. */
const REPO = path.resolve(ICI, "..", "..", "..", "..");

/** Les fichiers `.ts` du runtime — tests, bancs et `dist/` exclus. */
function sourcesDuRuntime(): string[] {
  const racines = [
    path.join(REPO, "src", "nodefony", "src"),
    path.join(REPO, "src", "packages", "@nodefony"),
  ];
  const out: string[] = [];
  const exclu = (p: string): boolean =>
    /(^|[/\\])(dist|node_modules|tests?|templates)([/\\]|$)/u.test(p) ||
    /\.(test|spec)\.tsx?$/u.test(p);
  const marcher = (dir: string): void => {
    let entrees: string[];
    try {
      entrees = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entrees) {
      const complet = path.join(dir, e);
      if (exclu(complet)) continue;
      if (statSync(complet).isDirectory()) marcher(complet);
      else if (complet.endsWith(".ts") || complet.endsWith(".tsx"))
        out.push(complet);
    }
  };
  for (const r of racines) marcher(r);
  return out;
}

/**
 * Familles dont le nom dit qu'elles n'ont pas de place dans une application
 * installée : elles n'arrivent que dans le dépôt, sous une commande de test.
 */
const FAMILLES_DU_DEPOT = [
  /^NF_RUN_/u,
  /^NF_BENCH_/u,
  /_TEST_URL$/u,
  /^NF_TEST_/u,
  /^NF_PROXY_/u,
  /^NF_WS_RUPTURE/u,
  /^NF_PERF_COUNT$/u,
  /^NF_RT_CHANNEL$/u,
  /^NF_CLI_(TIMEOUT_MS|READY_TIMEOUT_MS)$/u,
];

/** Retire les commentaires d'un source (`//` hors URL, et blocs). */
function sansCommentaires(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

/** Les raccourcis déclarés dans les schémas des modules : `.meta({ env: "NF_X" })`. */
function raccourcisDesSchemas(): { nom: string; fichier: string }[] {
  const out: { nom: string; fichier: string }[] = [];
  for (const fichier of sourcesDuRuntime()) {
    if (!fichier.endsWith(path.join("config", "config.ts"))) continue;
    const src = sansCommentaires(readFileSync(fichier, "utf8"));
    for (const m of src.matchAll(/\benv:\s*"([A-Za-z0-9_]+)"/gu)) {
      out.push({ nom: m[1]!, fichier: path.relative(REPO, fichier) });
    }
  }
  return out;
}

describe("raccourcis déclarés dans les schémas (`.meta({ env })`)", () => {
  it("chaque nom court suit la forme NF_<MODULE>_<RÉGLAGE>", () => {
    // Le préfixe dit À QUI appartient la variable (règle NF_ du dépôt) ; une
    // minuscule ou un `NF__` serait lu comme autre chose par le chargeur.
    const fautifs = raccourcisDesSchemas().filter(
      (v) => !/^NF_[A-Z0-9]+(_[A-Z0-9]+)+$/u.test(v.nom),
    );
    assert.deepEqual(fautifs, []);
  });

  it("un module qui déclare un nom court DÉCLARE aussi son schéma (package.json)", () => {
    // Sans `nodefony.configSchema`, `nodefony env` ne trouve pas le schéma :
    // le nom court serait appliqué au boot mais rendu « lu par personne ».
    const sansDeclaration = [
      ...new Set(
        raccourcisDesSchemas().map(
          (v) => v.fichier.split(/[\\/]nodefony[\\/]config[\\/]/u)[0]!,
        ),
      ),
    ].filter((racine) => {
      const pkg = JSON.parse(
        readFileSync(path.join(REPO, racine, "package.json"), "utf8"),
      ) as { nodefony?: { configSchema?: unknown } };
      return typeof pkg.nodefony?.configSchema !== "string";
    });
    assert.deepEqual(sansDeclaration, []);
  });

  it("chaque nom n'est déclaré qu'UNE fois, et jamais aussi au cœur", () => {
    const vus = raccourcisDesSchemas();
    assert.isAbove(
      vus.length,
      0,
      "aucun raccourci lu — l'extraction est à revoir",
    );
    const doublons = vus
      .map((v) => v.nom)
      .filter((n, i, all) => all.indexOf(n) !== i);
    assert.deepEqual(doublons, [], "un même nom réglerait deux champs");
    // Déclaré ET recopié dans la table : c'est la double écriture que le
    // raccourci existe pour supprimer — la table ne garde que le cœur.
    assert.deepEqual(
      vus.filter((v) => Object.hasOwn(RESERVED_ENV, v.nom)),
      [],
      "à retirer de RESERVED_ENV : le schéma du module le déclare déjà",
    );
  });
});

describe("registre des variables réservées au framework", () => {
  it("explique CHAQUE NF_ que le runtime lit — sinon `nodefony env` l'accuse", () => {
    // Le catalogue qu'une application déclare : ce que le gabarit `env.ts`
    // installe chez elle. Ces noms-là sont légitimement « connus » sans être
    // réservés — c'est l'app qui les possède.
    const gabarit = readFileSync(
      path.join(
        REPO,
        "src",
        "nodefony",
        "templates",
        "app",
        "base",
        "env.ts.tpl",
      ),
      "utf8",
    );
    // Plus le catalogue de l'application de DÉVELOPPEMENT (le dépôt en est
    // une) : une variable qu'elle déclare, un module la lit par `ctx.env.X`.
    const racine = readFileSync(path.join(REPO, "env.ts"), "utf8");
    const duCatalogue = new Set(
      [gabarit, racine].flatMap((src) =>
        [...src.matchAll(/^\s{2}(NF_[A-Z0-9_]+):/gmu)].map((m) => m[1]),
      ),
    );
    assert.isAbove(
      duCatalogue.size,
      5,
      "le catalogue du gabarit n'a pas été lu — l'extraction est à revoir",
    );

    const orphelines = new Set<string>();
    for (const fichier of sourcesDuRuntime()) {
      // Les COMMENTAIRES ne lisent rien : un TSDoc qui cite `env.NF_X` en
      // exemple passait pour une lecture (vécu sur `envShortcuts.ts`).
      const src = sansCommentaires(readFileSync(fichier, "utf8"));
      // TOUTES les formes de lecture, pas seulement `process.env.NF_X` : le
      // contrôle n'en connaissait qu'une et restait vert pendant que `nodefony
      // env` déclarait « sans effet » `NF_REDIS_HOST` — lue par `env.NF_REDIS_HOST`
      // après un `const env = process.env`. Formes couvertes : `<x>env.NF_X`,
      // `<x>env["NF_X"]`, `env("NF_X")`, et la constante `<NOM>_ENV = "NF_X"`
      // passée ensuite à `process.env[…]`.
      for (const m of src.matchAll(
        /(?:[A-Za-z_]*[eE]nv(?:\??\.|\[\s*["'`]|\(\s*["'`])|_ENV\s*=\s*["'`])(NF_[A-Z0-9_]+)/gu,
      )) {
        const nom = m[1];
        // `NF__MODULE__CHEMIN` est une surcharge de config, jamais une variable.
        if (nom!.startsWith("NF__")) continue;
        if (Object.hasOwn(RESERVED_ENV, nom!)) continue;
        if (duCatalogue.has(nom)) continue;
        if (FAMILLES_DU_DEPOT.some((r) => r.test(nom!))) continue;
        orphelines.add(nom!);
      }
    }

    assert.deepEqual(
      [...orphelines].sort(),
      [],
      "variables lues par le runtime que rien n'explique : les déclarer dans " +
        "`RESERVED_ENV` (avec leur rôle) si le framework les possède, ou dans " +
        "le catalogue du gabarit si l'application les configure",
    );
  });

  it("ne réserve QUE des variables que le runtime lit vraiment", () => {
    // Le sens inverse, et il compte autant : une entrée périmée masquerait une
    // vraie faute de frappe sur un nom que plus personne ne lit.
    const lues = new Set<string>();
    for (const fichier of sourcesDuRuntime()) {
      // 🔴 Le registre lui-même est exclu, sinon le contrôle s'auto-satisfait :
      // toute entrée s'y trouve écrite, donc toute entrée passait pour « lue ».
      // Vu au débranchement — une entrée inventée survivait sans un mot.
      if (fichier.endsWith(path.join("config", "reservedEnv.ts"))) continue;
      const src = readFileSync(fichier, "utf8");
      for (const m of src.matchAll(/(?:process\.env\.)?(NF_[A-Z0-9_]+)/gu))
        lues.add(m[1]!);
    }
    const mortes = Object.keys(RESERVED_ENV).filter((n) => !lues.has(n));
    assert.deepEqual(
      mortes,
      [],
      "entrées réservées que plus aucun source ne mentionne — les retirer",
    );
  });
});
