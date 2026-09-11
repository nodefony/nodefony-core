import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import assert from "node:assert";

import {
  accept,
  ALLOWED,
  normalizeLicense,
  renderNotices,
  renderReport,
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
    // Le cas qui fonde la règle : redistribuer sous CeCILL-B ce qui exige d'être
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
