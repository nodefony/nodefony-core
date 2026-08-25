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
describe("analyserCommits — Conventional Commits 1.0.0", () => {
  it("range par section selon le type", () => {
    const { groupes, horsConvention } = analyserCommits([
      "feat: une nouveauté",
      "fix: une correction",
      "docs: une page",
    ]);
    expect(horsConvention).toBe(0);
    expect(groupes.get("Ajouté")).toHaveLength(1);
    expect(groupes.get("Corrigé")).toHaveLength(1);
    expect(groupes.get("Documentation")).toHaveLength(1);
  });

  it("extrait la portée", () => {
    const { groupes } = analyserCommits(["fix(http): le pipeline"]);
    expect(groupes.get("Corrigé")[0]).toEqual({
      portee: "http",
      texte: "le pipeline",
    });
  });

  it("détecte une rupture signalée par `!` (règle 1)", () => {
    const { ruptures } = analyserCommits(["feat!: la signature change"]);
    expect(ruptures).toEqual([{ portee: "", texte: "la signature change" }]);
  });

  it("détecte `!` APRÈS une portée", () => {
    const { ruptures } = analyserCommits(["feat(api)!: la route disparaît"]);
    expect(ruptures).toEqual([{ portee: "api", texte: "la route disparaît" }]);
  });

  it("🔴 détecte une rupture annoncée en PIED — le cas qu'un parseur de sujets rate", () => {
    // C'est LE défaut qui rend une release majeure muette sur ce qui casse :
    // le sujet est un `feat:` ordinaire, la rupture est dans le corps.
    const { ruptures } = analyserCommits([
      "feat(security): nouvelle politique\n\nDu contexte.\n\nBREAKING CHANGE: `allowAnonymous` est retiré.",
    ]);
    expect(ruptures).toEqual([
      { portee: "security", texte: "`allowAnonymous` est retiré." },
    ]);
  });

  it("admet la graphie BREAKING-CHANGE (synonyme de la spec)", () => {
    const { ruptures } = analyserCommits(["fix: x\n\nBREAKING-CHANGE: y"]);
    expect(ruptures).toHaveLength(1);
  });

  it("PIÈGE — `breaking change:` en minuscules N'EST PAS une rupture", () => {
    // La spec exige « the uppercase text BREAKING CHANGE ». L'accepter en
    // minuscules inventerait une norme et signalerait des ruptures là où
    // l'auteur n'en annonçait aucune.
    const { ruptures } = analyserCommits([
      "fix: x\n\nil n'y a aucun breaking change: tout est compatible",
    ]);
    expect(ruptures).toEqual([]);
  });

  it("quand `!` ET pied coexistent, le PIED donne la description", () => {
    const { ruptures } = analyserCommits([
      "feat(a)!: sujet court\n\nBREAKING CHANGE: la vraie explication",
    ]);
    expect(ruptures).toEqual([{ portee: "a", texte: "la vraie explication" }]);
  });

  it("ne compte qu'UNE rupture par commit, même avec les deux formes", () => {
    const { ruptures } = analyserCommits(["feat!: x\n\nBREAKING CHANGE: y"]);
    expect(ruptures).toHaveLength(1);
  });

  it("écarte ce qui n'est pas conventionnel, et le COMPTE", () => {
    const { horsConvention, groupes } = analyserCommits([
      "un message libre",
      "WIP",
      "Merge branch 'x'",
      "feat: gardé",
    ]);
    expect(horsConvention).toBe(3);
    expect(groupes.get("Ajouté")).toHaveLength(1);
  });

  it("écarte un type INCONNU plutôt que d'inventer une section", () => {
    const { horsConvention, groupes } = analyserCommits([
      "wip(x): quelque chose",
    ]);
    expect(horsConvention).toBe(1);
    expect(groupes.size).toBe(0);
  });

  it("PIÈGE — exige l'espace après le deux-points (règle 5)", () => {
    expect(analyserCommits(["feat:sans espace"]).horsConvention).toBe(1);
  });

  it("ignore les messages vides sans les compter comme hors convention", () => {
    const { horsConvention } = analyserCommits(["", "   ", "\n"]);
    expect(horsConvention).toBe(0);
  });

  it("ne confond pas un `!` du TEXTE avec une rupture", () => {
    const { ruptures } = analyserCommits(["feat: enfin corrigé !"]);
    expect(ruptures).toEqual([]);
  });

  it("survit à une portée vide `feat(): x` sans planter", () => {
    expect(() => analyserCommits(["feat(): x"])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("rendreChangelog — Keep a Changelog", () => {
  const base = { version: "10.0.0", date: "2026-08-25" };

  it("titre la version et la date au format ISO", () => {
    const s = rendreChangelog({ ...base, ruptures: [], groupes: new Map() });
    expect(s.split("\n")[0]).toBe("## [10.0.0] — 2026-08-25");
  });

  it("se déclare BROUILLON dans le fichier lui-même", () => {
    const s = rendreChangelog({ ...base, ruptures: [], groupes: new Map() });
    expect(s).toMatch(/BROUILLON/);
  });

  it("🔴 met les ruptures AVANT toute autre section", () => {
    const s = rendreChangelog({
      ...base,
      ruptures: [{ portee: "http", texte: "rupture" }],
      groupes: new Map([["Ajouté", [{ portee: "", texte: "nouveauté" }]]]),
    });
    expect(s.indexOf("Ruptures")).toBeLessThan(s.indexOf("Ajouté"));
  });

  it("n'écrit pas de section Ruptures quand il n'y en a pas", () => {
    const s = rendreChangelog({ ...base, ruptures: [], groupes: new Map() });
    expect(s).not.toMatch(/Ruptures/);
  });

  it("respecte l'ordre normalisé des sections, pas l'ordre d'insertion", () => {
    const s = rendreChangelog({
      ...base,
      ruptures: [],
      groupes: new Map([
        ["Interne", [{ portee: "", texte: "i" }]],
        ["Ajouté", [{ portee: "", texte: "a" }]],
        ["Corrigé", [{ portee: "", texte: "c" }]],
      ]),
    });
    expect(s.indexOf("Ajouté")).toBeLessThan(s.indexOf("Corrigé"));
    expect(s.indexOf("Corrigé")).toBeLessThan(s.indexOf("Interne"));
  });

  it("ne mute pas les tableaux qu'on lui passe", () => {
    const entrees = [
      { portee: "z", texte: "z" },
      { portee: "a", texte: "a" },
    ];
    rendreChangelog({
      ...base,
      ruptures: [],
      groupes: new Map([["Ajouté", entrees]]),
    });
    expect(entrees[0].portee).toBe("z"); // le tri est fait sur une copie
  });
});

// ═══════════════════════════════════════════════════════════════════════════
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
