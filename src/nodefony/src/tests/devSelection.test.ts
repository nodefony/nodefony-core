/**
 * La sélection à la souris du plein écran (`service/dev/devSelection.ts`) :
 * cellules de l'historique, jamais d'écran — et le texte copié vient des
 * entrées.
 */
import { describe, expect, it } from "vitest";
import {
  extractSelection,
  lineZones,
  selectionRange,
  sliceColumns,
  wordBounds,
  zoneAt,
  type ISelection,
  type ISelectionReader,
} from "../service/dev/devSelection";
import type { ITranscriptEntry } from "../service/dev/devTranscript";

/** Un historique factice : `seq` à partir de `first`. */
function reader(texts: readonly string[], first = 1): ISelectionReader {
  const entries: ITranscriptEntry[] = texts.map((text, i) => ({
    seq: first + i,
    source: "server",
    stream: "out",
    text,
    at: 0,
  }));
  return {
    length: entries.length,
    at: (index) => entries[index],
    indexOf: (seq) => entries.findIndex((e) => e.seq === seq),
  };
}

const sel = (
  anchor: [number, number],
  head: [number, number],
  unit: ISelection["unit"] = "char",
): ISelection => ({
  anchor: { seq: anchor[0], column: anchor[1] },
  head: { seq: head[0], column: head[1] },
  unit,
});

function copied(texts: readonly string[], selection: ISelection): string {
  const r = reader(texts);
  const range = selectionRange(selection, r);
  return range === null ? "" : extractSelection(r, range);
}

describe("sélection — caractères", () => {
  it("de la cellule enfoncée à la cellule de tête INCLUSE, dans les deux sens", () => {
    expect(copied(["bonjour le monde"], sel([1, 3], [1, 6]))).to.equal("jour");
    expect(copied(["bonjour le monde"], sel([1, 6], [1, 3]))).to.equal("jour");
  });

  it("sur plusieurs entrées : fin de la première, entières au milieu, début de la dernière", () => {
    expect(
      copied(["alpha beta", "gamma", "delta epsilon"], sel([1, 6], [3, 4])),
    ).to.equal("beta\ngamma\ndelta");
  });

  it("couleurs et hyperliens retirés, espaces de fin coupés", () => {
    const line =
      "\x1b[31mERR\x1b[0m voir \x1b]8;;https://x.dev\x1b\\lien\x1b]8;;\x1b\\   ";
    expect(copied([line, "suite"], sel([1, 0], [2, 4]))).to.equal(
      "ERR voir lien\nsuite",
    );
  });

  it("une entrée évincée pendant la sélection est sautée, la suite reste copiée", () => {
    const r = reader(["c", "d"], 3); // 1 et 2 évincées
    const range = selectionRange(sel([1, 0], [4, 0]), r);
    expect(range).to.not.equal(null);
    expect(extractSelection(r, range!)).to.equal("c\nd");
  });

  it("un caractère large à moitié couvert est pris entier", () => {
    // « 漢 » occupe les colonnes 1 et 2 ; la colonne 2 seule le sélectionne.
    expect(sliceColumns("a漢b", 2, 3)).to.equal("漢");
    expect(copied(["a漢b"], sel([1, 2], [1, 3]))).to.equal("漢b");
  });
});

describe("sélection — mot (double clic) et ligne (triple clic)", () => {
  it("un chemin avec sa ligne et sa colonne, une URL : un seul mot", () => {
    const line = "at src/service/dev/a.ts:12:3 (https://x.dev/?a=1&b=2)";
    expect(copied([line], sel([1, 8], [1, 8], "word"))).to.equal(
      "src/service/dev/a.ts:12:3",
    );
    expect(copied([line], sel([1, 35], [1, 35], "word"))).to.equal(
      "https://x.dev/?a=1&b=2",
    );
  });

  it("un double clic sur une espace ne prend qu'elle ; au-delà de la ligne, rien", () => {
    expect(wordBounds("a  b", 1)).to.deep.equal([1, 2]);
    expect(wordBounds("ab", 10)).to.deep.equal([10, 10]);
    expect(copied(["ab"], sel([1, 10], [1, 10], "word"))).to.equal("");
  });

  it("glisser après un double clic étend mot par mot", () => {
    expect(
      copied(["un deux trois quatre"], sel([1, 4], [1, 10], "word")),
    ).to.equal("deux trois");
  });

  it("triple clic : la ligne logique ENTIÈRE, même repliée à l'écran", () => {
    const long = "x".repeat(300);
    expect(
      copied(["avant", long, "après"], sel([2, 0], [2, 0], "line")),
    ).to.equal(long);
  });
});

describe("lineZones / zoneAt — ce qu'un clic vise dans la barre", () => {
  it("une adresse en clair, couleurs comprises : ses colonnes VISIBLES", () => {
    const text =
      "\x1b[32m➜\x1b[0m \x1b[36mhttp://127.0.0.1:5151\x1b[0m · Studio https://127.0.0.1:5152/nodefony";
    const zones = lineZones(text);
    expect(zones.map((z) => [z.value, z.start, z.end, z.truncated])).toEqual([
      ["http://127.0.0.1:5151", 2, 23, false],
      ["https://127.0.0.1:5152/nodefony", 33, 64, false],
    ]);
    expect(zoneAt(text, 2)?.value).toBe("http://127.0.0.1:5151");
    expect(zoneAt(text, 22)?.value).toBe("http://127.0.0.1:5151");
    expect(zoneAt(text, 23)).toBeNull();
    expect(zoneAt(text, 0)).toBeNull();
  });

  it("un caractère LARGE avant l'adresse décale ses colonnes de deux", () => {
    const zones = lineZones("界 http://a.dev");
    expect(zones[0]).toMatchObject({
      value: "http://a.dev",
      start: 3,
      end: 15,
    });
  });

  it("la ponctuation de phrase ne fait pas partie de l'adresse", () => {
    expect(lineZones("voir (http://a.dev/x).")[0]?.value).toBe(
      "http://a.dev/x",
    );
  });

  it("une adresse RACCOURCIE à l'écran est signalée — jamais copiée fausse", () => {
    const zone = lineZones("➜ http://127.0.0.1:51…")[0];
    expect(zone?.truncated).toBe(true);
  });

  it("un lien OSC 8 : sa CIBLE fait foi, même quand le texte affiché est raccourci", () => {
    const text =
      "Studio \x1b]8;;https://exemple.dev/un/long/chemin\x1b\\https://exemple.dev/u…\x1b]8;;\x1b\\ fin";
    const zones = lineZones(text);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      value: "https://exemple.dev/un/long/chemin",
      start: 7,
      end: 29,
      truncated: false,
    });
  });

  it("sans adresse, rien n'est cliquable", () => {
    expect(lineZones("nodefony · prêt · ctrl+c arrêter")).toEqual([]);
  });
});
