/**
 * Un tableau qui TIENT dans le terminal — sinon ce n'est plus un tableau.
 *
 * `console.table` rendait `nodefony inspect routes` sur des lignes de 900
 * colonnes : le terminal les repliait, chaque ligne en occupait dix, et
 * l'alignement qui justifiait la forme avait disparu. Signalé sur le rendu
 * réel.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  columnsOf,
  formatCell,
  renderTable,
  repartir,
  type TableRow,
} from "../cli/tableReport";

/** Des routes, comme le data plane les rend — l'ordre des clés est le sien. */
const routes: TableRow[] = [
  {
    name: "route-app-index",
    path: "/app",
    methods: ["GET"],
    controller: "AppController",
    action: "index",
    module: "app",
    host: null,
    bypassFirewall: false,
  },
  {
    name: "route-nodefony-test-index",
    path: "/nodefony/test/index",
    methods: ["GET", "HEAD"],
    controller: "DefaultController",
    action: "index",
    module: "test",
    host: null,
    bypassFirewall: false,
  },
];

describe("formatCell — une cellule se lit, elle n'est pas du JSON", () => {
  it("rend l'absence, les booléens et les listes comme un humain les dit", () => {
    assert.equal(formatCell(null), "—");
    assert.equal(formatCell(undefined), "—");
    assert.equal(formatCell(true), "oui");
    assert.equal(formatCell(false), "non");
    assert.equal(formatCell(["GET", "HEAD"]), "GET, HEAD");
    assert.equal(formatCell("/app"), "/app");
    assert.equal(formatCell(3), "3");
  });

  it("un objet imbriqué dit sa FORME — son contenu est affaire de `--json`", () => {
    assert.equal(formatCell({ a: 1, b: 2 }), "{a, b}");
    assert.equal(formatCell({}), "{}");
  });
});

describe("colonnesDe — l'union des clés, dans l'ordre du producteur", () => {
  it("garde l'ordre de rencontre et ne double aucune clé", () => {
    assert.deepStrictEqual(
      columnsOf([
        { b: 1, a: 2 },
        { a: 3, c: 4 },
      ]),
      ["b", "a", "c"],
    );
  });
});

describe("repartir — les colonnes LARGES cèdent, pas les courtes", () => {
  it("laisse tout le monde servi quand la place suffit", () => {
    assert.deepStrictEqual(repartir([10, 5, 5], 40), [10, 5, 5]);
  });

  it("🔴 rogne la plus large d'abord — rogner à parts égales tue les courtes", () => {
    const r = repartir([40, 8, 6], 40);
    assert.isBelow(r[0] ?? 0, 40, "la large a cédé");
    assert.equal(r[1], 8, "la courte est intacte");
    assert.equal(r[2], 6);
  });

  it("ne descend jamais une colonne sous le seuil du lisible", () => {
    for (const largeur of repartir([30, 30, 30], 10)) {
      assert.isAtLeast(largeur, 6);
    }
  });
});

describe("renderTable — borné à la largeur, quoi qu'on lui donne", () => {
  it("⭐ aucune ligne ne déborde, de 40 à 200 colonnes", () => {
    for (const largeur of [40, 60, 80, 120, 200]) {
      for (const l of renderTable(routes, { width: largeur, color: false })) {
        assert.isAtMost(
          l.length,
          largeur,
          `ligne trop longue à ${largeur} : « ${l} »`,
        );
      }
    }
  });

  it("large, TOUTES les colonnes sont rendues", () => {
    const texte = renderTable(routes, { width: 200, color: false }).join("\n");
    for (const clé of Object.keys(routes[0] as TableRow)) {
      assert.include(texte, clé);
    }
    assert.notInclude(texte, "non affiché", "rien n'a été retiré");
  });

  it("🔴 étroit, ce qui ne DISTINGUE rien cède en premier", () => {
    // `host` et `bypassFirewall` portent la même valeur sur toutes les lignes :
    // ils coûtent leur largeur et ne séparent aucune ligne.
    const texte = renderTable(routes, { width: 80, color: false }).join("\n");
    assert.include(texte, "name", "l'identité de la ligne reste");
    assert.include(texte, "identique partout", "et ce qui a cédé est DIT");
    assert.include(texte, "host");
  });

  it("🔴 une colonne retirée faute de place est ANNONCÉE, avec sa porte", () => {
    const texte = renderTable(routes, { width: 46, color: false }).join("\n");
    assert.include(texte, "non affiché faute de place");
    assert.include(texte, "--json", "…et où la retrouver");
  });

  it("la PREMIÈRE colonne survit à tout — c'est l'identité de la ligne", () => {
    const lignes = renderTable(routes, { width: 30, color: false });
    assert.include(lignes.join("\n"), "name");
  });

  it("trop étroit pour un tableau : des FICHES, pas des colonnes d'une lettre", () => {
    const lignes = renderTable(routes, { width: 24, color: false });
    const texte = lignes.join("\n");
    assert.include(texte, "name");
    assert.include(texte, "path");
    for (const l of lignes) assert.isAtMost(l.length, 24);
  });

  it("aucune donnée : aucune ligne — surtout pas un tableau vide", () => {
    assert.deepStrictEqual(renderTable([], { width: 80, color: false }), []);
  });

  it("sans couleur, pas une seule séquence d'échappement", () => {
    const texte = renderTable(routes, { width: 80, color: false }).join("");
    assert.notInclude(texte, String.fromCharCode(27));
  });

  it("une clé absente d'une ligne rend une cellule vide, pas une erreur", () => {
    const lignes = renderTable([{ a: 1 }, { a: 2, b: "x" }], {
      width: 40,
      color: false,
    });
    assert.include(lignes.join("\n"), "b");
  });
});
