/**
 * `doctor` — les gardes du projet sont-elles ARMÉES ?
 *
 * Un filet décroché ne fait pas de bruit : le lint passe, la forge est verte,
 * et plus rien ne retient `any` ni `@ts-ignore`. Ces cas éprouvent le seul
 * contrôle qui puisse le dire — et vérifient qu'il ne signale JAMAIS une
 * occurrence de code, ce que le linter fait déjà, et mieux.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkGuards, VERIFY_STEPS } from "../kernel/checks/guards";
import { editDistance, likelyTypo } from "../kernel/checks/runCheck";

let racine = "";

/** Le manifeste d'un projet dont toutes les gardes tiennent. */
const MANIFESTE_SAIN = {
  scripts: {
    lint: "oxlint --deny-warnings",
    typecheck: "tsgo --noEmit",
    verify: "npm run typecheck && npm run lint && npm test",
  },
};

/** La configuration d'un linter dont toutes les règles mordent. */
const LINTER_SAIN = {
  rules: {
    "typescript/no-explicit-any": "warn",
    "typescript/ban-ts-comment": "warn",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/tests/**/*.ts"],
      rules: { "typescript/no-explicit-any": "off" },
    },
  ],
};

const poser = (nom: string, contenu: unknown): void => {
  writeFileSync(
    path.join(racine, nom),
    typeof contenu === "string" ? contenu : JSON.stringify(contenu, null, 2),
    "utf8",
  );
};

const controler = () => checkGuards({ projectRoot: racine });

beforeEach(() => {
  racine = mkdtempSync(path.join(tmpdir(), "nf-guards-"));
  poser("package.json", MANIFESTE_SAIN);
  poser(".oxlintrc.json", LINTER_SAIN);
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe("checkGuards — un filet décroché ne fait pas de bruit", () => {
  it("un projet sain ne signale rien, et COMPTE ses gardes", () => {
    const r = controler();
    assert.lengthOf(r.findings, 0);
    // Le compte est ce que le sommaire affiche : « 5 gardes armées » dit plus
    // qu'un « rien à signaler », qui ne distingue pas d'un contrôle qui n'a
    // rien regardé.
    assert.equal(r.armed, 5);
  });

  it("🔴 `lint` sans `--deny-warnings` : la garde est là, mais ne retient rien", () => {
    poser("package.json", {
      scripts: { ...MANIFESTE_SAIN.scripts, lint: "oxlint" },
    });
    const r = controler();
    assert.equal(r.findings[0]?.kind, "lint-not-blocking");
    assert.include(r.findings[0]?.message ?? "", "--deny-warnings");
  });

  it("🔴 une règle désactivée GLOBALEMENT est signalée, avec son pourquoi", () => {
    poser(".oxlintrc.json", {
      rules: { ...LINTER_SAIN.rules, "typescript/no-explicit-any": "off" },
    });
    const r = controler();
    assert.equal(r.findings[0]?.kind, "rule-disabled");
    assert.include(r.findings[0]?.message ?? "", "no-explicit-any");
    assert.include(r.findings[0]?.message ?? "", "éteint le typage");
  });

  it('`0` désarme autant que `"off"` — et le tableau aussi', () => {
    poser(".oxlintrc.json", {
      rules: {
        "typescript/no-explicit-any": 0,
        "typescript/ban-ts-comment": ["off", {}],
      },
    });
    assert.lengthOf(controler().findings, 2);
  });

  it("la désactivation SOUS les tests est voulue — elle ne lève rien", () => {
    // C'est ce qui rend un `off` global difficile à repérer à l'œil : il
    // ressemble à celui-ci. Un contrôle qui crierait ici serait désactivé.
    assert.lengthOf(controler().findings, 0);
  });

  it("🔴 une exception LARGE est un `off` global qui n'en a pas l'air", () => {
    poser(".oxlintrc.json", {
      rules: LINTER_SAIN.rules,
      overrides: [
        {
          files: ["src/**/*.ts"],
          rules: { "typescript/no-explicit-any": "off" },
        },
      ],
    });
    const r = controler();
    assert.equal(r.findings[0]?.kind, "rule-disabled");
    assert.include(r.findings[0]?.message ?? "", "src/**/*.ts");
  });

  it("un `typecheck` absent est signalé — le bundler ne vérifie pas les types", () => {
    poser("package.json", {
      scripts: { lint: MANIFESTE_SAIN.scripts.lint },
    });
    const r = controler();
    assert.include(
      r.findings.map((f) => f.kind),
      "typecheck-missing",
    );
  });

  it("🔴 une chaîne `verify` amputée est signalée, en NOMMANT ce qui manque", () => {
    poser("package.json", {
      scripts: { ...MANIFESTE_SAIN.scripts, verify: "npm run lint" },
    });
    const r = controler();
    const f = r.findings.find((x) => x.kind === "verify-broken");
    assert.isDefined(f);
    for (const etape of VERIFY_STEPS.filter((e) => e !== "lint")) {
      assert.include(f?.message ?? "", etape);
    }
  });

  it("un manifeste illisible se DIT, il ne se lit pas comme un quitus", () => {
    poser("package.json", "{ ceci n'est pas du JSON");
    const r = controler();
    assert.isTrue(r.manifestUnreadable);
    // Rien n'est affirmé sur ce qu'on n'a pas pu lire.
    assert.lengthOf(
      r.findings.filter((f) => f.file === "package.json"),
      0,
    );
  });

  it("🔴 aucun manquement ne porte sur une OCCURRENCE de code", () => {
    // Le ticket le dit en toutes lettres, et ce cas est là pour que personne ne
    // l'ajoute plus tard : un contrôle recopié en expression régulière se
    // tromperait sur les commentaires et les chaînes, et divergerait du linter.
    poser("package.json", { scripts: {} });
    poser(".oxlintrc.json", { rules: {} });
    for (const f of controler().findings) {
      assert.oneOf(f.file, ["package.json", ".oxlintrc.json"]);
    }
  });

  it("la configuration du linter accepte les COMMENTAIRES", () => {
    // Celle du dépôt en porte : les refuser rendrait le contrôle aveugle
    // exactement là où il doit voir.
    poser(
      ".oxlintrc.json",
      '{\n  // une règle, et son pourquoi\n  "rules": { "typescript/no-explicit-any": "off" }\n}',
    );
    const r = controler();
    assert.isFalse(r.linterUnreadable);
    assert.equal(r.findings[0]?.kind, "rule-disabled");
  });
});

describe("--env — une faute de frappe ne doit pas rendre un rapport plausible", () => {
  it("🔴 `produntion` est refusé, et le bon mot est proposé", () => {
    // Vécu : le rapport sortait COMPLET, verdict compris, sur un environnement
    // qui n'existe nulle part — le mot inventé s'affichait dans chaque phrase.
    assert.equal(likelyTypo("produntion"), "production");
  });

  it("les modes connus passent, évidemment", () => {
    for (const mode of ["production", "development", "dev", "prod", "test"]) {
      assert.isNull(likelyTypo(mode));
    }
  });

  it("🔴 un environnement de DÉPLOIEMENT libre reste accepté", () => {
    // Refuser tout inconnu rendrait l'option inutilisable là où elle sert : la
    // liste des environnements de déploiement est ouverte par construction.
    for (const libre of ["preprod", "staging", "qa", "recette", "canary"]) {
      assert.isNull(likelyTypo(libre), libre);
    }
  });

  it("la casse ne fabrique pas une faute", () => {
    assert.isNull(likelyTypo("PRODUCTION"));
  });

  it("la distance est bornée — on ne mesure pas, on tranche", () => {
    assert.equal(editDistance("production", "production"), 0);
    assert.equal(editDistance("produntion", "production"), 1);
    assert.isAbove(editDistance("a", "abcdefghij"), 3);
  });
});

/**
 * 🔴 Ce que le contrôle ne voyait PAS : l'ABSENCE.
 *
 * Il n'incrémentait `armed` que faute d'avoir trouvé un `off` — donc une règle
 * jamais déclarée, un `lint` inexistant et un `verify` absent comptaient tous
 * comme des gardes en place. Un projet sans le moindre filet s'entendait dire
 * « 3 gardes armées » : le contrôle reproduisait exactement le mode de
 * défaillance qu'il existe pour attraper.
 */
describe("checkGuards — une garde ABSENTE n'est pas une garde armée", () => {
  it("⭐ configuration VIDE et aucun script : rien n'est compté armé", () => {
    poser("package.json", { scripts: {} });
    poser(".oxlintrc.json", {});
    const r = controler();
    assert.equal(r.armed, 0, "aucune garde n'existe : le compte doit être nul");
    const kinds = r.findings.map((f) => f.kind).sort();
    assert.deepStrictEqual(kinds, [
      "lint-missing",
      "rule-missing",
      "rule-missing",
      "typecheck-missing",
      "verify-missing",
    ]);
  });

  it("🔴 une règle jamais déclarée est signalée — elle ne dit rien", () => {
    poser(".oxlintrc.json", { rules: {} });
    const r = controler();
    assert.lengthOf(r.findings, 2);
    assert.equal(r.findings[0]?.kind, "rule-missing");
    assert.include(r.findings[0]?.message ?? "", "n'est déclarée nulle part");
  });

  it("la CATÉGORIE qui l'active suffit — sans nommer la règle", () => {
    // Constaté en exécutant oxlint catégorie par catégorie : `no-explicit-any`
    // est dans `restriction`, `ban-ts-comment` dans `pedantic`. Un projet qui
    // les retient a la garde, et crier ici l'apprendrait à ignorer `doctor`.
    poser(".oxlintrc.json", {
      categories: { restriction: "warn", pedantic: "warn" },
      rules: {},
    });
    const r = controler();
    assert.lengthOf(r.findings, 0);
    assert.equal(r.armed, 5);
  });

  it("une catégorie posée à `off` n'arme rien", () => {
    poser(".oxlintrc.json", {
      categories: { restriction: "off", pedantic: "allow" },
      rules: {},
    });
    assert.lengthOf(controler().findings, 2);
  });

  it('🔴 `"allow"` est le mot d\'oxlint pour `off` — il désarme aussi', () => {
    poser(".oxlintrc.json", {
      rules: {
        "typescript/no-explicit-any": "allow",
        "typescript/ban-ts-comment": ["allow"],
      },
    });
    const r = controler();
    assert.lengthOf(r.findings, 2);
    assert.equal(r.findings[0]?.kind, "rule-disabled");
  });

  it("l'alias `@typescript-eslint/…` compte — oxlint l'accepte", () => {
    poser(".oxlintrc.json", {
      rules: {
        "@typescript-eslint/no-explicit-any": "warn",
        "ban-ts-comment": "error",
      },
    });
    const r = controler();
    assert.lengthOf(
      r.findings,
      0,
      "ce sont les MÊMES règles, écrites autrement",
    );
    assert.equal(r.armed, 5);
  });

  it("…et le même alias posé à `off` ne passe pas non plus", () => {
    poser(".oxlintrc.json", {
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "typescript/ban-ts-comment": "warn",
      },
    });
    const r = controler();
    assert.lengthOf(r.findings, 1);
    assert.equal(r.findings[0]?.kind, "rule-disabled");
  });

  it("🔴 sans script `lint`, la configuration du linter ne garde plus rien", () => {
    poser("package.json", {
      scripts: {
        typecheck: "tsgo --noEmit",
        verify: VERIFY_STEPS.join(" && "),
      },
    });
    const r = controler();
    assert.equal(r.findings[0]?.kind, "lint-missing");
  });

  it("🔴 sans chaîne `verify`, rien n'enchaîne les contrôles", () => {
    poser("package.json", {
      scripts: { lint: "oxlint --deny-warnings", typecheck: "tsgo --noEmit" },
    });
    const r = controler();
    assert.equal(r.findings[0]?.kind, "verify-missing");
    for (const etape of VERIFY_STEPS) {
      assert.include(r.findings[0]?.message ?? "", etape);
    }
  });
});
