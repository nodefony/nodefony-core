/**
 * Équivalence du rendu du terminal du superviseur (#896) — sorties de
 * référence commitées.
 *
 * Les leviers de performance de #896 (largeur, repli, image, ligne d'état)
 * doivent rendre EXACTEMENT ce que rendait le code d'avant : mêmes colonnes,
 * mêmes coupes, mêmes lignes d'image et mêmes origines, mêmes octets émis
 * dans le même ordre. Ce test passe le corpus (`fixtures/terminalCorpus.ts`)
 * aux trois étages et compare à des fichiers de référence produits AVANT le
 * premier levier. Un écart est soit une régression, soit un changement de
 * rendu VOULU — qui se régénère alors dans le même commit, le diff du fichier
 * de référence le rendant lisible en revue.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandMark } from "../cli/brand";
import { fitToWidth, visibleWidth, wrapToWidth } from "../runtime/textWidth";
import { DevTerminal } from "../service/dev/DevTerminal";
import {
  diffFrame,
  renderFrame,
  type IFrame,
  type IFrameModel,
  type IFrameSize,
} from "../service/dev/devFrame";
import { DevTranscript } from "../service/dev/devTranscript";
import type { IStartupView } from "../service/dev/startupScreen";
import { StatusLine } from "../service/dev/statusLine";
import { TERMINAL_CORPUS, TERMINAL_WIDTHS } from "./fixtures/terminalCorpus";

const WIDE: IFrameSize = { columns: 120, rows: 40 };
const MEDIUM: IFrameSize = { columns: 40, rows: 12 };
const GOLDEN_DIR = path.join(import.meta.dirname, "fixtures", "golden");
const HEADER =
  "# Sortie de référence du terminal du superviseur (#896) — régénérer : npx vitest run terminalEquivalence -u (src/nodefony)\n";

const ctx = { project: "mon-app", readyAt: "16:48", reloads: 2 };
const readyView: IStartupView = {
  schema: 1,
  ready: true,
  durationMs: 1200,
  version: "10.0.0",
  environment: "development",
  open: [{ id: "app", label: "Application", url: "http://127.0.0.1:5151" }],
  notices: [],
  listening: [],
  frontend: null,
  modules: { loaded: 3, gated: [], failed: 0 },
  journal: { warnings: 1, errors: 0, criticals: [] },
  data: [],
  processes: null,
  firewall: null,
  supervised: true,
  inspector: null,
};

/** Une ligne du fichier de référence : clé, tabulation, valeur en JSON. */
const row = (key: string, value: unknown): string =>
  `${key}\t${JSON.stringify(value)}\n`;

function corpusTranscript(copies: number): DevTranscript {
  const t = new DevTranscript();
  for (let i = 0; i < copies; i++) {
    for (const line of Object.values(TERMINAL_CORPUS)) {
      t.ingest("server", "out", `${line}\n`);
    }
  }
  return t;
}

function frameModel(
  transcript: DevTranscript,
  patch: Partial<IFrameModel> = {},
): IFrameModel {
  return {
    transcript,
    anchor: null,
    status: { view: readyView, context: ctx, phase: "ready" },
    color: true,
    charset: "unicode",
    mark: brandMark("unicode", true),
    ...patch,
  };
}

function frameRows(name: string, frame: IFrame): string {
  let out = row(`${name}.cursor`, frame.cursor);
  frame.lines.forEach((line, i) => {
    out += row(`${name}.${i}`, [line, frame.origins?.[i] ?? null]);
  });
  return out;
}

/** Un flux qui consigne ce qu'on lui écrit, octets compris. */
function recorder(columns: number) {
  const written: string[] = [];
  return {
    columns,
    rows: 12,
    written,
    write(chunk: string | Uint8Array): boolean {
      written.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    },
    /** Ce qui a été émis depuis le dernier appel, concaténé. */
    take(): string {
      return written.splice(0).join("");
    },
  };
}

describe("terminal du superviseur — équivalence du rendu (#896)", () => {
  it("largeur : colonnes, coupe et repli identiques sur le corpus", async () => {
    let out = HEADER;
    for (const [name, line] of Object.entries(TERMINAL_CORPUS)) {
      out += row(`${name}.width`, visibleWidth(line));
      for (const w of TERMINAL_WIDTHS) {
        out += row(`${name}.fit${w}`, fitToWidth(line, w));
        out += row(`${name}.wrap${w}`, wrapToWidth(line, w));
      }
    }
    await expect(out).toMatchFileSnapshot(
      path.join(GOLDEN_DIR, "terminal-width.golden.txt"),
    );
  });

  it("image : lignes, origines et curseur identiques, en direct, remonté, sélectionné", async () => {
    const t = corpusTranscript(3);
    const first = t.lastSeq - t.length + 1;
    const sizes: Readonly<Record<string, IFrameSize>> = {
      wide: WIDE,
      medium: MEDIUM,
      narrow: { columns: 20, rows: 8 },
    };
    let out = HEADER;
    for (const [s, size] of Object.entries(sizes)) {
      out += frameRows(`live.${s}`, renderFrame(frameModel(t), size));
      out += frameRows(
        `nostatus.${s}`,
        renderFrame(frameModel(t, { status: null, color: false }), size),
      );
    }
    out += frameRows(
      "partial",
      renderFrame(
        frameModel(t, { partial: "en cours… 👍🏽 \x1b[33m50 %\x1b[0m" }),
        MEDIUM,
      ),
    );
    out += frameRows(
      "anchored",
      renderFrame(
        frameModel(t, {
          anchor: { seq: first + 30, below: 1 },
          selection: {
            start: { seq: first + 26, column: 3 },
            end: { seq: first + 29, column: 7 },
          },
        }),
        MEDIUM,
      ),
    );
    out += frameRows(
      "floor",
      renderFrame(frameModel(t, { floorSeq: t.lastSeq - 5 }), MEDIUM),
    );
    out += frameRows(
      "prompt",
      renderFrame(
        frameModel(t, {
          prompt: {
            lines: ["❯ inspect routes"],
            cursor: { row: 0, column: 16 },
          },
        }),
        MEDIUM,
      ),
    );
    // Le diff d'une image à la suivante, quand trois lignes arrivent en direct.
    const before = renderFrame(frameModel(t), WIDE);
    t.ingest(
      "server",
      "out",
      `${TERMINAL_CORPUS.sgr}\n${TERMINAL_CORPUS.emoji}\nfin\n`,
    );
    const after = renderFrame(frameModel(t), WIDE);
    diffFrame(before, after).forEach(({ row: r, text }) => {
      out += row(`diff.${r}`, text);
    });
    await expect(out).toMatchFileSnapshot(
      path.join(GOLDEN_DIR, "terminal-frame.golden.txt"),
    );
  });

  it("ligne d'état : mêmes octets, dans le même ordre", async () => {
    const stream = recorder(40);
    const bar = new StatusLine([stream]);
    let out = HEADER;
    bar.show(["barre ✅ 漢字", "\x1b[32mvert\x1b[0m " + "x".repeat(60)]);
    out += row("show", stream.take());
    stream.write("a\nb\n");
    out += row("lines", stream.take());
    stream.write("sans fin");
    out += row("partial", stream.take());
    stream.write("\n");
    out += row("newline", stream.take());
    stream.write(new TextEncoder().encode("octets 👍🏽\n"));
    out += row("bytes", stream.take());
    stream.write("");
    out += row("empty", stream.take());
    bar.show("une seule ligne");
    out += row("replace", stream.take());
    bar.hide();
    out += row("hide", stream.take());
    bar.release();
    out += row("release", stream.take());
    await expect(out).toMatchFileSnapshot(
      path.join(GOLDEN_DIR, "terminal-status-line.golden.txt"),
    );
  });

  it("surface inline : mêmes octets par paquet, barre affichée", async () => {
    const stdout = recorder(60);
    const terminal = new DevTerminal({
      stdout,
      color: true,
      charset: "unicode",
      mark: brandMark("unicode", true),
    });
    let out = HEADER;
    terminal.setStatus(readyView, ctx, "ready");
    out += row("ready", stdout.take());
    for (const [name, line] of Object.entries(TERMINAL_CORPUS)) {
      terminal.ingest("server", "out", Buffer.from(`${line}\n`));
      out += row(name, stdout.take());
    }
    terminal.ingest("server", "out", Buffer.from("début de "));
    out += row("partial", stdout.take());
    terminal.ingest("server", "out", Buffer.from("ligne\x1b[3"));
    out += row("cutSequence", stdout.take());
    terminal.ingest("server", "out", Buffer.from("2mvert\x1b[0m\n"));
    out += row("joined", stdout.take());
    terminal.ingest("server", "err", "erreur\n");
    out += row("stderr", stdout.take());
    terminal.close();
    out += row("close", stdout.take());
    await expect(out).toMatchFileSnapshot(
      path.join(GOLDEN_DIR, "terminal-inline.golden.txt"),
    );
  });
});
