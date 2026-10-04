/**
 * L'image du terminal de développement (`service/dev/devFrame.ts`) : trois
 * zones, repli en colonnes, fenêtre ancrée sur un `seq`, dessin différentiel.
 */
import { describe, it, expect } from "vitest";
import { brandMark } from "../cli/brand";
import { visibleWidth } from "../runtime/textWidth";
import {
  FrameHeights,
  diffFrame,
  renderFrame,
  type IFrameModel,
} from "../service/dev/devFrame";
import { DevTranscript } from "../service/dev/devTranscript";
import type { IStartupView } from "../service/dev/startupScreen";

const ctx = { project: "mon-app", readyAt: "16:48", reloads: 0 };

const startupView: IStartupView = {
  schema: 1,
  ready: true,
  durationMs: 1200,
  version: "10.0.0",
  environment: "development",
  open: [],
  notices: [],
  listening: [],
  frontend: null,
  modules: { loaded: 3, gated: [], failed: 0 },
  journal: { warnings: 0, errors: 0, criticals: [] },
  data: [],
  processes: null,
  firewall: null,
  supervised: true,
  inspector: null,
};

function transcriptOf(lines: string[], maxEntries?: number): DevTranscript {
  const t = new DevTranscript(maxEntries ? { maxEntries } : {});
  for (const l of lines) t.ingest("server", "out", `${l}\n`);
  return t;
}

function model(
  transcript: DevTranscript,
  patch: Partial<IFrameModel> = {},
): IFrameModel {
  return {
    transcript,
    anchor: null,
    status: { view: null, context: ctx, phase: "booting" },
    color: false,
    charset: "unicode",
    mark: brandMark("unicode", false),
    ...patch,
  };
}

const range = (n: number, from = 1): string[] =>
  Array.from({ length: n }, (_, i) => `l${i + from}`);

describe("renderFrame — zones", () => {
  it("en direct : exactement rows lignes, le journal suit la fin, la barre en bas", () => {
    const frame = renderFrame(model(transcriptOf(range(10))), {
      columns: 40,
      rows: 5,
    });
    expect(frame.lines).to.deep.equal([
      "l7",
      "l8",
      "l9",
      "l10",
      "mon-app · démarrage…",
    ]);
    expect(frame.cursor).to.equal(null);
  });

  it("historique court : complété par le haut", () => {
    const frame = renderFrame(model(transcriptOf(["a"]), { status: null }), {
      columns: 20,
      rows: 3,
    });
    expect(frame.lines).to.deep.equal(["", "", "a"]);
  });

  it("serveur prêt : la barre est le bloc d'état, ou sa ligne si la place manque", () => {
    const status = { view: startupView, context: ctx, phase: "ready" as const };
    const tall = renderFrame(model(transcriptOf(range(50)), { status }), {
      columns: 100,
      rows: 30,
    });
    // Le bloc : un filet puis la marque du logo.
    expect(tall.lines.at(-7)).to.equal("─".repeat(99));
    const short = renderFrame(model(transcriptOf(range(50)), { status }), {
      columns: 60,
      rows: 10,
    });
    // La ligne seule s'ouvre aussi sur son filet : elle ne doit jamais se
    // lire comme la suite du journal (même barre qu'en rendu inline).
    expect(short.lines.at(-1)).to.include("mon-app");
    expect(short.lines.at(-2)).to.equal("─".repeat(59));
    expect(short.lines.at(-3)).to.equal("l50");
  });

  it("l'invite se place entre journal et barre, le curseur dessus", () => {
    const frame = renderFrame(
      model(transcriptOf(range(10)), {
        prompt: { lines: ["❯ sta"], cursor: { row: 0, column: 5 } },
      }),
      { columns: 40, rows: 5 },
    );
    expect(frame.lines).to.deep.equal([
      "l8",
      "l9",
      "l10",
      "❯ sta",
      "mon-app · démarrage…",
    ]);
    expect(frame.cursor).to.deep.equal({ row: 3, column: 5 });
  });
});

describe("renderFrame — largeur", () => {
  it("ne rend JAMAIS une ligne plus large que columns - 1", () => {
    const hostile = [
      "漢字".repeat(60),
      "👍🏽".repeat(60),
      `\x1b[31m${"x".repeat(300)}\x1b[0m`,
      "é".repeat(200),
      "⚠️ ok",
      "",
    ];
    const status = { view: startupView, context: ctx, phase: "ready" as const };
    for (const columns of [2, 3, 10, 41, 72, 80, 133]) {
      for (const rows of [1, 4, 25]) {
        for (const s of [null, status]) {
          const frame = renderFrame(
            model(transcriptOf(hostile), { status: s }),
            { columns, rows },
          );
          expect(frame.lines).to.have.length(rows);
          for (const line of frame.lines) {
            expect(
              visibleWidth(line),
              `${columns}×${rows} : ${JSON.stringify(line)}`,
            ).to.be.at.most(columns - 1);
          }
        }
      }
    }
  });

  it("replie une ligne longue sans perdre de texte, et retire l'effacement de ligne", () => {
    const frame = renderFrame(
      model(transcriptOf(["\x1b[2Kabcdefghij"]), { status: null }),
      { columns: 5, rows: 3 },
    );
    expect(frame.lines).to.deep.equal(["abcd", "efgh", "ij"]);
  });
});

describe("renderFrame — fenêtre ancrée sur un seq", () => {
  it("ne glisse pas quand des lignes arrivent ; l'indicateur les compte", () => {
    const t = transcriptOf(range(20));
    const anchor = { seq: 10, below: 0 };
    const size = { columns: 40, rows: 4 };
    const before = renderFrame(model(t, { anchor, status: null }), size);
    expect(before.lines).to.deep.equal([
      "l8",
      "l9",
      "l10",
      "↑ 10 nouvelles lignes — Fin",
    ]);
    t.ingest("server", "out", "l21\nl22\n");
    const after = renderFrame(model(t, { anchor, status: null }), size);
    expect(after.lines).to.deep.equal([
      "l8",
      "l9",
      "l10",
      "↑ 12 nouvelles lignes — Fin",
    ]);
  });

  it("below cache les dernières lignes repliées de l'entrée d'ancrage", () => {
    const t = transcriptOf(["avant", "abcdefghij"]);
    const frame = renderFrame(
      model(t, { anchor: { seq: 2, below: 1 }, status: null }),
      { columns: 5, rows: 3 },
    );
    // « avant » se replie en « avan » + « t » ; « ij » est caché sous la fenêtre.
    expect(frame.lines).to.deep.equal(["t", "abcd", "efgh"]);
  });

  it("ancre évincée : la fenêtre montre le plus ancien encore retenu", () => {
    const t = transcriptOf(range(10), 5);
    const frame = renderFrame(
      model(t, { anchor: { seq: 2, below: 0 }, status: null }),
      { columns: 40, rows: 3 },
    );
    expect(frame.lines).to.deep.equal([
      "l6",
      "l7",
      "↑ 8 nouvelles lignes — Fin",
    ]);
  });

  it("jeu ASCII : l'indicateur n'emploie que de l'ASCII", () => {
    const t = transcriptOf(range(3));
    const frame = renderFrame(
      model(t, {
        anchor: { seq: 2, below: 0 },
        status: null,
        charset: "ascii",
      }),
      { columns: 40, rows: 2 },
    );
    expect(frame.lines.at(-1)).to.equal("^ 1 nouvelle ligne - Fin");
  });
});

describe("FrameHeights — mémoïsées par largeur", () => {
  it("une hauteur par entrée, invalidées au changement de largeur, élaguées après éviction", () => {
    const t = transcriptOf(["abcdefghij", "ab"]);
    const heights = new FrameHeights();
    const entry = t.at(0);
    if (!entry) throw new Error("entrée absente");
    expect(heights.height(entry, 4)).to.equal(3);
    expect(heights.height(entry, 4)).to.equal(3);
    expect(heights.size).to.equal(1);
    expect(heights.height(entry, 10)).to.equal(1);
    expect(heights.size).to.equal(1);
    renderFrame(model(t, { heights, status: null }), { columns: 5, rows: 4 });
    expect(heights.size).to.equal(2);
    heights.prune(2);
    expect(heights.size).to.equal(1);
  });
});

describe("diffFrame", () => {
  it("tout au premier dessin ou si la hauteur change, sinon les seules lignes changées", () => {
    const a = { lines: ["x", "y", "z"], cursor: null };
    const b = { lines: ["x", "Y", "z"], cursor: null };
    expect(diffFrame(null, a)).to.have.length(3);
    expect(diffFrame(a, b)).to.deep.equal([{ row: 1, text: "Y" }]);
    expect(diffFrame(a, a)).to.deep.equal([]);
    expect(diffFrame(a, { lines: ["x", "y"], cursor: null })).to.have.length(2);
  });
});
