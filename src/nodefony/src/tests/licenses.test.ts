import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import assert from "node:assert";

import {
  accept,
  collect,
  ALLOWED,
  ALLOWED_EXPRESSIONS,
  duty,
  LICENSE_DUTY,
  normalizeLicense,
  refusalReason,
  renderNotices,
  renderReport,
  LicenseInventoryError,
  surveyLicenses,
  templateRuntimeDeps,
  type ILicenseSurvey,
} from "../cli/licenses";

/**
 * SPEC — « une licence hors liste n'est pas inconnue, elle est refusée ».
 *
 * La règle décide ce que le framework et les applications qu'il génère ont le
 * droit de redistribuer. Elle doit donc REFUSER : un contrôle de licences qui ne
 * dit jamais non n'a jamais rien gardé, et se découvre le jour d'une publication
 * qui ne se reprend pas.
 *
 * Ce qui est éprouvé ici est la DÉCISION, pas le transport : l'inventaire vient
 * de `npm sbom`, dont l'équivalence avec l'outil précédent a été constatée sur
 * l'arbre réel du dépôt (mêmes total, décompte, refus et non-couvert).
 */

/** Un relevé fabriqué — ce que `surveyLicenses` rendrait, sans lancer npm. */
function releve(
  packages: Array<{ name: string; version: string; license: string }>,
  extra: Partial<ILicenseSurvey> = {},
): ILicenseSurvey {
  const tally = new Map<string, number>();
  const refused = packages.filter((p) => {
    const retenu = accept(p.license);
    tally.set(retenu ?? p.license, (tally.get(retenu ?? p.license) ?? 0) + 1);
    return retenu === null;
  });
  return {
    root: "/tmp/app",
    rootName: "app",
    workspaces: [],
    packages,
    peerCount: 0,
    tally,
    refused,
    uncovered: [],
    ...extra,
  };
}

describe("licences — la liste d'acceptation REFUSE, sinon elle ne garde rien", () => {
  it("un copyleft fort est refusé", () => {
    // Le cas qui fonde la règle : redistribuer sous Apache-2.0 ce qui exige d'être
    // redistribué sous GPL est contradictoire.
    for (const licence of ["GPL-3.0", "AGPL-3.0", "SSPL-1.0", "GPL-2.0"]) {
      assert.strictEqual(accept(licence), null, `${licence} doit être refusée`);
    }
  });

  it("une licence JAMAIS EXAMINÉE est refusée, pas tolérée", () => {
    // Une liste qui s'étend toute seule à ce qu'elle rencontre ne garde rien.
    assert.strictEqual(accept("WTFPL"), null);
    assert.strictEqual(accept("NOASSERTION"), null);
    assert.strictEqual(accept(""), null);
  });

  it("un OU laisse le choix et passe ; un ET cumule les obligations et tombe", () => {
    // `(BSD-3-Clause OR GPL-2.0)` est acceptable parce qu'on RETIENT BSD.
    assert.strictEqual(accept("(BSD-3-Clause OR GPL-2.0)"), "BSD-3-Clause");
    assert.strictEqual(accept("(MIT OR Apache-2.0)"), "MIT");
    // Le `AND` n'est dans aucune table, et ne doit jamais y tomber par déduction.
    assert.strictEqual(accept("(MIT AND GPL-2.0)"), null);
    assert.strictEqual(accept("MIT AND GPL-2.0"), null);
  });

  it("les permissives usuelles passent, sous leur propre terme", () => {
    for (const licence of [
      "MIT",
      "ISC",
      "Apache-2.0",
      "BSD-3-Clause",
      "CECILL-B",
    ]) {
      assert.strictEqual(accept(licence), licence);
      assert.ok(ALLOWED.has(licence));
    }
  });

  it("un paquet interdit fait TOMBER le verdict, et le rapport le NOMME", () => {
    // C'est la garde vue mordre : sans ce cas, rien ne prouve que le refus
    // remonte jusqu'à l'appelant plutôt que de se perdre dans un décompte.
    const survey = releve([
      { name: "left-pad", version: "1.3.0", license: "MIT" },
      { name: "outil-copyleft", version: "2.0.0", license: "GPL-3.0" },
    ]);
    assert.strictEqual(survey.refused.length, 1);
    assert.strictEqual(survey.refused[0]?.name, "outil-copyleft");

    const rapport = renderReport(survey);
    assert.match(
      rapport,
      /outil-copyleft@2\.0\.0/,
      "le paquet fautif doit être nommé",
    );
    assert.match(rapport, /GPL-3\.0/, "sa licence doit être citée");
    assert.doesNotMatch(
      rapport,
      /toutes les licences sont dans la liste/,
      "un relevé qui porte un refus ne peut pas annoncer un quitus",
    );
  });

  it("un relevé SANS refus annonce le quitus", () => {
    const rapport = renderReport(
      releve([{ name: "left-pad", version: "1.3.0", license: "MIT" }]),
    );
    assert.match(rapport, /✅ toutes les licences sont dans la liste/);
  });
});

describe("licences — la lecture d'un manifeste", () => {
  it("lit les trois formes du champ, et ne devine jamais", () => {
    assert.strictEqual(normalizeLicense({ license: "MIT" }), "MIT");
    assert.strictEqual(normalizeLicense({ license: { type: "ISC" } }), "ISC");
    assert.strictEqual(
      normalizeLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
      "(MIT OR Apache-2.0)",
    );
    // Paquet absent, ou manifeste muet : NOASSERTION, qui est REFUSÉ. Le doute
    // ne profite pas à la dépendance.
    assert.strictEqual(normalizeLicense(null), "NOASSERTION");
    assert.strictEqual(normalizeLicense({}), "NOASSERTION");
    assert.strictEqual(accept(normalizeLicense(null)), null);
  });
});

describe("licences — les dépendances du gabarit d'application", () => {
  it("relève les noms tiers du bloc dependencies, et écarte les nôtres", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-lic-"));
    const file = path.join(dir, "package.json.tpl");
    fs.writeFileSync(
      file,
      [
        "{",
        '  "name": "<%= it.appName %>",',
        '  "dependencies": {',
        '    "nodefony": "^10.0.0",',
        '    "@nodefony/http": "^10.0.0",',
        '    "drizzle-orm": "<%= it.pkg.drizzle %>",',
        '    "zod": "<%= it.pkg.zod %>"',
        "  },",
        '  "devDependencies": {',
        '    "vitest": "^4.0.0"',
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    // Les paquets Nodefony sont relevés par ailleurs ; les devDependencies ne
    // partent dans aucune image de production.
    assert.deepStrictEqual(templateRuntimeDeps(file), ["drizzle-orm", "zod"]);
    assert.deepStrictEqual(
      templateRuntimeDeps(path.join(dir, "absent.tpl")),
      [],
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("licences — le relevé écrit dans une application", () => {
  it("dit qu'il est généré, liste les paquets, et énonce son angle mort", () => {
    const md = renderNotices(
      releve([
        { name: "left-pad", version: "1.3.0", license: "MIT" },
        { name: "zod", version: "4.0.0", license: "MIT" },
      ]),
    );
    // Un inventaire écrit à la main se périme au premier `npm install` : le
    // fichier doit le DIRE, sinon il sera édité.
    assert.match(md, /généré/);
    assert.match(md, /nodefony licenses --write/);
    assert.match(md, /\| `left-pad` \| 1\.3\.0 \| MIT \|/);
    assert.match(md, /\| `zod` \| 4\.0\.0 \| MIT \|/);
    // L'angle mort s'énonce plutôt que de laisser croire à une couverture totale.
    assert.match(md, /transitif des dépendances de pair/);
  });
});

describe("licences — l'INVENTAIRE, et le piège qui l'avait vidé", () => {
  /**
   * Le décor qui reproduit le défaut, en quatre fichiers et sans réseau.
   *
   * `a` est une dépendance de PRODUCTION. `d` est un outil de développement qui
   * PRESCRIT `a` en dépendance de pair — exactement ce que fait
   * `@nodefony/devkit` dans une application générée. Arborist marque alors `a`
   * comme joignable par un chemin de développement, et `npm sbom --omit=dev`,
   * dont le sélecteur porte `:not(.dev)`, le fait disparaître : mesuré, son
   * inventaire tombait au seul paquet racine, sans erreur ni code non nul.
   */
  function decorMinimal(): string {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), "nf-licenses-"));
    fs.writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({
        name: "sonde",
        version: "1.0.0",
        private: true,
        dependencies: { a: "1.0.0" },
        devDependencies: { d: "1.0.0" },
      }),
    );
    const poser = (nom: string, manifeste: object): void => {
      const dir = path.join(racine, "node_modules", nom);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify(manifeste),
      );
    };
    poser("a", { name: "a", version: "1.0.0", license: "MIT" });
    poser("d", {
      name: "d",
      version: "1.0.0",
      license: "MIT",
      peerDependencies: { a: "1.0.0" },
    });
    return racine;
  }

  it("relève une dépendance de production qu'un outil de dev prescrit AUSSI", () => {
    const racine = decorMinimal();
    try {
      const inventaire = collect(racine);
      const noms = inventaire.map((pkg) => pkg.name);
      // Le cas qui a bloqué la publication : `a` part chez l'utilisateur, donc
      // il doit être relevé — que `d` le prescrive ou non n'y change rien.
      assert.ok(
        noms.includes("a"),
        `la dépendance de production est absente de l'inventaire : ${noms.join(", ")}`,
      );
      // L'outil de développement, lui, ne part nulle part.
      assert.ok(
        !noms.includes("d"),
        "un outil de développement n'est pas redistribué",
      );
      // Et sa licence est lue, pas devinée.
      assert.strictEqual(
        inventaire.find((pkg) => pkg.name === "a")?.license,
        "MIT",
      );
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it("REFUSE un inventaire que le manifeste contredit, plutôt que d'écrire un relevé amputé", () => {
    const racine = decorMinimal();
    try {
      // L'arbre est retiré sous les pieds de la commande : npm répond sans
      // erreur, et son résultat ne contient plus la dépendance déclarée.
      fs.rmSync(path.join(racine, "node_modules"), {
        recursive: true,
        force: true,
      });
      assert.throws(
        () => surveyLicenses(racine),
        (erreur: unknown) => {
          assert.ok(erreur instanceof LicenseInventoryError);
          // Le message NOMME ce qui manque — un relevé vide se lirait comme un
          // verdict, et « on ne redistribue rien » serait un mensonge.
          assert.match((erreur as Error).message, /\ba\b/);
          return true;
        },
      );
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

describe("licences — un paquet installé N fois est UNE obligation, pas N", () => {
  it("dédoublonne par nom@version, et garde deux versions distinctes", () => {
    // `npm query` rend un nœud par EMPLACEMENT : un paquet que npm n'a pas pu
    // hisser est physiquement présent plusieurs fois. Mesuré sur ce dépôt,
    // `@inquirer/core@12.0.3` sortait dix fois.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), "nf-licenses-dup-"));
    try {
      fs.writeFileSync(
        path.join(racine, "package.json"),
        JSON.stringify({
          name: "sonde-doublons",
          version: "1.0.0",
          private: true,
          dependencies: { haut: "1.0.0", bas: "1.0.0" },
        }),
      );
      const poser = (rel: string, manifeste: object): void => {
        const dir = path.join(racine, ...rel.split("/"));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify(manifeste),
        );
      };
      // Deux parents, chacun avec SA copie physique du même `commun@1.0.0` :
      // c'est cet arbre-là qui produit les doublons, et Arborist résout bien
      // chaque parent vers sa copie imbriquée. Un exemplaire hissé à la racine
      // ne conviendrait pas — personne ne l'atteindrait, donc `.prod` l'ignore.
      poser("node_modules/haut", {
        name: "haut",
        version: "1.0.0",
        license: "MIT",
        dependencies: { commun: "1.0.0", autre: "2.0.0" },
      });
      poser("node_modules/bas", {
        name: "bas",
        version: "1.0.0",
        license: "MIT",
        dependencies: { commun: "1.0.0" },
      });
      poser("node_modules/haut/node_modules/commun", {
        name: "commun",
        version: "1.0.0",
        license: "MIT",
      });
      poser("node_modules/bas/node_modules/commun", {
        name: "commun",
        version: "1.0.0",
        license: "MIT",
      });
      // Et une SECONDE version du même nom : ce n'est PAS un doublon — deux
      // paquets distincts, chacun redistribué avec sa propre notice.
      poser("node_modules/haut/node_modules/autre", {
        name: "commun",
        version: "2.0.0",
        license: "MIT",
      });

      const inventaire = collect(racine);
      const communs = inventaire.filter((pkg) => pkg.name === "commun");
      assert.deepStrictEqual(
        communs.map((pkg) => pkg.version).sort(),
        ["1.0.0", "2.0.0"],
        `les deux VERSIONS restent, les copies physiques fusionnent : ${JSON.stringify(communs)}`,
      );
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

describe("licences — ce que chacune impose, à côté de son décompte", () => {
  it("chaque licence ACCEPTÉE porte son obligation — une case vide dans un document complet", () => {
    // Le décompte seul n'est pas actionnable : il dit combien, jamais quoi
    // faire. Une licence ajoutée à la liste sans son obligation laisserait une
    // ligne muette dans un tableau qui a l'air exhaustif.
    const sans = [...ALLOWED].filter((licence) => !LICENSE_DUTY.has(licence));
    assert.deepStrictEqual(
      sans,
      [],
      `licences acceptées sans obligation renseignée : ${sans.join(", ")}`,
    );
    // Et le terme RETENU d'une expression composée doit l'être aussi, sinon
    // « (MIT OR CC0-1.0) » rendrait une case vide.
    for (const retenu of ALLOWED_EXPRESSIONS.values()) {
      assert.ok(
        LICENSE_DUTY.has(retenu),
        `le terme retenu « ${retenu} » n'a pas d'obligation renseignée`,
      );
    }
  });

  it("une licence hors liste dit qu'elle n'a pas été examinée, pas qu'elle est libre", () => {
    // Famille connue : la raison prime sur le « à examiner » générique.
    assert.match(duty("GPL-3.0"), /copyleft FORT/);
    // Famille inconnue : on ne prétend rien.
    assert.match(duty("Licence-Interne-1.0"), /EXAMINER/);
    assert.match(duty("MPL-2.0"), /copyleft de FICHIER/);
    // Une expression composée hérite de l'obligation du terme retenu.
    assert.strictEqual(duty("(MIT OR CC0-1.0)"), duty("MIT"));
  });
});

describe("licences — un refus qui EXPLIQUE, pour les familles qui reviendront", () => {
  it("nomme la raison, et ne confond pas AGPL avec GPL", () => {
    // Le piège d'un rapprochement par préfixe : « AGPL-3.0 » contient « GPL ».
    // Les deux obligations sont pourtant très différentes — l'une se déclenche
    // à la distribution, l'autre au simple fait de SERVIR l'application.
    assert.match(duty("AGPL-3.0"), /RÉSEAU/);
    assert.match(duty("GPL-3.0-only"), /copyleft FORT/);
    assert.match(duty("LGPL-2.1"), /BIBLIOTHÈQUE/);
    assert.match(duty("SSPL-1.0"), /infrastructure/);
    // Pas de licence déclarée n'est PAS « libre par défaut » — c'est l'inverse.
    assert.match(duty("NOASSERTION"), /tous droits réservés/);
  });

  it("une famille inconnue reste refusée, et le DIT sans inventer de raison", () => {
    assert.match(duty("Licence-Maison-2.0"), /à EXAMINER/);
    assert.strictEqual(refusalReason("Licence-Maison-2.0"), null);
    // Et une licence ACCEPTÉE ne passe jamais par la table des refus.
    assert.strictEqual(refusalReason("MIT"), null);
  });
});
