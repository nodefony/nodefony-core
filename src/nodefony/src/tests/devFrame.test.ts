/**
 * L'image du terminal de développement (`service/dev/devFrame.ts`) : trois
 * zones, repli en colonnes, fenêtre ancrée sur un `seq`, dessin différentiel.
 */
import { describe, it, expect } from "vitest";
import { brandMark } from "../cli/brand";
import { visibleWidth } from "../runtime/textWidth";
import {
  FrameHeights,
  frameJournalRows,
  diffFrame,
  renderFrame,
  scrollAnchor,
  topAnchor,
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

  it("historique court, en direct : la page s'écrit depuis le HAUT, comme dans un terminal", () => {
    const frame = renderFrame(model(transcriptOf(["a"]), { status: null }), {
      columns: 20,
      rows: 3,
    });
    expect(frame.lines).to.deep.equal(["a", "", ""]);
    expect(frame.origins?.map((o) => o !== null)).to.deep.equal([
      true,
      false,
      false,
    ]);
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

describe("scrollAnchor — défiler en lignes d'écran", () => {
  // 10 entrées, 5 lignes dont la barre : 4 lignes de journal en direct, 3
  // une fois remonté (l'indicateur prend la sienne).
  const size = { columns: 40, rows: 5 };
  const journalOf = (m: IFrameModel): readonly string[] =>
    renderFrame(m, size).lines.filter(
      (l) => /^l\d+$/.test(l) || l === "" || l.startsWith("aaaa"),
    );

  it("remonter d'une ligne ancre la fenêtre, redescendre d'une revient au direct", () => {
    const t = transcriptOf(range(10));
    const up = scrollAnchor(model(t), size, 1);
    expect(up).to.deep.equal({ seq: 9, below: 0 });
    expect(renderFrame(model(t, { anchor: up }), size).lines).to.deep.equal([
      "l7",
      "l8",
      "l9",
      "↑ 1 nouvelle ligne — Fin",
      "mon-app · démarrage…",
    ]);
    expect(scrollAnchor(model(t, { anchor: up }), size, -1)).to.equal(null);
  });

  it("borné en haut : la PREMIÈRE ligne de l'historique reste visible (Début)", () => {
    const t = transcriptOf(range(10));
    const top = scrollAnchor(model(t), size, 1000);
    expect(top).to.deep.equal(topAnchor(model(t), size));
    expect(journalOf(model(t, { anchor: top }))).to.deep.equal([
      "l1",
      "l2",
      "l3",
    ]);
    // Plus haut que le haut : rien ne bouge.
    expect(scrollAnchor(model(t, { anchor: top }), size, 5)).to.deep.equal(top);
  });

  it("redescendre au-delà du bas revient au direct", () => {
    const t = transcriptOf(range(10));
    const top = topAnchor(model(t), size);
    expect(scrollAnchor(model(t, { anchor: top }), size, -1000)).to.equal(null);
  });

  it("tout tient dans la fenêtre : rien à faire défiler", () => {
    const t = transcriptOf(range(2));
    expect(scrollAnchor(model(t), size, 3)).to.equal(null);
    expect(topAnchor(model(t), size)).to.equal(null);
  });

  it("une entrée repliée se parcourt ligne à ligne", () => {
    // 40 colonnes → 39 de repli : 100 « a » = 3 lignes d'écran.
    const t = transcriptOf([...range(6), "a".repeat(100)]);
    const one = scrollAnchor(model(t), size, 1);
    expect(one).to.deep.equal({ seq: 7, below: 1 });
    const two = scrollAnchor(model(t, { anchor: one }), size, 1);
    expect(two).to.deep.equal({ seq: 7, below: 2 });
    const three = scrollAnchor(model(t, { anchor: two }), size, 1);
    expect(three).to.deep.equal({ seq: 6, below: 0 });
  });

  it("remonté, des lignes qui arrivent ne déplacent PAS la fenêtre (rechargement à chaud)", () => {
    const t = transcriptOf(range(10));
    const anchor = scrollAnchor(model(t), size, 4);
    const before = journalOf(model(t, { anchor }));
    for (const l of range(50, 11)) t.ingest("server", "out", `${l}\n`);
    expect(journalOf(model(t, { anchor }))).to.deep.equal(before);
    expect(renderFrame(model(t, { anchor }), size).lines.at(-2)).to.equal(
      "↑ 54 nouvelles lignes — Fin",
    );
  });

  it("ancre évincée de l'historique : repart du haut", () => {
    const t = transcriptOf(range(10), 5);
    const evicted = { seq: 2, below: 0 };
    expect(scrollAnchor(model(t, { anchor: evicted }), size, 1)).to.deep.equal(
      topAnchor(model(t), size),
    );
  });
});

describe("floorSeq — la page propre d'ESC[2J", () => {
  const size = { columns: 40, rows: 5 };

  it("en direct, rien d'antérieur au plancher ne s'affiche", () => {
    const t = transcriptOf(range(10));
    const frame = renderFrame(model(t, { floorSeq: 8 }), size);
    // La page propre du serveur prêt part du haut — elle ne saute plus.
    expect(frame.lines).to.deep.equal([
      "l9",
      "l10",
      "",
      "",
      "mon-app · démarrage…",
    ]);
  });

  it("remonté, le plancher est dépassé comme l'historique d'un terminal", () => {
    const t = transcriptOf(range(10));
    const anchor = scrollAnchor(model(t, { floorSeq: 8 }), size, 1);
    expect(
      renderFrame(model(t, { floorSeq: 8, anchor }), size).lines.slice(0, 3),
    ).to.deep.equal(["l7", "l8", "l9"]);
  });
});

describe("frameJournalRows — la page de PgUp/PgDn", () => {
  it("la hauteur que l'image donne au journal", () => {
    const t = transcriptOf(range(10));
    expect(frameJournalRows(model(t), { columns: 40, rows: 5 })).to.equal(4);
    expect(
      frameJournalRows(model(t, { status: null }), { columns: 40, rows: 5 }),
    ).to.equal(5);
  });
});
