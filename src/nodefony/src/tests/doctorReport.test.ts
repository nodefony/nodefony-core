import assert from "node:assert/strict";
import {
  divider,
  usableWidth,
  summaryLine,
  wrap,
  splitAction,
  stateSymbol,
} from "../kernel/checks/report";

/**
 * La forme du rapport de `doctor` — éprouvée parce qu'elle est PURE.
 *
 * Ces fonctions décident de ce qu'un humain voit en panne. Elles ne lisent ni
 * le terminal ni l'environnement : largeur et contenu leur sont donnés, et
 * c'est ce qui permet de les vérifier ailleurs que dans le terminal où elles
 * tournent — donc en intégration continue, où il n'y en a pas.
 */
describe("doctor — mise en forme du rapport", () => {
  it("la largeur est bornée des DEUX côtés", () => {
    // Un terminal très étroit fait chevaucher les colonnes ; un très large
    // envoie l'œil chercher le détail à l'autre bout de l'écran.
    assert.equal(usableWidth(20), 48);
    assert.equal(usableWidth(300), 96);
    assert.equal(usableWidth(80), 80);
    // Sortie redirigée : pas de terminal, donc pas de largeur annoncée.
    assert.equal(usableWidth(undefined), 80);
    assert.equal(usableWidth(Number.NaN), 80);
  });

  it("chaque état garde un SYMBOLE distinct, sans couleur", () => {
    // La couleur disparaît dans un journal de CI, dans un `| cat`, et pour qui
    // ne la distingue pas. Le symbole doit suffire à lire le verdict.
    const vus = new Set(
      (["ok", "echec", "avertissement", "non-controle"] as const).map(
        stateSymbol,
      ),
    );
    assert.equal(vus.size, 4, "deux états partagent le même symbole");
  });

  it("les lignes du sommaire s'alignent sur le titre le plus long", () => {
    const lignes = [
      { title: "Câblage", state: "ok" as const, detail: "55 classes" },
      {
        title: "Fraîcheur du build",
        state: "echec" as const,
        detail: "build en retard",
      },
    ];
    const largeurTitre = Math.max(...lignes.map((l) => l.title.length));
    const rendues = lignes.map((l) => summaryLine(l, largeurTitre, 80));
    // Le détail commence à la MÊME colonne sur les deux lignes.
    assert.equal(
      rendues[0]!.indexOf("55 classes"),
      rendues[1]!.indexOf("build en retard"),
    );
  });

  it("un détail trop long est coupé, jamais replié sur la marge", () => {
    const l = summaryLine(
      { title: "X", state: "ok", detail: "d".repeat(200) },
      1,
      60,
    );
    assert.ok(l.length <= 60, `ligne de ${l.length} colonnes sur 60`);
    assert.ok(l.endsWith("…"), "la troncature doit se VOIR");
  });

  it("🔴 le GESTE est séparé du constat — c'est ce qu'on cherche en panne", () => {
    const { finding: constat, action: geste } = splitAction(
      "des sources ont changé après le build. → `npm run build`",
    );
    assert.equal(geste, "`npm run build`");
    assert.ok(!constat.includes("→"));
    assert.ok(
      !constat.endsWith("."),
      "la ponctuation avant la flèche est ôtée",
    );
  });

  it("un message SANS geste reste intact", () => {
    // Ne pas inventer un geste là où le contrôle n'en propose pas : une
    // suggestion fabriquée est pire qu'un constat nu.
    const r = splitAction("le catalogue est illisible");
    assert.equal(r.finding, "le catalogue est illisible");
    assert.equal(r.action, undefined);
  });

  it("une flèche FINALE sans geste ne fabrique pas de ligne vide", () => {
    const r = splitAction("quelque chose ne va pas →");
    assert.equal(r.action, undefined);
    assert.ok(r.finding.length > 0);
  });

  it("le repli respecte la largeur ET l'indentation", () => {
    const lignes = wrap("mot ".repeat(40).trim(), 40, "     ");
    assert.ok(lignes.length > 1, "une phrase longue doit se replier");
    for (const l of lignes) {
      assert.ok(l.startsWith("     "), "chaque ligne porte l'indentation");
      assert.ok(l.length <= 40, `ligne de ${l.length} colonnes sur 40`);
    }
  });

  it("un mot plus long que la largeur ne fait pas boucler le repli", () => {
    // Un chemin absolu très long est le cas normal, pas l'exception.
    const lignes = wrap("/a/".padEnd(120, "b"), 40, "  ");
    assert.equal(lignes.length, 1);
  });

  it("le filet ne dépasse jamais la largeur", () => {
    assert.ok(divider(60).length <= 60);
    assert.ok(divider(10).length >= 10);
  });
});
