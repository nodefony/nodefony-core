import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * ÉTAGE 1 — UNITAIRE : ni serveur, ni base, ni port.
 *
 * Ce que cet étage attrape et qu'aucun autre ne peut voir : les défauts qui
 * survivent au boot. Une application dont un service n'est pas déclaré démarre
 * très bien — elle échoue le jour où quelqu'un l'injecte. Un gabarit dont une
 * balise n'a pas été résolue compile parfois. Une variable d'environnement lue
 * hors du catalogue fonctionne sur le poste qui l'a posée.
 *
 * Tout est lu sur le DISQUE de l'application générée, jamais sur les gabarits :
 * un gabarit rend une forme, l'application en reçoit une autre — celle où le
 * nom choisi par l'utilisateur a été substitué.
 */

/** Racine de l'application témoin — ces suites tournent depuis elle. */
const APP = process.cwd();

/**
 * Les sources ÉCRITES de l'application : son propre code, jamais celui qu'elle
 * a installé ni celui qu'elle a compilé.
 *
 * `dist/` et `node_modules/` sont écartés parce qu'ils contiennent du code du
 * framework — l'y inclure ferait échouer chaque règle sur du code qui n'est pas
 * celui du générateur, et le verdict accuserait le mauvais auteur.
 */
function sourcesApp(): string[] {
  const ignores = new Set([
    "node_modules",
    "dist",
    ".git",
    "var",
    "tmp",
    "tarballs",
    "logs",
    // Les suites de conformité elles-mêmes. Sans cette ligne, la sonde compte
    // ses PROPRES motifs de recherche comme des défauts du produit : `any`,
    // `require(`, les jetons de gabarit qu'elle traque vivent dans son code.
    // Dix cas sur onze sont tombés ainsi au premier run, tous en accusant le
    // générateur.
    "tests-conformite",
  ]);
  const out: string[] = [];
  const parcourir = (dir: string, profondeur: number): void => {
    if (profondeur > 6) return;
    for (const e of readdirSync(dir)) {
      if (ignores.has(e)) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) parcourir(p, profondeur + 1);
      else if (/\.(ts|tsx|mts)$/.test(e)) out.push(p);
    }
  };
  parcourir(APP, 0);
  return out;
}

const SOURCES = sourcesApp();
const lire = (p: string): string => readFileSync(p, "utf8");
const relatif = (p: string): string => path.relative(APP, p);

/**
 * Le fichier PRIVÉ de ses commentaires — ce qui s'exécute, et rien d'autre.
 *
 * Deux cas rouges au premier run, tous deux faux : un commentaire du module
 * généré documente la forme d'override `NF__BLOG__<CHEMIN>`, et un autre
 * affirme — en toutes lettres — « aucune lecture de `process.env` ». Un
 * contrôle qui lit les commentaires condamne un fichier pour avoir EXPLIQUÉ la
 * règle qu'il respecte.
 *
 * L'heuristique est volontairement simple, et penche du bon côté : un `//`
 * précédé de `:` est laissé en place (c'est une URL), le reste de la ligne
 * part. Elle peut manquer un défaut caché en fin de ligne après une chaîne
 * contenant `//` ; elle n'en invente jamais.
 */
const codeSeul = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("unit — le diagnostic du framework, sur l'application produite", () => {
  it("l'application a des sources à examiner (garde anti-suite creuse)", () => {
    // Sans ce cas, une erreur de chemin rendrait TOUS les suivants verts en
    // n'ayant rien lu — le faux vert le plus facile à fabriquer.
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it("`nodefony doctor` passe sur l'application générée", () => {
    // La commande du framework fait autorité : ce qu'un module importe, il doit
    // le déclarer. On l'APPELLE plutôt que de réimplémenter sa règle ici.
    //
    // 🔴 Le RAPPORT est remonté dans le message d'échec. `.not.toThrow()`
    // rendait « Command failed: …/bin/nodefony doctor » et rien d'autre : le
    // diagnostic, qui existait et nommait précisément le manquement, restait
    // dans un tuyau que personne ne lisait. La forge a passé une journée rouge
    // sans que le log dise POURQUOI — il fallait reproduire à la main ce que
    // la commande avait déjà écrit.
    const bin = path.resolve("node_modules/nodefony/bin/nodefony");
    let rapport = "";
    let code: number | null = null;
    try {
      rapport = execFileSync(process.execPath, [bin, "doctor"], {
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      code = 0;
    } catch (e) {
      const erreur = e as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      code = erreur.status ?? 1;
      rapport = `${erreur.stdout ?? ""}${erreur.stderr ?? ""}`;
    }
    expect(
      code,
      `\`nodefony doctor\` a refusé l'application générée :\n${rapport}`,
    ).toBe(0);
  });
});

describe("unit — le générateur n'a laissé aucune trace de lui-même", () => {
  it("aucune balise de gabarit non résolue dans le code livré", () => {
    // `<%` et `%>` sont la syntaxe eta. Une balise qui survit signifie qu'une
    // branche du gabarit n'a pas été évaluée : le fichier peut compiler et
    // rester faux.
    const coupables = SOURCES.filter((p) => /<%|%>/.test(lire(p))).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun jeton de substitution non remplacé (__PASCAL__, __KEBAB__, __NAME__)", () => {
    // Les TROIS jetons que le scaffold substitue dans les noms de fichiers,
    // nommés plutôt que devinés par une forme. Un motif générique
    // (`__[A-Z]{3,}__`) attrape `NF__BLOG__<CHEMIN>` — la surcharge de config
    // par l'environnement, qui est légitime et documentée dans le module généré.
    const jetons = /__(PASCAL|KEBAB|NAME|CAMEL|SNAKE)__/;
    const coupables = SOURCES.filter((p) => jetons.test(lire(p))).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun identifiant `undefined` interpolé dans un nom", () => {
    // Symptôme d'une variable de gabarit absente : `class undefinedService`,
    // `"undefined-index"`. Le code compile, la route s'appelle « undefined ».
    const coupables = SOURCES.filter((p) =>
      /\b(class|function|const|interface)\s+undefined/.test(lire(p)),
    ).map(relatif);
    expect(coupables).toEqual([]);
  });
});

describe("unit — les règles TypeScript du framework valent pour ce qu'il produit", () => {
  it("aucun `any` explicite dans le code généré", () => {
    // Le framework s'interdit `any` ; ce qu'il écrit pour autrui doit tenir la
    // même règle, sinon le premier fichier d'une application neuve la viole.
    const coupables = SOURCES.filter((p) =>
      /:\s*any\b|<any>|as\s+any\b/.test(codeSeul(lire(p))),
    ).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun `@ts-ignore` ni `@ts-nocheck`", () => {
    const coupables = SOURCES.filter((p) =>
      /@ts-(ignore|nocheck)/.test(codeSeul(lire(p))),
    ).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun `require(` — le framework est ESM seul", () => {
    const coupables = SOURCES.filter((p) =>
      /(^|[^.\w])require\s*\(/m.test(codeSeul(lire(p))),
    ).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("tout import de la bibliothèque standard porte le préfixe `node:`", () => {
    const nus =
      /from\s+["'](fs|path|os|url|http|https|crypto|child_process|events|stream|util|zlib|net|tls|dns|assert)["']/;
    const coupables = SOURCES.filter((p) => nus.test(codeSeul(lire(p)))).map(
      relatif,
    );
    expect(coupables).toEqual([]);
  });
});

describe("unit — l'environnement passe par le catalogue, et par lui seul", () => {
  /** Le catalogue typé de l'application : `env.ts` à sa racine. */
  const ENV_TS = path.join(APP, "env.ts");

  it("le catalogue `env.ts` existe", () => {
    expect(existsSync(ENV_TS)).toBe(true);
  });

  it("`env.ts` est le SEUL fichier qui lit `process.env`", () => {
    // La règle du framework, appliquée à ce qu'il génère. Un second lecteur ne
    // casse rien tout de suite : il rend une variable invisible à
    // `nodefony env`, donc absente de tout diagnostic, et le jour où elle
    // manque en production personne ne sait qu'elle existait.
    //
    // Les tests sont exclus : un décor de test POSE son environnement, c'est
    // son rôle — et il ne s'exécute jamais en production.
    const coupables = SOURCES.filter((p) => {
      if (p === ENV_TS) return false;
      if (/(^|[\\/])tests?[\\/]|\.test\.ts$|\.setup\.ts$/.test(relatif(p)))
        return false;
      return /process\.env\b/.test(codeSeul(lire(p)));
    }).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("toute variable `NF_*` citée dans le code est déclarée au catalogue", () => {
    const catalogue = lire(ENV_TS);
    const citees = new Set<string>();
    for (const p of SOURCES) {
      if (p === ENV_TS) continue;
      // Même exclusion que ci-dessus : un décor de test pose son environnement.
      if (/(^|[\\/])tests?[\\/]|\.test\.ts$|\.setup\.ts$/.test(relatif(p)))
        continue;
      for (const m of codeSeul(lire(p)).matchAll(/\bNF_[A-Z0-9_]+\b/g)) {
        // `NF__MODULE__CLE` n'est pas une variable du catalogue : c'est la
        // surcharge d'un CHEMIN de configuration par l'environnement. Le double
        // souligné est sa signature, et elle se lit sans ambiguïté.
        if (m[0].startsWith("NF__")) continue;
        citees.add(m[0]);
      }
    }
    const inconnues = [...citees].filter((v) => !catalogue.includes(v)).sort();
    expect(inconnues).toEqual([]);
  });
});

describe("unit — ce que l'application déclare d'elle-même", () => {
  const INDEX = lire(path.join(APP, "index.ts"));

  it("le point d'entrée déclare ses services par `@services([…])`", () => {
    expect(INDEX).toMatch(/@services\s*\(\s*\[/);
  });

  it("chaque service écrit sous `nodefony/service/` est DÉCLARÉ au module", () => {
    // Écrire une classe `@injectable()` ne la fait pas exister : c'est la liste
    // du décorateur qui l'enregistre au conteneur. Un service généré mais non
    // déclaré est invisible — et l'erreur ne survient qu'à l'injection.
    const dir = path.join(APP, "nodefony", "service");
    if (!existsSync(dir)) return;
    // Le critère est le DÉCORATEUR, pas le nom du fichier : `create entity`
    // écrit aussi des `*Service.ts`, qui ne sont pas des services du conteneur
    // — leur controller les instancie. Les compter ici accuserait le générateur
    // de ne pas déclarer ce qui n'a pas à l'être.
    const classes = readdirSync(dir)
      .filter((f) => f.endsWith("Service.ts"))
      .filter((f) => /@injectable\s*\(/.test(lire(path.join(dir, f))))
      .map((f) => f.replace(/\.ts$/, ""));
    const absents = classes.filter((c) => !INDEX.includes(c));
    expect(absents).toEqual([]);
  });

  it("chaque commande écrite sous `nodefony/command/` est ajoutée au module", () => {
    const dir = path.join(APP, "nodefony", "command");
    if (!existsSync(dir)) return;
    const classes = readdirSync(dir)
      .filter((f) => f.endsWith("Command.ts"))
      .map((f) => f.replace(/\.ts$/, ""));
    const absents = classes.filter((c) => !INDEX.includes(c));
    expect(absents).toEqual([]);
  });

  it("chaque commande porte le namespace `<sujet>:<action>`", () => {
    // La convention du framework : `orm:migrate`, `security:user:add`. Une
    // commande sans namespace entre en collision avec celles du cœur, et rien
    // ne le signale avant le jour de la collision.
    const dir = path.join(APP, "nodefony", "command");
    if (!existsSync(dir)) return;
    const fautives: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = lire(path.join(dir, f));
      const m = src.match(/super\(\s*["']([^"']+)["']/);
      if (m !== null && !m[1].includes(":"))
        fautives.push(`${f} → « ${m[1]} »`);
    }
    expect(fautives).toEqual([]);
  });

  it("la config d'application est un DESCRIPTEUR, pas un objet figé", () => {
    // `defineConfig((ctx) => …)` : le par-environnement passe par `ctx`. Un
    // objet littéral fige la configuration au moment de l'import, avant que
    // l'environnement soit connu.
    const cfg = lire(path.join(APP, "nodefony.config.ts"));
    expect(cfg).toMatch(/defineConfig\s*(<[^>]*>)?\s*\(\s*\(/);
  });

  it("aucun fichier chargé à l'import ne déréférence le kernel", () => {
    // Règle absolue du framework : `Nodefony.getKernel()` au niveau supérieur
    // d'un fichier importé rend le module NON IMPORTABLE sans serveur — donc
    // non testable. Un getter ou un `?.` gardé sont les deux formes permises.
    const fautifs: string[] = [];
    for (const p of SOURCES) {
      const src = lire(p);
      for (const ligne of src.split("\n")) {
        const nu = ligne.trim();
        if (!nu.startsWith("const ") && !nu.startsWith("export const "))
          continue;
        if (/getKernel\(\)\s*[.[]/.test(nu) && !/getKernel\(\)\?\./.test(nu)) {
          fautifs.push(`${relatif(p)} → ${nu.slice(0, 80)}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });
});
