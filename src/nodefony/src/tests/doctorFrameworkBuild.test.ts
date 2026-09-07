/**
 * Unit — `doctor` voit si LE FRAMEWORK est construit, pas seulement l'application.
 *
 * Le contrôle de fraîcheur ne regardait que le `dist/` de l'application. Or dans
 * les deux seuls régimes où la question se pose — le dépôt self-hosted, et une
 * application liée à un checkout local — ce sont les paquets `@nodefony/*` qui
 * peuvent être périmés, et leur symptôme est le plus coûteux du framework : une
 * route qui répond 404, un export « introuvable » au démarrage, sans que rien
 * ne désigne la cause.
 *
 * Une application installée depuis npm, elle, reçoit des paquets déjà bâtis :
 * il n'y a rien à contrôler, et crier dessus serait le meilleur moyen d'obtenir
 * qu'on ignore ce diagnostic. C'est pourquoi le contrôle ne regarde QUE les
 * paquets liés — la distinction est le cœur de ce qui est éprouvé ici.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import path from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  checkFreshness,
  checkFrameworkBuild,
  checkFrontendBuild,
} from "../kernel/checks/freshness";

/** Écrit un fichier en créant son dossier — les décors sont profonds. */
function poser(fichier: string, contenu = "x"): void {
  mkdirSync(path.dirname(fichier), { recursive: true });
  writeFileSync(fichier, contenu, "utf8");
}

/**
 * Monte un paquet de framework hors du projet, puis le LIE dans ses
 * `node_modules` — c'est la forme qu'un `npm link` ou un `file:` produit, et la
 * seule que ce contrôle doit regarder.
 */
function paquetLie(
  racine: string,
  nom: string,
  opts: { dist?: boolean; sourcePlusRecente?: boolean },
): void {
  const dehors = path.join(racine, "checkout", nom.replace("/", "-"));
  poser(path.join(dehors, "package.json"), JSON.stringify({ name: nom }));
  poser(path.join(dehors, "nodefony", "src", "a.ts"), "export const a = 1;");
  if (opts.dist) {
    poser(path.join(dehors, "dist", "index.js"), "export const a = 1;");
    if (opts.sourcePlusRecente) {
      // La source est retouchée APRÈS le build : c'est le seul sens qui prouve
      // quelque chose (un cache de build peut rendre un `dist/` daté du futur,
      // l'inverse reste toujours vrai).
      const plusTard = Date.now() + 60_000;
      poser(
        path.join(dehors, "nodefony", "src", "a.ts"),
        "export const a = 2;",
      );
      utimesSync(
        path.join(dehors, "nodefony", "src", "a.ts"),
        new Date(plusTard),
        new Date(plusTard),
      );
    }
  }
  const cible = path.join(racine, "node_modules", nom);
  mkdirSync(path.dirname(cible), { recursive: true });
  symlinkSync(dehors, cible, "dir");
}

/** Un paquet INSTALLÉ (copie réelle dans node_modules), tel que npm le pose. */
function paquetInstalle(racine: string, nom: string): void {
  const dans = path.join(racine, "node_modules", nom);
  poser(path.join(dans, "package.json"), JSON.stringify({ name: nom }));
  poser(path.join(dans, "nodefony", "src", "a.ts"), "export const a = 1;");
  // Volontairement SANS `dist/` : un paquet publié qui n'en aurait pas serait
  // un défaut de publication, pas un défaut de build local — ce contrôle-ci
  // n'a rien à en dire, et c'est ce que le cas vérifie.
}

function decor(): string {
  const racine = mkdtempSync(path.join(tmpdir(), "nf-framework-build-"));
  poser(path.join(racine, "package.json"), JSON.stringify({ name: "app" }));
  return racine;
}

describe("doctor — la fraîcheur du FRAMEWORK, pas seulement de l'application", () => {
  it("un paquet LIÉ sans `dist/` est un manquement, avec le geste", () => {
    const racine = decor();
    paquetLie(racine, "@nodefony/http", { dist: false });
    const findings = checkFrameworkBuild(racine);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, "framework-missing");
    assert.match(findings[0]!.message, /@nodefony\/http/u);
    // Le geste doit être celui du DÉPÔT du framework, pas `npm run build` de
    // l'application : bâtir l'app ne construit pas ses dépendances liées.
    assert.match(findings[0]!.message, /npm run build/u);
  });

  it("un paquet LIÉ dont les sources sont plus récentes que son build est signalé", () => {
    const racine = decor();
    paquetLie(racine, "@nodefony/framework", {
      dist: true,
      sourcePlusRecente: true,
    });
    const findings = checkFrameworkBuild(racine);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, "framework-stale");
    assert.match(findings[0]!.message, /@nodefony\/framework/u);
  });

  it("un paquet LIÉ à jour ne dit RIEN — le silence est le cas normal", () => {
    const racine = decor();
    paquetLie(racine, "@nodefony/http", { dist: true });
    assert.deepEqual(checkFrameworkBuild(racine), []);
  });

  it("🔴 un paquet INSTALLÉ n'est jamais accusé, même sans `dist/`", () => {
    // LE cas qui décide de l'utilité du contrôle. Une application installée
    // depuis npm reçoit des paquets bâtis ; si ce contrôle regardait aussi les
    // copies réelles, il crierait sur toute application du monde, et on
    // apprendrait à l'ignorer — le sort de tout gate qui rougit sur le cas sain.
    const racine = decor();
    paquetInstalle(racine, "@nodefony/http");
    assert.deepEqual(checkFrameworkBuild(racine), []);
  });

  it("aucun `node_modules` : rien à dire, et surtout pas une accusation", () => {
    assert.deepEqual(checkFrameworkBuild(decor()), []);
  });
});

/*
 *   Unit — le frontend DÉCLARÉ est-il construit ?
 *
 *   Le contrôle de fraîcheur ne regardait que le `dist/` du backend. Une
 *   application dont le build frontend avait échoué — `public/dist` absent,
 *   donc aucune page servie — s'entendait répondre « sources et build
 *   alignés », et `doctor` sortait en 0. Ce banc éprouve les trois verdicts qui
 *   comptent : la sortie manquante, la sortie périmée, et le silence quand
 *   tout va bien — sans lequel on ne saurait pas si le contrôle accuse tout ce
 *   qu'il touche.
 */
describe("doctor — le frontend déclaré est-il construit ?", () => {
  /** Une application qui DÉCLARE une entrée front, avec sa source. */
  function appFront(options: { outDir?: string; built?: number } = {}): string {
    const racine = mkdtempSync(path.join(tmpdir(), "nf-front-"));
    poser(
      path.join(racine, "nodefony", "frontend", "registerAppFrontEntry.ts"),
      `/**
        * Le TSDoc CITE root et outDir avant de les employer :
        *  - \`root\`   : racine Vite ;
        *  - \`outDir\` : sortie du build.
        */
       svc.registerEntry(module, {
         type: "svelte5",
         root: "./frontend",
         outDir: "${options.outDir ?? "./public/dist"}",
       });`,
    );
    poser(path.join(racine, "frontend", "src", "App.svelte"), "<main></main>");
    if (options.built !== undefined) {
      const sortie = path.join(racine, options.outDir ?? "./public/dist");
      poser(path.join(sortie, "index.js"), "console.log(1);");
      const when = options.built / 1000;
      utimesSync(path.join(sortie, "index.js"), when, when);
    }
    return racine;
  }

  it("🔴 le frontend n'est PAS construit → signalé, avec le geste", () => {
    const findings = checkFrontendBuild(appFront());
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.kind, "frontend-missing");
    assert.match(findings[0]?.message ?? "", /npm run build/u);
    assert.match(findings[0]?.message ?? "", /public\/dist/u);
  });

  it("🔴 le frontend est construit AVANT ses sources → signalé", () => {
    // Le build daté d'il y a une heure, les sources posées à l'instant.
    const racine = appFront({ built: Date.now() - 3_600_000 });
    const findings = checkFrontendBuild(racine);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0]?.kind, "frontend-stale");
  });

  it("le frontend construit APRÈS ses sources ne dit RIEN", () => {
    const racine = appFront({ built: Date.now() + 60_000 });
    assert.deepEqual(checkFrontendBuild(racine), []);
  });

  it("une sortie DÉCLARÉE ailleurs est celle qu'on regarde, pas `public/dist`", () => {
    // `outDir` se réécrit par entrée : un contrôle qui chercherait le chemin
    // conventionnel en dur se tairait sur cette application en ayant l'air de
    // l'avoir vérifiée.
    const racine = appFront({
      outDir: "./static/build",
      built: Date.now() + 60_000,
    });
    assert.deepEqual(checkFrontendBuild(racine), []);
  });

  /*
   *   Le contrôle doit être BRANCHÉ, pas seulement juste. Un banc qui n'appelle
   *   que la fonction prouve l'intention de son auteur et rien d'autre : c'est
   *   `checkFreshness` qui alimente le rapport, et son verdict « sources et
   *   build alignés » est précisément ce qui rassurait à tort.
   */
  it("🔴 le constat REMONTE dans le rapport de fraîcheur", () => {
    const racine = appFront();
    // Un backend construit et à jour : sans le frontend, ce rapport serait vert.
    poser(path.join(racine, "dist", "index.js"), "export const x = 1;");
    const demain = Date.now() / 1000 + 3600;
    utimesSync(path.join(racine, "dist", "index.js"), demain, demain);

    const r = checkFreshness(racine);
    assert.equal(
      r.findings.filter((f) => f.kind.startsWith("dist-")).length,
      0,
      "le backend doit être vu à jour, sinon le test ne prouve rien",
    );
    assert.equal(
      r.findings.filter((f) => f.kind === "frontend-missing").length,
      1,
      JSON.stringify(r.findings),
    );
  });

  it("une application SANS frontend déclaré ne produit aucun constat", () => {
    const racine = mkdtempSync(path.join(tmpdir(), "nf-front-"));
    poser(path.join(racine, "index.ts"), "export const x = 1;");
    assert.deepEqual(checkFrontendBuild(racine), []);
  });
});
