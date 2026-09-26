import assert from "node:assert/strict";
import {
  readProjectScripts,
  formatProjectScripts,
  loadProjectScripts,
  groupOfScript,
  groupProjectScripts,
} from "../cli/projectScripts";

// Ce que ces tests protègent : l'aide ne doit RIEN afficher tant qu'un projet
// n'a rien déclaré (sinon toute application paie une section vide), et elle ne
// doit jamais lever — une aide qui plante parce qu'un fichier voisin est cassé
// est pire que l'absence de la section.

describe("projectScripts — lire les scripts d'un manifeste", () => {
  it("apparie chaque script à sa description", () => {
    const scripts = readProjectScripts({
      scripts: { build: "turbo run build", test: "vitest run" },
      nodefony: { scripts: { build: "Compile tous les paquets." } },
    });
    assert.equal(scripts.length, 2);
    assert.deepEqual(scripts[0], {
      name: "build",
      command: "turbo run build",
      description: "Compile tous les paquets.",
    });
    assert.equal(
      scripts[1].description,
      null,
      "non déclaré → null, pas une chaîne vide",
    );
  });

  it("garde l'ordre du manifeste — c'est celui que l'auteur a choisi", () => {
    const scripts = readProjectScripts({
      scripts: { zeta: "z", alpha: "a", mid: "m" },
    });
    assert.deepEqual(
      scripts.map((s) => s.name),
      ["zeta", "alpha", "mid"],
    );
  });

  it("une description vide ou blanche vaut absente", () => {
    const scripts = readProjectScripts({
      scripts: { a: "x", b: "y" },
      nodefony: { scripts: { a: "", b: "   " } },
    });
    assert.equal(scripts[0].description, null);
    assert.equal(scripts[1].description, null);
  });

  it("ne lève sur aucune forme aberrante", () => {
    assert.deepEqual(readProjectScripts(null), []);
    assert.deepEqual(readProjectScripts("pas un objet"), []);
    assert.deepEqual(readProjectScripts({}), []);
    assert.deepEqual(readProjectScripts({ scripts: null }), []);
  });
});

describe("projectScripts — rendre le bloc d'aide", () => {
  it("ne rend RIEN quand aucune description n'est déclarée", () => {
    const rendu = formatProjectScripts(
      readProjectScripts({ scripts: { a: "x", b: "y" } }),
    );
    assert.equal(
      rendu,
      "",
      "une section vide encombrerait l'aide de tous les projets",
    );
  });

  it("aligne les noms et n'affiche que ce qui est décrit", () => {
    const rendu = formatProjectScripts(
      readProjectScripts({
        scripts: { build: "x", "test:all": "y", caché: "z" },
        nodefony: {
          scripts: { build: "Compile.", "test:all": "Tout éprouver." },
        },
      }),
    );
    assert.match(rendu, /Scripts npm de ce projet/);
    assert.match(rendu, /build {5}Compile\./);
    assert.match(rendu, /test:all {2}Tout éprouver\./);
    assert.doesNotMatch(
      rendu,
      /caché/,
      "un script sans description ne se liste pas",
    );
    assert.match(
      rendu,
      /\+ 1 script sans description/,
      "mais il se COMPTE, sinon on le croit absent",
    );
  });

  it("accorde le pluriel du décompte", () => {
    const rendu = formatProjectScripts(
      readProjectScripts({
        scripts: { a: "x", b: "y", c: "z" },
        nodefony: { scripts: { a: "Décrit." } },
      }),
    );
    assert.match(rendu, /\+ 2 scripts sans description/);
  });
});

describe("projectScripts — lire depuis le disque", () => {
  it("un dossier sans package.json rend une liste vide, sans lever", () => {
    assert.deepEqual(loadProjectScripts("/dossier/qui/n/existe/pas"), []);
  });

  it("lit le dépôt courant", () => {
    const scripts = loadProjectScripts(process.cwd());
    assert.ok(scripts.length > 0, "ce dépôt déclare des scripts");
    assert.ok(scripts.every((s) => typeof s.command === "string"));
  });
});

describe("projectScripts — le classement est DÉRIVÉ, pas déclaré", () => {
  it("range chaque famille de nom là où on l'attend", () => {
    const cas: Array<[string, string]> = [
      ["build", "DÉVELOPPER"],
      ["build:core", "DÉVELOPPER"],
      ["dev", "DÉVELOPPER"],
      ["clean", "DÉVELOPPER"],
      ["test", "ÉPROUVER"],
      ["test:all", "ÉPROUVER"],
      ["coverage", "ÉPROUVER"],
      ["verify", "ÉPROUVER"],
      ["lint", "CONTRÔLER"],
      ["typecheck", "CONTRÔLER"],
      ["check:lang", "CONTRÔLER"],
      ["deps:check", "CONTRÔLER"],
      ["doc:lint", "DOCUMENTER"],
      ["skills:doc", "DOCUMENTER"],
      ["board:snapshot", "PILOTER"],
      ["ticket:open", "PILOTER"],
      ["release", "PUBLIER"],
      ["release:pack", "PUBLIER"],
    ];
    for (const [nom, attendu] of cas) {
      assert.equal(groupOfScript(nom), attendu, `${nom} mal rangé`);
    }
  });

  it("un nom EXACT gagne sur un préfixe — test:pilotage éprouve le pilotage", () => {
    assert.equal(groupOfScript("test:pilotage"), "PILOTER");
    assert.equal(groupOfScript("test:release"), "PUBLIER");
  });

  it("un préfixe trop large ne mord pas — `dev` n'avale pas `devkit:selftest`", () => {
    assert.equal(groupOfScript("dev"), "DÉVELOPPER");
    assert.equal(groupOfScript("devkit:selftest"), "ÉPROUVER");
  });

  it("un script inconnu reste VISIBLE dans AUTRES, jamais perdu", () => {
    assert.equal(groupOfScript("quelque-chose-de-neuf"), "AUTRES");
    assert.equal(groupOfScript("certificates"), "AUTRES");
  });

  it("les familles sortent dans l'ordre d'usage, les vides retirées", () => {
    const groupes = groupProjectScripts(
      readProjectScripts({
        scripts: { release: "r", build: "b", test: "t" },
        nodefony: {
          scripts: { release: "Publie.", build: "Bâtit.", test: "Éprouve." },
        },
      }),
    );
    assert.deepEqual(
      groupes.map((g) => g.title),
      ["DÉVELOPPER", "ÉPROUVER", "PUBLIER"],
      "l'ordre est celui de l'usage, pas celui du manifeste",
    );
  });

  it("dans une famille, l'ordre est alphabétique — donc stable", () => {
    const groupes = groupProjectScripts(
      readProjectScripts({
        scripts: { "build:core": "c", build: "b", "build:all": "a" },
        nodefony: {
          scripts: { "build:core": "C.", build: "B.", "build:all": "A." },
        },
      }),
    );
    assert.deepEqual(
      groupes[0].scripts.map((s) => s.name),
      ["build", "build:all", "build:core"],
    );
  });

  it("un script sans description ne se range nulle part", () => {
    const groupes = groupProjectScripts(
      readProjectScripts({ scripts: { build: "b" } }),
    );
    assert.equal(groupes.length, 0);
  });
});
