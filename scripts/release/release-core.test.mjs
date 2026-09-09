/**
 * Suite du cœur de release — écrite pour FAIRE ÉCHOUER le script, pas pour
 * l'accompagner.
 *
 * Une release ne se répète pas : la version est brûlée dès le premier
 * `publish`, et npm n'ouvre le retrait que 72 heures. Ces fonctions n'auront
 * donc jamais de seconde chance en production. Chaque cas ci-dessous vient soit
 * d'une clause de spécification (semver 2.0.0, Conventional Commits 1.0.0, Keep
 * a Changelog), soit d'un mode de défaillance qui a réellement coûté cher dans
 * l'écosystème npm — publication partielle, secret embarqué, tag `latest`
 * déplacé, métadonnée qui fait refuser la publication au pire moment.
 *
 * Les cas marqués « PIÈGE » sont ceux où une implémentation naïve passe : ce
 * sont eux qui font le travail.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUS_DE_LA_DEPRECIATION,
  PAQUETS_HISTORIQUES,
  depreciationsAFaire,
  latestsRestesEnArriere,
  lireVueNpm,
  paquetsNonServis,
  validerOtp,
  estRefusOtp,
  trierPourRecalage,
  messageDeDepreciation,
  refusDePublicationHorsBranche,
  MAX_BUFFER_GIT,
  analyserCommits,
  auditerMetadonnees,
  LONGUEUR_MIN_DESCRIPTION,
  FICHIERS_LICENCE,
  comparerVersions,
  detecterSuspects,
  phasesDeLaPasse,
  fusionnerChangelog,
  ordreTopologique,
  paquetsNonEstampilles,
  pairsTropLarges,
  alignerReferencesInternes,
  referencesFigees,
  rendreChangelog,
  validerVersion,
  versionDeLaPageMan,
} from "./release-core.mjs";

// ═══════════════════════════════════════════════════════════════════════════
describe("validerVersion — semver 2.0.0, clause par clause", () => {
  it.each([
    ["10.0.0", null, null],
    ["0.0.0", null, null],
    ["1.0.0-alpha", "alpha", null],
    ["1.0.0-alpha.1", "alpha.1", null],
    ["1.0.0-0.3.7", "0.3.7", null],
    ["1.0.0-x.7.z.92", "x.7.z.92", null],
    ["1.0.0-alpha-beta", "alpha-beta", null],
    // Clause 10 : les métadonnées de build sont VALIDES. Une regex sans le `+`
    // les refuse à tort — et refuser une version légitime bloque la release.
    ["1.0.0+20130313144700", null, "20130313144700"],
    ["1.0.0-beta+exp.sha.5114f85", "beta", "exp.sha.5114f85"],
    ["1.0.0+21AF26D3--117B344092BD", null, "21AF26D3--117B344092BD"],
  ])("accepte %s", (v, prerelease, build) => {
    expect(validerVersion(v)).toEqual({ ok: true, prerelease, build });
  });

  it.each([
    // Clause 2 : « MUST NOT contain leading zeroes ». PIÈGE : un `\d+` naïf
    // accepte, et l'on publie une version que npm classera autrement.
    ["01.2.3", "zéro en tête sur le majeur"],
    ["1.02.3", "zéro en tête sur le mineur"],
    ["1.2.03", "zéro en tête sur le patch"],
    // Clause 9 : « Numeric identifiers MUST NOT include leading zeroes ».
    ["1.0.0-01", "identifiant numérique de pré-release à zéro en tête"],
    ["1.0.0-alpha.01", "idem, en seconde position"],
    ["1.0", "trois composants exigés"],
    ["1", "trois composants exigés"],
    ["1.2.3.4", "quatre composants"],
    ["", "chaîne vide"],
    ["v1.0.0", "le « v » ne fait pas partie de la version — il est au TAG"],
    ["1.0.0-", "pré-release vide"],
    ["1.0.0+", "métadonnées vides"],
    ["1.0.0-alpha_beta", "underscore hors de [0-9A-Za-z-]"],
    ["1.0.0-alpha..1", "identifiant vide entre deux points"],
    ["10.0.0 ", "espace en fin — PIÈGE : un trim implicite le masquerait"],
    [" 10.0.0", "espace en tête"],
    ["latest", "un tag npm n'est pas une version"],
  ])("refuse %s (%s)", (v) => {
    expect(validerVersion(v).ok).toBe(false);
  });

  it("refuse ce qui n'est pas une chaîne, sans lever", () => {
    for (const v of [null, undefined, 10, {}, [], NaN]) {
      expect(validerVersion(v).ok).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("comparerVersions — les planchers npm et Node", () => {
  it("ordonne correctement", () => {
    expect(comparerVersions("11.5.1", "11.5.1")).toBe(0);
    expect(comparerVersions("11.5.0", "11.5.1")).toBeLessThan(0);
    expect(comparerVersions("11.6.0", "11.5.1")).toBeGreaterThan(0);
    // PIÈGE : une comparaison de chaînes rendrait "9" > "11".
    expect(comparerVersions("9.9.9", "11.0.0")).toBeLessThan(0);
    // PIÈGE : "10" vs "9" en lexicographique s'inverse aussi.
    expect(comparerVersions("10.0.0", "9.0.0")).toBeGreaterThan(0);
  });

  it("tolère les formes courtes et les suffixes", () => {
    expect(comparerVersions("22", "22.0.0")).toBe(0);
    expect(comparerVersions("22.14", "22.14.0")).toBe(0);
    // Node rend parfois `22.14.0-nightly…` — le plancher doit rester lisible.
    expect(comparerVersions("22.14.0-nightly", "22.14.0")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("ordreTopologique — la parade au lot partiel", () => {
  const p = (nom, deps = {}, peers = {}) => ({
    nom,
    pkg: { dependencies: deps, peerDependencies: peers },
  });

  it("publie une dépendance AVANT celui qui en dépend", () => {
    const { ordre, cycles } = ordreTopologique([
      p("@x/haut", { "@x/milieu": "*" }),
      p("@x/milieu", { "@x/bas": "*" }),
      p("@x/bas"),
    ]);
    expect(cycles).toEqual([]);
    expect(ordre.indexOf("@x/bas")).toBeLessThan(ordre.indexOf("@x/milieu"));
    expect(ordre.indexOf("@x/milieu")).toBeLessThan(ordre.indexOf("@x/haut"));
  });

  it("lit les peerDependencies — PIÈGE : c'est ainsi que ce dépôt les déclare", () => {
    // Une implémentation qui ne regarde que `dependencies` rend ici un ordre
    // arbitraire, sans rien signaler : le lot partiel devient possible alors
    // que le graphe était parfaitement connu.
    const { ordre } = ordreTopologique([
      p("@x/framework", {}, { "@x/http": "*" }),
      p("@x/http"),
    ]);
    expect(ordre).toEqual(["@x/http", "@x/framework"]);
  });

  it("rend TOUS les paquets, même sans aucune relation", () => {
    const { ordre } = ordreTopologique([p("a"), p("b"), p("c")]);
    expect(ordre.sort()).toEqual(["a", "b", "c"]);
  });

  it("signale un cycle au lieu de boucler ou de mentir", () => {
    const { ordre, cycles } = ordreTopologique([
      p("@x/a", { "@x/b": "*" }),
      p("@x/b", { "@x/a": "*" }),
    ]);
    expect(cycles.length).toBeGreaterThan(0);
    expect(ordre).toHaveLength(2); // aucun paquet perdu
  });

  it("ignore l'auto-référence et les dépendances EXTERNES", () => {
    const { ordre, cycles } = ordreTopologique([
      p("@x/a", { "@x/a": "*", vitest: "^4", react: "19" }),
    ]);
    expect(cycles).toEqual([]);
    expect(ordre).toEqual(["@x/a"]);
  });

  it("ne perd aucun paquet dans un graphe en diamant", () => {
    const { ordre } = ordreTopologique([
      p("d", { b: "*", c: "*" }),
      p("b", { a: "*" }),
      p("c", { a: "*" }),
      p("a"),
    ]);
    expect(new Set(ordre)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(ordre.indexOf("a")).toBe(0);
    expect(ordre.indexOf("d")).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("auditerMetadonnees — ce qui fait refuser la publication le jour J", () => {
  const BON = "github.com/org/depot";
  const ok = {
    nom: "@x/a",
    location: "src/a",
    pkg: {
      repository: {
        type: "git",
        url: `git+https://${BON}.git`,
        directory: "src/a",
      },
      publishConfig: { access: "public" },
      files: ["dist"],
      license: "CECILL-B",
      // Une description RÉELLE, pas un remplissage : le décor doit satisfaire
      // le gate pour la même raison qu'un vrai paquet — sinon « conforme » ne
      // veut plus rien dire.
      description:
        "Un paquet de démonstration qui décrit ce qu'il fait en une phrase",
      keywords: ["demo", "typescript"],
      homepage: "https://example.org/",
    },
  };
  const audit = (paquets, existe = () => true) =>
    auditerMetadonnees(paquets, { depotAttendu: BON, existe });

  // ── Ce que npm INDEXE, et qu'une version publiée fige ────────────────────
  it("REFUSE une description trop courte pour dire ce que le paquet fait", () => {
    const { bloquants } = audit([
      { ...ok, pkg: { ...ok.pkg, description: "nodefony http" } },
    ]);
    expect(bloquants).toHaveLength(1);
    expect(bloquants[0]).toContain("13 caractère(s)");
    expect(bloquants[0]).toContain("nodefony http");
  });

  it("REFUSE une description absente comme une description vide", () => {
    const sans = { ...ok, pkg: { ...ok.pkg } };
    delete sans.pkg.description;
    expect(audit([sans]).bloquants).toHaveLength(1);
    expect(
      audit([{ ...ok, pkg: { ...ok.pkg, description: "   " } }]).bloquants,
    ).toHaveLength(1);
  });

  it("compte la longueur APRÈS trim — des espaces ne font pas une phrase", () => {
    const bourre = " ".repeat(60) + "http";
    expect(bourre.length).toBeGreaterThan(LONGUEUR_MIN_DESCRIPTION);
    expect(
      audit([{ ...ok, pkg: { ...ok.pkg, description: bourre } }]).bloquants,
    ).toHaveLength(1);
  });

  it("AVERTIT sans bloquer sur `javascript` et sur des mots-clés vides", () => {
    const kwJs = audit([
      { ...ok, pkg: { ...ok.pkg, keywords: ["nodefony", "javascript"] } },
    ]);
    expect(kwJs.bloquants).toHaveLength(0);
    expect(kwJs.avertissements.join()).toContain("javascript");

    const kwVides = audit([{ ...ok, pkg: { ...ok.pkg, keywords: [] } }]);
    expect(kwVides.bloquants).toHaveLength(0);
    expect(kwVides.avertissements.join()).toContain("keywords");
  });

  it("AVERTIT sans bloquer sur une `homepage` absente", () => {
    const sans = { ...ok, pkg: { ...ok.pkg } };
    delete sans.pkg.homepage;
    const r = audit([sans]);
    expect(r.bloquants).toHaveLength(0);
    expect(r.avertissements.join()).toContain("homepage");
  });

  it("laisse passer un paquet conforme", () => {
    expect(audit([ok]).bloquants).toEqual([]);
  });

  // ── La licence doit VOYAGER : le champ ET le texte ──────────────────────
  // Le défaut réel qui a motivé cette garde : quinze paquets déclaraient
  // `license` (ou pas) sans qu'aucun tarball ne porte le texte, le seul fichier
  // du dépôt vivant à la racine du monorepo — hors de tout paquet.
  it("bloque un paquet sans champ `license`", () => {
    const { license: _license, ...sansLicence } = ok.pkg;
    const r = audit([{ ...ok, pkg: sansLicence }]);
    expect(r.bloquants.join()).toMatch(/champ `license` absent/);
  });

  it("bloque un paquet dont le dossier ne porte AUCUN texte de licence", () => {
    const r = audit([ok], () => false);
    expect(r.bloquants.join()).toMatch(/aucun texte de licence dans le paquet/);
  });

  it("accepte n'importe lequel des noms que npm inclut d'office", () => {
    for (const nom of FICHIERS_LICENCE) {
      // `src/a` doit exister aussi : c'est le `repository.directory` déclaré,
      // gardé par la même injection.
      const r = audit(
        [ok],
        (chemin) => chemin === "src/a" || chemin === `src/a/${nom}`,
      );
      expect(r.bloquants).toEqual([]);
    }
  });

  it("refuse un fichier de licence au nom que npm n'inclut PAS d'office", () => {
    // `COPYING` est un nom courant côté GNU — npm ne le connaît pas, et le
    // fichier ne partirait dans le tarball que s'il figurait dans `files`.
    const r = audit([ok], (chemin) => chemin === "src/a/COPYING");
    expect(r.bloquants.join()).toMatch(/aucun texte de licence/);
  });

  it("AVERTIT sans bloquer quand `location` n'est pas fournie — on ne conclut pas au vert sur ce qu'on ne peut pas voir", () => {
    const { location: _location, ...sansLocation } = ok;
    const r = audit([sansLocation]);
    expect(r.bloquants).toEqual([]);
    expect(r.avertissements.join()).toMatch(
      /`location` non fournie.*NON vérifiée/,
    );
  });

  it("bloque un repository absent, vide, ou objet vide", () => {
    for (const repository of [undefined, "", {}, null]) {
      const r = audit([{ ...ok, pkg: { ...ok.pkg, repository } }]);
      expect(r.bloquants.join()).toMatch(/repository. absent ou vide/);
    }
  });

  it("bloque le MAUVAIS dépôt — la cause première d'ENEEDAUTH", () => {
    const r = audit([
      {
        ...ok,
        pkg: {
          ...ok.pkg,
          repository: { url: "git+https://github.com/org/AUTRE.git" },
        },
      },
    ]);
    expect(r.bloquants.join()).toMatch(/attendu github\.com\/org\/depot/);
  });

  it("bloque le protocole git:// — mort depuis 2022", () => {
    const r = audit([
      { ...ok, pkg: { ...ok.pkg, repository: { url: `git://${BON}.git` } } },
    ]);
    expect(r.bloquants.join()).toMatch(/git:\/\/ mort/);
  });

  it("bloque un repository.directory qui n'existe pas", () => {
    // Le verdict d'existence est INJECTÉ : on éprouve l'absence sans la
    // fabriquer sur le disque.
    const r = audit([ok], (d) => d !== "src/a");
    expect(r.bloquants.join()).toMatch(/directory .* n'existe pas/);
  });

  it("n'exige un directory que s'il est DÉCLARÉ", () => {
    const sansDir = {
      ...ok,
      pkg: { ...ok.pkg, repository: { url: `git+https://${BON}.git` } },
    };
    // `existe` est l'injection COMMUNE à plusieurs gardes : un `() => false`
    // global fait aussi manquer le texte de licence, ce qui est correct et sans
    // rapport. L'assertion porte donc sur ce que ce cas éprouve, et sur lui
    // seul — sinon elle échouerait pour un motif qu'elle ne teste pas.
    expect(
      audit([sansDir], () => false).bloquants.filter((b) =>
        b.includes("directory"),
      ),
    ).toEqual([]);
  });

  it("bloque un paquet SCOPÉ sans publishConfig.access public", () => {
    for (const publishConfig of [undefined, {}, { access: "restricted" }]) {
      const r = audit([{ ...ok, pkg: { ...ok.pkg, publishConfig } }]);
      expect(r.bloquants.join()).toMatch(/publishConfig\.access/);
    }
  });

  it("n'exige pas access sur un paquet NON scopé — PIÈGE : `nodefony` n'a pas de scope", () => {
    const nu = {
      nom: "nodefony",
      pkg: { ...ok.pkg, publishConfig: undefined },
    };
    expect(audit([nu]).bloquants).toEqual([]);
  });

  it("bloque un `files` absent ou vide — sans allowlist, tout le dossier part", () => {
    for (const files of [undefined, [], null, "dist"]) {
      const r = audit([{ ...ok, pkg: { ...ok.pkg, files } }]);
      expect(r.bloquants.join()).toMatch(/files. absent/);
    }
  });

  it("AVERTIT sans bloquer sur un script de cycle de vie", () => {
    const r = audit([
      { ...ok, pkg: { ...ok.pkg, scripts: { prepack: "npm run build" } } },
    ]);
    expect(r.bloquants).toEqual([]);
    expect(r.avertissements.join()).toMatch(/prepack.*PENDANT le pack/);
  });

  it("accumule les défauts de PLUSIEURS paquets — un rapport partiel ferait relancer N fois", () => {
    const r = audit([
      { nom: "@x/a", pkg: {} },
      { nom: "@x/b", pkg: {} },
    ]);
    expect(r.bloquants.filter((b) => b.startsWith("@x/a"))).not.toHaveLength(0);
    expect(r.bloquants.filter((b) => b.startsWith("@x/b"))).not.toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("referencesFigees — le lockstep dépareillé", () => {
  it("ne signale rien quand la convention `*` est respectée", () => {
    expect(
      referencesFigees(
        [
          { nom: "a", pkg: { peerDependencies: { b: "*" } } },
          { nom: "b", pkg: {} },
        ],
        "10.0.0",
      ),
    ).toEqual([]);
  });

  it("signale une référence figée sur une AUTRE version", () => {
    const f = referencesFigees(
      [
        { nom: "a", pkg: { dependencies: { b: "9.1.0" } } },
        { nom: "b", pkg: {} },
      ],
      "10.0.0",
    );
    expect(f).toHaveLength(1);
  });

  it("ignore les dépendances EXTERNES, quelle que soit leur plage", () => {
    expect(
      referencesFigees(
        [{ nom: "a", pkg: { dependencies: { react: "^19.0.0" } } }],
        "10.0.0",
      ),
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("alignerReferencesInternes — le lockstep, APPLIQUÉ", () => {
  const noms = new Set(["nodefony", "@nodefony/http"]);

  it("réécrit une référence interne épinglée sur la version publiée", () => {
    const brut = JSON.stringify(
      { name: "create-nodefony", dependencies: { nodefony: "10.0.0" } },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, noms, "10.0.0-alpha.1");
    expect(JSON.parse(r.contenu).dependencies.nodefony).toBe("10.0.0-alpha.1");
    expect(r.alignees).toEqual(["nodefony@10.0.0 → 10.0.0-alpha.1"]);
    expect(r.introuvables).toEqual([]);
  });

  // L'étoile ÉTAIT la convention du dépôt, et ce test l'exigeait. Le registre a
  // tranché : `*` accepte tout, donc npm sert `latest` — la 7.0.2. Un pair
  // interne se borne désormais.
  it("borne l'étoile d'un pair interne sur ^version", () => {
    const brut = JSON.stringify(
      { name: "@nodefony/framework", peerDependencies: { nodefony: "*" } },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, noms, "10.0.0-alpha.1");
    expect(JSON.parse(r.contenu).peerDependencies.nodefony).toBe(
      "^10.0.0-alpha.1",
    );
    expect(r.alignees).toEqual(["nodefony@* → ^10.0.0-alpha.1"]);
  });

  it("ne touche AUCUNE dépendance externe, même portant la version publiée", () => {
    const brut = JSON.stringify(
      { name: "x", dependencies: { react: "10.0.0", zod: "^3.0.0" } },
      null,
      2,
    );
    expect(
      alignerReferencesInternes(brut, noms, "10.0.0-alpha.1").contenu,
    ).toBe(brut);
  });

  it("ne reformate pas le fichier — ce diff est ce que l'auteur relit", () => {
    const brut =
      '{\n  "name": "create-nodefony",\n  "zzz": 1,\n  "dependencies": { "nodefony": "10.0.0" }\n}\n';
    const { contenu } = alignerReferencesInternes(brut, noms, "10.0.0-alpha.1");
    expect(contenu).toBe(
      '{\n  "name": "create-nodefony",\n  "zzz": 1,\n  "dependencies": { "nodefony": "10.0.0-alpha.1" }\n}\n',
    );
  });

  it("aligne aussi une référence déclarée dans DEUX champs à la fois", () => {
    const brut = JSON.stringify(
      {
        dependencies: { "@nodefony/http": "9.0.0" },
        peerDependencies: { "@nodefony/http": "9.0.0" },
      },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, noms, "10.0.0-alpha.1");
    const pkg = JSON.parse(r.contenu);
    expect(pkg.dependencies["@nodefony/http"]).toBe("10.0.0-alpha.1");
    expect(pkg.peerDependencies["@nodefony/http"]).toBe("10.0.0-alpha.1");
  });

  it("SIGNALE la plage qu'il n'a pas su retrouver dans le TEXTE, au lieu de la taire", () => {
    // Le manifeste parsé et son texte peuvent diverger (échappement unicode).
    // Un remplacement muet publierait la référence d'origine — donc un paquet
    // qui pointe une version absente du registre.
    const brut = '{"dependencies":{"\\u006eodefony":"10.0.0"}}';
    const r = alignerReferencesInternes(brut, noms, "10.0.0-alpha.1");
    expect(r.contenu).toBe(brut);
    expect(r.alignees).toEqual([]);
    expect(r.introuvables).toEqual(["nodefony@10.0.0"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("analyserCommits — Conventional Commits 1.0.0 → Common Changelog", () => {
  it("range dans les QUATRE catégories fermées de la spec", () => {
    const { groupes, horsConvention, ecartes } = analyserCommits([
      "feat: une nouveauté",
      "fix: une correction",
      "perf: plus rapide",
      "revert: on retire",
    ]);
    expect(horsConvention).toBe(0);
    expect(ecartes).toBe(0);
    expect([...groupes.keys()].sort()).toEqual([
      "Added",
      "Changed",
      "Fixed",
      "Removed",
    ]);
  });

  it("🔴 ÉCARTE les types sans effet pour l'utilisateur, sans les confondre avec du hors-convention", () => {
    // « skip no-op changes » : docs/ci/chore/test/build/style ne produisent
    // AUCUNE entrée. Les compter comme « hors convention » enverrait l'auteur
    // chercher des messages mal écrits qui n'existent pas.
    const r = analyserCommits([
      "docs: une page",
      "ci: un job",
      "chore: du ménage",
      "test: un cas",
      "build: un bundler",
      "style: des espaces",
      "pas du tout conventionnel",
    ]);
    expect(r.ecartes).toBe(6);
    expect(r.horsConvention).toBe(1);
    expect(r.groupes.size).toBe(0);
  });

  it("porte la RÉFÉRENCE de commit — normative (« must reference relevant commits »)", () => {
    const { groupes } = analyserCommits([
      { sha: "abc1234", message: "fix(http): le pipeline" },
    ]);
    expect(groupes.get("Fixed")[0]).toEqual({
      portee: "http",
      texte: "le pipeline",
      sha: "abc1234",
      rupture: false,
    });
  });

  it("accepte encore un simple tableau de chaînes — référence alors VIDE, jamais inventée", () => {
    const { groupes } = analyserCommits(["fix: x"]);
    expect(groupes.get("Fixed")[0].sha).toBe("");
  });

  it("détecte une rupture signalée par `!` (règle 1)", () => {
    const { ruptures, groupes } = analyserCommits([
      "feat!: la signature change",
    ]);
    expect(ruptures).toEqual([
      { portee: "", texte: "la signature change", sha: "" },
    ]);
    // PIÈGE : la rupture doit AUSSI marquer son entrée de catégorie, sinon le
    // rendu ne saurait pas la préfixer ni la remonter.
    expect(groupes.get("Added")[0].rupture).toBe(true);
  });

  it("détecte `!` APRÈS une portée", () => {
    const { ruptures } = analyserCommits(["feat(api)!: x"]);
    expect(ruptures[0].portee).toBe("api");
  });

  it("🔴 détecte une rupture annoncée en PIED — le cas qu'un parseur de sujets rate", () => {
    const { ruptures } = analyserCommits([
      "feat: ajoute un réglage\n\nBREAKING CHANGE: l'ancien réglage disparaît",
    ]);
    expect(ruptures[0].texte).toBe("l'ancien réglage disparaît");
  });

  it("quand `!` ET pied coexistent, le PIED donne la description", () => {
    const { ruptures } = analyserCommits([
      "feat!: sujet court\n\nBREAKING CHANGE: la vraie description",
    ]);
    expect(ruptures[0].texte).toBe("la vraie description");
  });

  it("refuse un pied en MINUSCULES — la spec exige les majuscules", () => {
    const { ruptures } = analyserCommits(["feat: x\n\nbreaking change: y"]);
    expect(ruptures).toHaveLength(0);
  });

  it("survit à une portée vide `feat(): x` sans planter", () => {
    expect(() => analyserCommits(["feat(): x"])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("rendreChangelog — Common Changelog, clause par clause", () => {
  const base = { version: "10.0.0", date: "2026-08-25" };
  const rendu = (groupes) =>
    rendreChangelog({ ...base, ruptures: [], groupes: new Map(groupes) });

  it("🔴 titre NORMATIF `## VERSION - DATE` — ni crochets, ni tiret cadratin", () => {
    // « ## 1.0.1 - 2019-08-24 ». Keep a Changelog écrit `## [1.0.1] — …` ;
    // un lecteur automatique de Common Changelog ne reconnaîtrait pas cette forme.
    expect(rendu([]).split("\n")[0]).toBe("## 10.0.0 - 2026-08-25");
  });

  it("date en ISO 8601, telle qu'on la lui donne", () => {
    expect(rendu([])).toMatch(/^## 10\.0\.0 - \d{4}-\d{2}-\d{2}$/m);
  });

  it("se déclare BROUILLON, et rappelle que la FORMULATION reste à écrire", () => {
    const s = rendu([]);
    expect(s).toMatch(/BROUILLON/);
    expect(s).toMatch(/IMPÉRATIF/);
  });

  it("🔴 respecte l'ORDRE normatif Changed → Added → Removed → Fixed", () => {
    const s = rendu([
      ["Fixed", [{ portee: "", texte: "f", sha: "1" }]],
      ["Removed", [{ portee: "", texte: "r", sha: "2" }]],
      ["Added", [{ portee: "", texte: "a", sha: "3" }]],
      ["Changed", [{ portee: "", texte: "c", sha: "4" }]],
    ]);
    const rang = (t) => s.indexOf(`### ${t}`);
    expect(rang("Changed")).toBeLessThan(rang("Added"));
    expect(rang("Added")).toBeLessThan(rang("Removed"));
    expect(rang("Removed")).toBeLessThan(rang("Fixed"));
  });

  it("🔴 préfixe une rupture par `**Breaking:** `", () => {
    const s = rendu([
      [
        "Added",
        [{ portee: "", texte: "ça casse", sha: "abc1234", rupture: true }],
      ],
    ]);
    expect(s).toMatch(/^- \*\*Breaking:\*\* ça casse \(abc1234\)$/m);
  });

  it("🔴 pour un sous-système : `**<portée> (breaking):** `", () => {
    const s = rendu([
      [
        "Changed",
        [{ portee: "http", texte: "x", sha: "abc1234", rupture: true }],
      ],
    ]);
    expect(s).toMatch(/^- \*\*http \(breaking\):\*\* x \(abc1234\)$/m);
  });

  it("🔴 remonte les ruptures EN TÊTE de leur catégorie", () => {
    const s = rendu([
      [
        "Added",
        [
          { portee: "a", texte: "banale", sha: "1", rupture: false },
          { portee: "z", texte: "cassante", sha: "2", rupture: true },
        ],
      ],
    ]);
    // « should be listed before other changes (per category) » — et ce, MÊME
    // quand le tri par portée les placerait dans l'autre ordre (a < z).
    expect(s.indexOf("cassante")).toBeLessThan(s.indexOf("banale"));
  });

  it("écrit la référence entre parenthèses, en FIN de ligne", () => {
    const s = rendu([["Fixed", [{ portee: "", texte: "x", sha: "deadbee" }]]]);
    expect(s).toMatch(/^- x \(deadbee\)$/m);
  });

  it("PIÈGE : sans référence connue, n'écrit pas de parenthèses VIDES", () => {
    const s = rendu([["Fixed", [{ portee: "", texte: "x", sha: "" }]]]);
    expect(s).toMatch(/^- x$/m);
    expect(s).not.toMatch(/\(\)/);
  });

  it("PIÈGE : une entrée tient sur UNE ligne — jamais de retour dans le texte rendu", () => {
    const s = rendu([
      ["Added", [{ portee: "http", texte: "une nouveauté", sha: "abc1234" }]],
    ]);
    const puces = s.split("\n").filter((l) => l.startsWith("- "));
    expect(puces).toHaveLength(1);
    expect(puces[0]).toBe("- **http:** une nouveauté (abc1234)");
  });

  it("n'écrit AUCUNE catégorie vide", () => {
    const s = rendu([["Added", []]]);
    expect(s).not.toMatch(/### /);
  });

  it("n'écrit jamais de section « Unreleased » — rejetée par la spec", () => {
    expect(
      rendu([["Added", [{ portee: "", texte: "x", sha: "1" }]]]),
    ).not.toMatch(/Unreleased/i);
  });

  it("un titre de catégorie n'est suivi QUE d'une liste non numérotée", () => {
    const s = rendu([["Added", [{ portee: "", texte: "x", sha: "1" }]]]);
    const lignes = s.split("\n");
    const i = lignes.indexOf("### Added");
    expect(lignes[i + 1]).toBe("");
    expect(lignes[i + 2].startsWith("- ")).toBe(true);
  });

  it("ne mute pas les tableaux qu'on lui passe", () => {
    const entrees = [
      { portee: "z", texte: "z", sha: "1" },
      { portee: "a", texte: "a", sha: "2" },
    ];
    rendu([["Added", entrees]]);
    expect(entrees[0].portee).toBe("z"); // le tri est fait sur une copie
  });
});

describe("fusionnerChangelog — antéchronologique, et jamais destructeur", () => {
  it("crée le fichier avec son en-tête quand il n'existe pas", () => {
    const r = fusionnerChangelog("", "## [10.0.0] — d\n", "10.0.0");
    expect(r.contenu).toMatch(/^# Changelog/);
    expect(r.contenu).toMatch(/## \[10\.0\.0\]/);
  });

  it("place la nouvelle version AVANT les anciennes", () => {
    const ancien = "# Changelog\n\nblabla\n\n## [9.0.0] — x\n\n- vieux\n";
    const r = fusionnerChangelog(ancien, "## [10.0.0] — y\n", "10.0.0");
    expect(r.contenu.indexOf("## [10.0.0]")).toBeLessThan(
      r.contenu.indexOf("## [9.0.0]"),
    );
  });

  it("🔴 CONSERVE le contenu des versions précédentes", () => {
    const ancien =
      "# Changelog\n\n## [9.0.0] — x\n\n- une entrée réécrite à la main\n";
    const r = fusionnerChangelog(ancien, "## [10.0.0] — y\n", "10.0.0");
    expect(r.contenu).toMatch(/une entrée réécrite à la main/);
  });

  it("REFUSE d'écraser une section déjà présente", () => {
    const ancien = "# Changelog\n\n## [10.0.0] — x\n\n- relu à la main\n";
    const r = fusionnerChangelog(ancien, "## [10.0.0] — y\n", "10.0.0");
    expect(r.erreur).toMatch(/déjà une section/);
    expect(r.contenu).toBeUndefined();
  });

  it("PIÈGE — les points de la version ne sont pas des jokers de regex", () => {
    // Sans échappement, « 10.0.0 » filtrerait aussi « 10X0Y0 » : on refuserait
    // d'écrire une section au motif d'une autre qui n'existe pas.
    const ancien = "# Changelog\n\n## [10X0Y0] — x\n";
    const r = fusionnerChangelog(ancien, "## [10.0.0] — y\n", "10.0.0");
    expect(r.erreur).toBeUndefined();
  });

  it("ne confond pas une version PRÉFIXE — 1.0.0 ne vaut pas 11.0.0", () => {
    const ancien = "# Changelog\n\n## [11.0.0] — x\n";
    expect(fusionnerChangelog(ancien, "s", "1.0.0").erreur).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("detecterSuspects — un secret publié est public pour toujours", () => {
  it.each([
    "paquet/.env",
    "paquet/.env.production",
    "paquet/.npmrc",
    "paquet/.netrc",
    "paquet/id_rsa",
    "paquet/id_ed25519",
    "paquet/dist/serveur.pem",
    "paquet/cert.p12",
    "paquet/tls/prod.key",
    "paquet/secrets.json",
    "paquet/secret.yaml",
    "paquet/.git/config",
  ])("signale %s", (f) => {
    expect(detecterSuspects([f])).toEqual([f]);
  });

  it.each([
    "paquet/dist/index.js",
    "paquet/docs/environment.md",
    "paquet/dist/keys.js",
    "paquet/dist/keyboard.js",
    "paquet/docs/secrets-guide.md",
    "paquet/dist/env.js",
    "paquet/README.md",
    "paquet/dist/.gitkeep",
  ])("PIÈGE — ne signale PAS %s", (f) => {
    // Une alerte sur un fichier légitime apprend à ignorer les alertes ; c'est
    // ainsi qu'on finit par ne plus voir la vraie.
    expect(detecterSuspects([f])).toEqual([]);
  });

  it("rend TOUS les suspects d'une liste mêlée", () => {
    const r = detecterSuspects([
      "p/dist/a.js",
      "p/.env",
      "p/dist/b.js",
      "p/id_rsa",
    ]);
    expect(r).toEqual(["p/.env", "p/id_rsa"]);
  });

  it("rend une liste vide sur un tarball sain", () => {
    expect(detecterSuspects(["p/dist/index.js", "p/package.json"])).toEqual([]);
  });
});

describe("paquetsNonEstampilles — la garde du mode PUBLICATION", () => {
  const lot = (...versions) =>
    versions.map((v, i) => ({ nom: `p${i}`, pkg: { version: v } }));

  it("ne signale rien quand tout le lot porte la version du tag", () => {
    expect(paquetsNonEstampilles(lot("10.0.0", "10.0.0"), "10.0.0")).toEqual(
      [],
    );
  });

  it("nomme CHAQUE paquet en retard, avec la version qu'il porte", () => {
    expect(
      paquetsNonEstampilles(lot("10.0.0", "9.9.9", "10.0.1"), "10.0.0"),
    ).toEqual(["p1@9.9.9", "p2@10.0.1"]);
  });

  it("PIÈGE : une version ABSENTE est un écart, pas un passe-droit", () => {
    // Un `package.json` sans champ `version` publierait sous une version que
    // personne n'a choisie. Une comparaison naïve `!==` le voit ; un test de
    // vérité (`p.pkg.version && …`) le laisserait passer en silence.
    expect(paquetsNonEstampilles([{ nom: "p", pkg: {} }], "10.0.0")).toEqual([
      "p@(version absente)",
    ]);
  });

  it("PIÈGE : ne compare pas en semver — `10.0` n'est pas `10.0.0`", () => {
    // Le tag exige une chaîne EXACTE. Tolérer les équivalents sémantiques
    // publierait un lot dont les manifestes ne disent pas tous la même chose.
    expect(paquetsNonEstampilles(lot("10.0"), "10.0.0")).toEqual(["p0@10.0"]);
  });

  it("survit à un paquet dont le manifeste manque entièrement", () => {
    expect(paquetsNonEstampilles([{ nom: "p" }], "10.0.0")).toEqual([
      "p@(version absente)",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("MAX_BUFFER_GIT — le plafond confronté au journal RÉEL", () => {
  // ═════════════════════════════════════════════════════════════════════════
  // Ce n'est pas une constante à relire : c'est une limite qui a déjà mordu.
  // `execSync` plafonne à 1 Mio et sort en `ENOBUFS` ; le journal complet de ce
  // dépôt en pèse plus de trois, et la release le lit ENTIER faute de tag `v*`
  // antérieur. Le défaut a été trouvé à la répétition — il attendait la
  // publication réelle, après quarante minutes d'épreuve.

  const journalComplet = () => {
    const racine = execSync("git rev-list --max-parents=0 HEAD", {
      encoding: "utf8",
    }).trim();
    return execSync(`git log ${racine}..HEAD --no-merges --format=%h%B`, {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_GIT,
    }).length;
  };

  it("dépasse le défaut de Node, qui est la cause du défaut vécu", () => {
    expect(MAX_BUFFER_GIT).toBeGreaterThan(1024 * 1024);
  });

  it("laisse au journal du dépôt une marge d'au moins 4×", () => {
    // Le journal grandit à chaque commit. Exiger une MARGE, et non le simple
    // fait de tenir aujourd'hui, laisse le temps de relever le plafond avant
    // qu'une publication ne tombe dessus.
    expect(journalComplet() * 4).toBeLessThan(MAX_BUFFER_GIT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("phasesDeLaPasse — ce que la passe fait vraiment", () => {
  it("sans drapeau : répétition seule, aucune écriture", () => {
    expect(phasesDeLaPasse({})).toEqual({
      repetition: true,
      estampiller: false,
      changelog: false,
      empaqueter: false,
      publier: false,
    });
  });

  it("--write : estampille et écrit le changelog, ne publie pas", () => {
    const p = phasesDeLaPasse({ ecrire: true });
    expect(p.repetition).toBe(false);
    expect(p.estampiller).toBe(true);
    expect(p.changelog).toBe(true);
    expect(p.publier).toBe(false);
  });

  // PIÈGE — le défaut qui a rendu `--publish` INERTE : la passe sortait en
  // répétition dès que `--write` manquait, avec un code de sortie 0. Sur la
  // seule commande irréversible du dépôt, « rien n'a été publié » se lisait
  // exactement comme « tout est publié ».
  it("--publish SEUL publie — publier n'implique pas écrire", () => {
    const p = phasesDeLaPasse({ publier: true });
    expect(p.repetition).toBe(false);
    expect(p.publier).toBe(true);
    expect(p.empaqueter).toBe(true);
  });

  // Ce que la publication ne doit JAMAIS faire : ce qui part doit être
  // exactement ce qui a été commité et relu.
  it("--publish SEUL n'écrit RIEN — ni version, ni changelog", () => {
    const p = phasesDeLaPasse({ publier: true });
    expect(p.estampiller).toBe(false);
    expect(p.changelog).toBe(false);
  });

  // Le message de la répétition propose `--pack` seul : il doit empaqueter.
  it("--pack SEUL empaquette sans écrire ni publier", () => {
    const p = phasesDeLaPasse({ pack: true });
    expect(p.repetition).toBe(false);
    expect(p.empaqueter).toBe(true);
    expect(p.estampiller).toBe(false);
    expect(p.publier).toBe(false);
  });

  it("--write --publish : estampille ET publie", () => {
    const p = phasesDeLaPasse({ ecrire: true, publier: true });
    expect(p.estampiller).toBe(true);
    expect(p.publier).toBe(true);
    expect(p.empaqueter).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("pairs internes — la plage `*` installe le PASSÉ", () => {
  // PIÈGE — mesuré sur l'alpha.1 publiée : dans un dossier vide,
  // `npm i @nodefony/http@10.0.0-alpha.1` installait `nodefony@7.0.2` et
  // quatorze `*-bundle@7.0.2`, parce que `*` accepte tout et que npm prend
  // alors `latest`. Aucun test ne pouvait le voir : une app générée épingle le
  // cœur, ce qui contraint le pair, et l'épreuve d'installation vierge ne passe
  // que par là.
  it("aligne un pair interne en `*` sur ^version", () => {
    const brut = JSON.stringify(
      { name: "@nodefony/http", peerDependencies: { nodefony: "*" } },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, ["nodefony"], "10.0.0-alpha.2");
    expect(JSON.parse(r.contenu).peerDependencies.nodefony).toBe(
      "^10.0.0-alpha.2",
    );
    expect(r.alignees).toContain("nodefony@* → ^10.0.0-alpha.2");
  });

  // Une DÉPENDANCE réelle reste verrouillée par le lockstep : c'est ce qui a
  // évité l'`ETARGET` de la porte d'entrée.
  it("garde la version EXACTE pour une dependency interne", () => {
    const brut = JSON.stringify(
      { name: "create-nodefony", dependencies: { nodefony: "10.0.0" } },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, ["nodefony"], "10.0.0-alpha.2");
    expect(JSON.parse(r.contenu).dependencies.nodefony).toBe("10.0.0-alpha.2");
  });

  it("ne touche pas un pair EXTERNE en `*`", () => {
    const brut = JSON.stringify(
      { name: "@nodefony/http", peerDependencies: { zod: "*" } },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, ["nodefony"], "10.0.0-alpha.2");
    expect(JSON.parse(r.contenu).peerDependencies.zod).toBe("*");
    expect(r.alignees).toEqual([]);
  });

  it("est idempotent — un pair déjà en ^version ne bouge pas", () => {
    const brut = JSON.stringify(
      {
        name: "@nodefony/http",
        peerDependencies: { nodefony: "^10.0.0-alpha.2" },
      },
      null,
      2,
    );
    const r = alignerReferencesInternes(brut, ["nodefony"], "10.0.0-alpha.2");
    expect(r.alignees).toEqual([]);
    expect(r.contenu).toBe(brut);
  });
});

describe("pairsTropLarges — la garde qui REFUSE de republier le défaut", () => {
  it("nomme un pair interne resté en `*`", () => {
    const paquets = [
      { nom: "nodefony", pkg: {} },
      { nom: "@nodefony/http", pkg: { peerDependencies: { nodefony: "*" } } },
    ];
    expect(pairsTropLarges(paquets)).toEqual([
      "@nodefony/http → nodefony@* (peerDependencies)",
    ]);
  });

  it("laisse passer un pair EXTERNE en `*` — on ne possède pas sa cadence", () => {
    const paquets = [
      { nom: "@nodefony/http", pkg: { peerDependencies: { zod: "*" } } },
    ];
    expect(pairsTropLarges(paquets)).toEqual([]);
  });

  it("laisse passer un pair interne borné", () => {
    const paquets = [
      { nom: "nodefony", pkg: {} },
      {
        nom: "@nodefony/http",
        pkg: { peerDependencies: { nodefony: "^10.0.0-alpha.2" } },
      },
    ];
    expect(pairsTropLarges(paquets)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("versionDeLaPageMan — un artefact GÉNÉRÉ qui embarque la version", () => {
  // PIÈGE — vécu : `man/nodefony.1` est générée puis COMMITÉE, et l'estampillage
  // ne la régénérait pas. Elle annonçait « nodefony 10.0.0 » alors que le lot
  // partait en 10.0.0-alpha.1 — et elle est PARTIE ainsi dans le tarball. Le
  // gate de fraîcheur du cœur était rouge sur les trois plateformes, sans
  // rapport apparent avec la release.
  it("lit la version, échappements roff compris", () => {
    const page =
      '.TH NODEFONY 1 "" "nodefony 10.0.0\\-alpha.1" "Nodefony Manual"\n.SH NAME\n';
    expect(versionDeLaPageMan(page)).toBe("10.0.0-alpha.1");
  });

  it("lit une version stable", () => {
    expect(
      versionDeLaPageMan(
        '.TH NODEFONY 1 "" "nodefony 10.0.0" "Nodefony Manual"',
      ),
    ).toBe("10.0.0");
  });

  // Rendre `null` plutôt que de deviner : une page dont on ne sait pas lire la
  // version ne doit pas se faire passer pour une page à jour.
  it("rend null sur une page qu'on ne sait pas lire", () => {
    expect(versionDeLaPageMan(".SH NAME\nnodefony\n")).toBeNull();
    expect(versionDeLaPageMan("")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE DE DÉPÔT — les manifestes RÉELS, lus SUR LE DISQUE.
//
// Les blocs ci-dessus éprouvent le raisonnement ; celui-ci éprouve l'ÉTAT. Il y
// a vingt-six workspaces : un paquet neuf, ou un manifeste édité à la main,
// réintroduit `*` sans que personne le voie — et le défaut ne se manifeste
// qu'après publication, chez celui qui installe.
//
// 🔴 Les manifestes se lisent SUR LE DISQUE, jamais par `npm query .workspace`.
// Mesuré : `*` réintroduit dans `@nodefony/http/package.json`, prouvé par
// `git diff`, et `npm query` continuait de rendre `^10.0.0-alpha.1` — il rend
// l'arbre INSTALLÉ, pas les fichiers. Le gate passait au vert sur un dépôt
// saboté : il mesurait autre chose que ce qu'il annonçait.
describe("GATE dépôt — aucun pair interne non borné chez les publiables", () => {
  const RACINE = path.resolve(import.meta.dirname, "../..");
  const manifestes = JSON.parse(
    readFileSync(path.join(RACINE, "package.json"), "utf8"),
  )
    .workspaces.flatMap((motif) =>
      motif.endsWith("/*")
        ? readdirSync(path.join(RACINE, motif.slice(0, -2)), {
            withFileTypes: true,
          })
            .filter((e) => e.isDirectory())
            .map((e) => path.join(motif.slice(0, -2), e.name))
        : [motif],
    )
    .map((rel) => path.join(RACINE, rel, "package.json"))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, "utf8")));

  const publiables = manifestes
    .filter((m) => !m.private)
    .map((m) => ({ nom: m.name, pkg: m }));

  it("le dépôt a bien les 15 publiables attendus", () => {
    // Si ce compte change, c'est un paquet qui naît ou qui sort de la surface
    // publiée — une décision, pas un détail : le test doit le dire.
    expect(publiables.map((p) => p.nom).sort()).toHaveLength(15);
  });

  it("aucun pair interne en `*` — sinon npm sert `latest`, c'est-à-dire la 7.x", () => {
    expect(pairsTropLarges(publiables)).toEqual([]);
  });

  it("les pairs internes sont bornés sur la version du lot", () => {
    const version = publiables.find((p) => p.nom === "nodefony").pkg.version;
    const noms = new Set(publiables.map((p) => p.nom));
    const mauvais = [];
    for (const p of publiables) {
      for (const [dep, plage] of Object.entries(p.pkg.peerDependencies ?? {})) {
        if (noms.has(dep) && plage !== `^${version}`) {
          mauvais.push(`${p.nom} → ${dep}@${plage} (attendu ^${version})`);
        }
      }
    }
    expect(mauvais).toEqual([]);
  });

  it("la page de manuel PUBLIÉE annonce la version du cœur", () => {
    const coeur = publiables.find((p) => p.nom === "nodefony");
    const page = readFileSync(
      path.join(RACINE, "src/nodefony/man/nodefony.1"),
      "utf8",
    );
    expect(versionDeLaPageMan(page)).toBe(coeur.pkg.version);
  });
});

describe("dépréciation des paquets historiques", () => {
  const DEPOT = "https://github.com/nodefony/nodefony-core";
  const RACINE = path.resolve(import.meta.dirname, "../..");

  it("aucun paquet n'est à la fois déprécié et exclu — la table se contredirait", () => {
    const exclus = new Set(EXCLUS_DE_LA_DEPRECIATION.map((e) => e.nom));
    expect(PAQUETS_HISTORIQUES.filter((e) => exclus.has(e.nom))).toEqual([]);
  });

  it("PIÈGE — `nodefony` n'est JAMAIS dans la table : le déprécier déprécierait la 10", () => {
    expect(PAQUETS_HISTORIQUES.map((e) => e.nom)).not.toContain("nodefony");
    expect(PAQUETS_HISTORIQUES.map((e) => e.nom)).not.toContain(
      "nodefony-client",
    );
  });

  it("aucun doublon — npm deprecate écraserait le message précédent en silence", () => {
    const noms = PAQUETS_HISTORIQUES.map((e) => e.nom);
    expect(noms).toHaveLength(new Set(noms).size);
  });

  it("chaque message NOMME son successeur quand il y en a un", () => {
    for (const e of PAQUETS_HISTORIQUES.filter((x) => x.successeur)) {
      expect(messageDeDepreciation(e, DEPOT)).toContain(e.successeur);
    }
  });

  it("PIÈGE — un message ne promet JAMAIS `npm install` : le successeur peut n'exister qu'en préversion", () => {
    for (const e of PAQUETS_HISTORIQUES) {
      const m = messageDeDepreciation(e, DEPOT);
      expect(m).not.toMatch(/npm\s+(install|i)\b/);
      expect(m).toContain(DEPOT);
    }
  });

  it("une nature inconnue LÈVE plutôt que de rendre un message vague", () => {
    expect(() =>
      messageDeDepreciation({ nom: "x", nature: "inventée" }, DEPOT),
    ).toThrow(/nature inconnue/);
  });

  it("le plan de release et la table du code nomment les MÊMES paquets", () => {
    // Duplication rendue inévitable par la frontière doc/code : le plan doit
    // rester lisible seul (nature, motif), le script doit rester exécutable
    // seul. La règle du dépôt est alors de COMPARER les deux sorties — deux
    // copies divergent en silence, chacune passant ses propres relectures.
    const plan = readFileSync(
      path.join(RACINE, "docs/release/nodefony-10.md"),
      "utf8",
    );
    const section = plan.split("### 7.3ter")[1]?.split("\n### ")[0] ?? "";
    const dansLePlan = new Set(
      [...section.matchAll(/^\|\s*`([^`]+)`\s*\(/gm)].map((m) => m[1]),
    );
    const dansLeCode = new Set(PAQUETS_HISTORIQUES.map((e) => e.nom));
    expect([...dansLePlan].sort()).toEqual([...dansLeCode].sort());
  });
});

describe("branche de publication", () => {
  it("laisse passer un commit qui appartient à la branche", () => {
    expect(
      refusDePublicationHorsBranche({
        branche: "main",
        brancheTrouvee: true,
        contenue: true,
      }),
    ).toBeNull();
  });

  it("REFUSE un tag posé hors de la branche de publication", () => {
    const refus = refusDePublicationHorsBranche({
      branche: "main",
      brancheTrouvee: true,
      contenue: false,
    });
    expect(refus).toMatch(/n'appartient PAS à « main »/);
    // Le message doit NOMMER le geste : un refus qui laisse chercher se
    // contourne, et c'est exactement ainsi que la garde de préparation avait
    // été désarmée d'un `--branch dev`.
    expect(refus).toMatch(/Fusionner dans main/);
  });

  it("PIÈGE — une branche INTROUVABLE refuse, elle ne se désarme pas", () => {
    // Le cas de la forge : `actions/checkout` superficiel ne rapporte que le
    // tag. Rendre `null` ici laisserait publier n'importe quoi dès que la
    // référence manque — c'est-à-dire précisément là où l'on ne sait rien.
    const refus = refusDePublicationHorsBranche({
      branche: "main",
      brancheTrouvee: false,
      contenue: false,
    });
    expect(refus).toMatch(/introuvable/);
    expect(refus).toMatch(/fetch-depth: 0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Le dist-tag `latest` — la règle asymétrique, et ce qu'elle protège
// ═══════════════════════════════════════════════════════════════════════════
//
// npm pose `latest` à la PREMIÈRE publication d'un paquet, quel que soit
// `--tag`, et ne le déplace plus. Un paquet né en préversion sert donc sa toute
// première alpha à qui écrit `npm i <paquet>` sans nommer de canal. Constaté
// sur les quatorze paquets de la `10.0.0-alpha.2`.
//
// L'erreur SYMÉTRIQUE coûte infiniment plus cher : recaler un `latest` STABLE
// servirait une préversion à tout `npm i` de la terre, et aucune fenêtre de
// retrait ne rattrape des installations déjà parties.
const estPreversion = (v) => v.includes("-");

describe("latestsRestesEnArriere", () => {
  it("recale un latest resté sur une préversion périmée", () => {
    expect(
      latestsRestesEnArriere(
        [
          {
            nom: "@nodefony/http",
            latest: "10.0.0-alpha.1",
            publiee: "10.0.0-alpha.2",
          },
        ],
        estPreversion,
      ),
    ).toEqual([
      { nom: "@nodefony/http", de: "10.0.0-alpha.1", vers: "10.0.0-alpha.2" },
    ]);
  });

  it("🔴 PIÈGE — un latest STABLE est INTOUCHABLE, même en retard", () => {
    // Le cas réel : `nodefony` porte `latest = 7.0.2` pendant que la 10 sort en
    // alpha. Une implémentation naïve — « latest ≠ version publiée, donc à
    // recaler » — servirait la préversion à tous les installeurs de la 7.
    expect(
      latestsRestesEnArriere(
        [{ nom: "nodefony", latest: "7.0.2", publiee: "10.0.0-alpha.2" }],
        estPreversion,
      ),
    ).toEqual([]);
  });

  it("ne propose rien quand latest est déjà à jour, ou inconnu", () => {
    expect(
      latestsRestesEnArriere(
        [
          { nom: "a", latest: "10.0.0-alpha.2", publiee: "10.0.0-alpha.2" },
          { nom: "b", latest: null, publiee: "10.0.0-alpha.2" },
        ],
        estPreversion,
      ),
    ).toEqual([]);
  });
});

describe("trierPourRecalage", () => {
  it("écarte le paquet dont la version visée est ABSENTE du registre", () => {
    // Le dépôt est estampillé en alpha.3 par `--write`, mais rien n'est publié :
    // `npm dist-tag add …@10.0.0-alpha.3 latest` échouerait sur un message de npm
    // qui ne nomme pas la cause. On le dit AVANT de toucher au registre.
    const { aRecaler, absentes } = trierPourRecalage(
      [
        {
          nom: "@nodefony/http",
          latest: "10.0.0-alpha.1",
          publiee: "10.0.0-alpha.3",
          versions: ["10.0.0-alpha.1", "10.0.0-alpha.2"],
        },
      ],
      estPreversion,
    );
    expect(aRecaler).toEqual([]);
    expect(absentes).toEqual([
      { nom: "@nodefony/http", vers: "10.0.0-alpha.3" },
    ]);
  });

  it("🔴 PIÈGE — la garde d'absence ne DÉSARME pas la règle du latest stable", () => {
    // Les deux règles se composent : une version bien présente au registre ne
    // rend pas pour autant un `latest` stable recalable.
    const { aRecaler, absentes } = trierPourRecalage(
      [
        {
          nom: "nodefony",
          latest: "7.0.2",
          publiee: "10.0.0-alpha.2",
          versions: ["7.0.2", "10.0.0-alpha.2"],
        },
      ],
      estPreversion,
    );
    expect(aRecaler).toEqual([]);
    expect(absentes).toEqual([]);
  });

  it("sans liste de versions, ne bloque rien — la garde ne s'invente pas un refus", () => {
    const { aRecaler, absentes } = trierPourRecalage(
      [
        {
          nom: "@nodefony/http",
          latest: "10.0.0-alpha.1",
          publiee: "10.0.0-alpha.2",
        },
      ],
      estPreversion,
    );
    expect(aRecaler).toHaveLength(1);
    expect(absentes).toEqual([]);
  });
});

describe("estRefusOtp — reconnaître un code expiré au milieu d'un lot", () => {
  it("🔴 les trois formes que npm emploie sont reconnues", () => {
    expect(estRefusOtp("npm error code EOTP")).toBe(true);
    expect(estRefusOtp("This operation requires a one-time password")).toBe(
      true,
    );
    expect(estRefusOtp("npm ERR! Invalid one-time password")).toBe(true);
  });

  it("🔴 un refus SANS rapport ne doit pas déclencher de nouvelle saisie", () => {
    // Redemander un code sur un 403 ou un 404 ferait taper l'opérateur pour
    // rien, puis échouerait pareil — en lui laissant croire au second facteur.
    expect(
      estRefusOtp("npm error 403 Forbidden - you do not have permission"),
    ).toBe(false);
    expect(estRefusOtp("npm error code E404 Not found")).toBe(false);
    expect(estRefusOtp("")).toBe(false);
    expect(estRefusOtp(null)).toBe(false);
  });
});

describe("validerOtp — six chiffres, ou l'on nomme la confusion", () => {
  it("un code d'application passe, blancs de bord compris", () => {
    expect(validerOtp("123456")).toEqual({ ok: true, code: "123456" });
    expect(validerOtp("  654321 ")).toEqual({ ok: true, code: "654321" });
  });

  it("🔴 le NOM d'une clé de sécurité est refusé, et la raison le NOMME", () => {
    // Le piège vécu : une clé ne produit AUCUN code — npm valide par le
    // navigateur —, mais on lui donne souvent un nom, parfois numérique. Envoyé
    // en `--otp`, il fait échouer npm sur un message qui ne parle ni de clé ni
    // d'application.
    const r = validerOtp("MacBook-2024");
    expect(r.ok).toBe(false);
    expect(r.raison).toMatch(/clé de sécurité/u);
  });

  it("un nombre de chiffres INATTENDU passe, mais prévient", () => {
    const r = validerOtp("12345678");
    expect(r.ok).toBe(true);
    expect(r.alerte).toMatch(/npm en attend 6/u);
  });

  it("une saisie vide est refusée — l'appelant en fait un choix explicite", () => {
    expect(validerOtp("").ok).toBe(false);
    expect(validerOtp("   ").ok).toBe(false);
    expect(validerOtp(null).ok).toBe(false);
  });
});

describe("paquetsNonServis — ce que le registre ne sert pas ENCORE", () => {
  it("un paquet dont la version est là n'est pas attendu", () => {
    expect(
      paquetsNonServis("10.0.0-alpha.4", {
        nodefony: { versions: ["10.0.0-alpha.3", "10.0.0-alpha.4"] },
      }),
    ).toEqual([]);
  });

  it("🔴 un paquet ENCORE INTROUVABLE est attendu — c'est le cas vécu", () => {
    // `npm view` ne rend rien tant que le registre n'a pas propagé : le lecteur
    // rend `null`, et ce null ne doit surtout pas passer pour « servi ».
    expect(
      paquetsNonServis("10.0.0-alpha.4", {
        nodefony: null,
        "@nodefony/http": { versions: ["10.0.0-alpha.4"] },
      }),
    ).toEqual(["nodefony"]);
  });

  it("🔴 un paquet CONNU mais sans la version visée est attendu", () => {
    // La propagation est indépendante par paquet : le document existe déjà,
    // la version n'y est pas encore.
    expect(
      paquetsNonServis("10.0.0-alpha.4", {
        "@nodefony/drizzle": { versions: ["10.0.0-alpha.3"] },
      }),
    ).toEqual(["@nodefony/drizzle"]);
  });

  it("l'ordre reçu est conservé, et un lot vide n'attend rien", () => {
    expect(
      paquetsNonServis("1.0.0", {
        a: null,
        b: { versions: ["1.0.0"] },
        c: null,
      }),
    ).toEqual(["a", "c"]);
    expect(paquetsNonServis("1.0.0", {})).toEqual([]);
    expect(paquetsNonServis("1.0.0", null)).toEqual([]);
  });
});

describe("lireVueNpm", () => {
  it("🔴 PIÈGE — npm ENVELOPPE sa réponse dans un tableau", () => {
    // Le faux vert vécu : lire `doc["dist-tags"]` sur cette forme rend
    // `undefined`, et le mode a annoncé « rien à recaler » sur quatorze paquets
    // qui l'étaient tous. C'est la forme RÉELLE d'un `npm view @nodefony/http
    // dist-tags versions --json`, recopiée telle quelle.
    expect(
      lireVueNpm(
        JSON.stringify([
          {
            "dist-tags": { alpha: "10.0.0-alpha.2", latest: "10.0.0-alpha.1" },
            versions: ["10.0.0-alpha.1", "10.0.0-alpha.2"],
          },
        ]),
      ),
    ).toEqual({
      latest: "10.0.0-alpha.1",
      versions: ["10.0.0-alpha.1", "10.0.0-alpha.2"],
    });
  });

  it("lit aussi la forme NUE, quand npm n'enveloppe pas", () => {
    expect(
      lireVueNpm(
        JSON.stringify({
          "dist-tags": { latest: "7.0.2" },
          versions: ["7.0.2"],
        }),
      ),
    ).toEqual({ latest: "7.0.2", versions: ["7.0.2"] });
  });

  it("une version UNIQUE arrive en chaîne, pas en tableau", () => {
    expect(
      lireVueNpm(
        JSON.stringify({ "dist-tags": { latest: "1.0.0" }, versions: "1.0.0" }),
      ).versions,
    ).toEqual(["1.0.0"]);
  });

  it("une sortie illisible ou vide rend null — jamais un état inventé", () => {
    // Rendre un objet aux champs nuls ferait passer le paquet pour « à jour ».
    // `null` force l'appelant à le NOMMER comme illisible.
    expect(lireVueNpm("")).toBeNull();
    expect(lireVueNpm("pas du json")).toBeNull();
    expect(lireVueNpm("[]")).toBeNull();
  });
});

describe("depreciationsAFaire", () => {
  const attendu = "Nodefony 10 : ce paquet devient @nodefony/http";

  it("écarte ce qui porte DÉJÀ le bon message — c'est ce qui rend le mode rejouable", () => {
    // Sans ce filtre, la répétition rejoue sa liste à l'aveugle et ne peut
    // jamais dire « plus rien à faire » : l'opérateur qui la relance six mois
    // plus tard ne sait pas s'il regarde du travail ou un souvenir.
    expect(
      depreciationsAFaire([
        { nom: "@nodefony/http-bundle", message: attendu, attendu },
      ]),
    ).toEqual([]);
  });

  it("nomme le paquet jamais déprécié", () => {
    expect(
      depreciationsAFaire([
        { nom: "@nodefony/http-bundle", message: null, attendu },
      ]),
    ).toEqual([{ nom: "@nodefony/http-bundle", motif: "jamais dépréciée" }]);
  });

  it("🔴 PIÈGE — un message PÉRIMÉ n'est pas une dépréciation en place", () => {
    // Le cas qu'une simple présence/absence rate : le paquet EST déprécié, mais
    // vers un successeur qui a été renommé depuis. L'utilisateur est envoyé
    // vers un paquet qui n'existe pas, et rien ne le signale.
    expect(
      depreciationsAFaire([
        {
          nom: "@nodefony/http-bundle",
          message: "Nodefony 9 : voir @nodefony/http-old",
          attendu,
        },
      ]),
    ).toEqual([{ nom: "@nodefony/http-bundle", motif: "message PÉRIMÉ" }]);
  });
});
