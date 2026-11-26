/**
 * Le panneau à rubriques (`service/dev/devPanel.ts`, #538 D9) : une donnée,
 * un rendu — éprouvé sans terminal.
 */
import { describe, expect, it } from "vitest";
import { visibleWidth } from "../runtime/textWidth";
import {
  PanelCursor,
  renderPanel,
  type IPanelSpec,
} from "../service/dev/devPanel";
import type { InputEvent } from "../service/dev/inputDecoder";

const plain = { color: false, charset: "unicode" } as const;

const key = (name: string): InputEvent => ({
  kind: "key",
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
});

function spec(lines = 3): IPanelSpec {
  return {
    id: "help",
    label: "aide",
    pages: [
      {
        title: "Invite",
        rows: [
          { kind: "heading", text: "Saisir" },
          { kind: "entry", key: "Entrée", value: "envoyer la saisie" },
          ...Array.from({ length: lines }, (_, i) => ({
            kind: "entry" as const,
            key: `k${i}`,
            value: `valeur ${i}`,
          })),
        ],
      },
      {
        title: "Onglets",
        rows: [{ kind: "text", text: "un paragraphe" }],
      },
      {
        title: "Serveur",
        rows: [
          {
            kind: "table",
            head: ["port", "état"],
            rows: [
              ["5151", "ouvert"],
              ["5152", "ouvert"],
            ],
          },
        ],
      },
    ],
  };
}

describe("renderPanel — le panneau dans son rectangle", () => {
  it("rend EXACTEMENT la hauteur demandée, aucune ligne plus large que le rectangle", () => {
    for (const [w, h] of [
      [80, 12],
      [20, 5],
      [8, 3],
    ] as const) {
      const lines = renderPanel(new PanelCursor(spec(40), plain), w, h);
      expect(lines).to.have.length(h);
      for (const line of lines) {
        expect(visibleWidth(line)).to.be.at.most(w);
      }
    }
  });

  it("ligne des rubriques, filet, corps, pied — la rubrique active en tête", () => {
    const lines = renderPanel(new PanelCursor(spec(), plain), 60, 10);
    expect(lines[0]).to.equal(" Invite   Onglets   Serveur ");
    expect(lines[1]).to.equal("─".repeat(60));
    expect(lines[2]).to.equal("Saisir");
    expect(lines[3]).to.equal("  Entrée  envoyer la saisie");
    expect(lines.at(-1)).to.equal("←→ rubrique · Échap fermer");
  });

  it("une valeur longue passe à la ligne SOUS sa colonne, jamais coupée", () => {
    const long: IPanelSpec = {
      id: "x",
      label: "x",
      pages: [
        {
          title: "P",
          rows: [{ kind: "entry", key: "clé", value: "a".repeat(30) }],
        },
      ],
    };
    const lines = renderPanel(new PanelCursor(long, plain), 20, 6);
    expect(lines[2]).to.equal(`  clé  ${"a".repeat(13)}`);
    expect(lines[3]).to.equal(`       ${"a".repeat(13)}`);
    expect(lines[4]).to.equal(`       ${"a".repeat(4)}`);
  });

  it("un tableau : en-tête, puis une ligne par rangée, colonnes alignées", () => {
    const cursor = new PanelCursor(spec(), plain);
    cursor.page = 2;
    const lines = renderPanel(cursor, 40, 8);
    expect(lines.slice(2, 5)).to.deep.equal([
      "  port  état",
      "  5151  ouvert",
      "  5152  ouvert",
    ]);
  });

  it("trop de rubriques pour la largeur : une fenêtre autour de l'active, bornée de ‹ +N et +N ›", () => {
    const many: IPanelSpec = {
      id: "m",
      label: "m",
      pages: Array.from({ length: 10 }, (_, i) => ({
        title: `Rubrique${i}`,
        rows: [],
      })),
    };
    const cursor = new PanelCursor(many, plain);
    cursor.page = 5;
    const [tabs] = renderPanel(cursor, 40, 4);
    expect(tabs).to.contain("‹ +");
    expect(tabs).to.contain(" Rubrique5 ");
    expect(tabs?.trimEnd().endsWith("›")).to.equal(true);
  });

  it("ASCII : ni filet ni flèches unicode", () => {
    const lines = renderPanel(
      new PanelCursor(spec(), { color: false, charset: "ascii" }),
      40,
      10,
    );
    expect(lines[1]).to.equal("-".repeat(40));
    expect(lines.at(-1)).to.equal("gauche droite rubrique · Échap fermer");
  });
});

describe("PanelCursor — les touches", () => {
  it("←→ changent de rubrique, bornés aux extrémités, et remettent le défilement en haut", () => {
    const cursor = new PanelCursor(spec(), plain);
    expect(cursor.handle(key("left"))).to.equal("handled");
    expect(cursor.page).to.equal(0);
    cursor.scroll = 4;
    cursor.handle(key("right"));
    expect([cursor.page, cursor.scroll]).to.deep.equal([1, 0]);
    cursor.handle(key("right"));
    cursor.handle(key("right"));
    expect(cursor.page).to.equal(2);
  });

  it("↓ défile, et l'image borne le défilement au corps : rien au-delà de la dernière ligne", () => {
    const cursor = new PanelCursor(spec(40), plain);
    for (let i = 0; i < 100; i++) cursor.handle(key("down"));
    const lines = renderPanel(cursor, 40, 10);
    // 42 lignes de corps, 7 visibles : la fenêtre s'arrête sur la dernière.
    expect(cursor.scroll).to.equal(42 - 7);
    expect(lines[8]).to.equal("  k39     valeur 39");
    expect(lines.at(-1)).to.contain("défiler (36–42 / 42)");
  });

  it("PgDn avance d'une hauteur de corps, Début revient en haut, Fin va au bas", () => {
    const cursor = new PanelCursor(spec(40), plain);
    renderPanel(cursor, 40, 10);
    cursor.handle(key("pagedown"));
    expect(cursor.scroll).to.equal(7);
    cursor.handle(key("home"));
    expect(cursor.scroll).to.equal(0);
    cursor.handle(key("end"));
    renderPanel(cursor, 40, 10);
    expect(cursor.scroll).to.equal(35);
  });

  it("la molette défile de trois lignes", () => {
    const cursor = new PanelCursor(spec(40), plain);
    cursor.handle({ kind: "wheel", direction: "down", column: 1, row: 1 });
    expect(cursor.scroll).to.equal(3);
  });

  it("Échap referme ; la frappe (`q` compris, elle va à l’invite) et Alt+flèche passent", () => {
    const cursor = new PanelCursor(spec(), plain);
    expect(cursor.handle(key("escape"))).to.equal("close");
    expect(cursor.handle({ kind: "text", text: "q" })).to.equal("pass");
    expect(cursor.handle({ kind: "text", text: "a" })).to.equal("pass");
    expect(
      cursor.handle({
        kind: "key",
        key: "right",
        ctrl: false,
        alt: true,
        shift: false,
      }),
    ).to.equal("pass");
  });

  it("le corps se calcule une fois par couple (rubrique, largeur)", () => {
    const cursor = new PanelCursor(spec(), plain);
    const first = cursor.body(40);
    expect(cursor.body(40)).to.equal(first);
    expect(cursor.body(41)).not.to.equal(first);
  });
});
