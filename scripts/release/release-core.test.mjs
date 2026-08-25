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
import { describe, expect, it } from "vitest";
import {
  analyserCommits,
  auditerMetadonnees,
  comparerVersions,
  detecterSuspects,
  fusionnerChangelog,
  ordreTopologique,
  paquetsNonEstampilles,
  referencesFigees,
  rendreChangelog,
  validerVersion,
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
    pkg: {
      repository: {
        type: "git",
        url: `git+https://${BON}.git`,
        directory: "src/a",
      },
      publishConfig: { access: "public" },
      files: ["dist"],
    },
  };
  const audit = (paquets, existe = () => true) =>
    auditerMetadonnees(paquets, { depotAttendu: BON, existe });

  it("laisse passer un paquet conforme", () => {
    expect(audit([ok]).bloquants).toEqual([]);
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
    expect(audit([sansDir], () => false).bloquants).toEqual([]);
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
