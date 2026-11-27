/**
 * L'historique par canal (`service/dev/devHistory.ts`) et ce qu'il exige de
 * l'anneau (`devTranscript.ts`) : numérotation commune, recherche par
 * dichotomie, fil fusionné, plafond global qui épargne le petit canal.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import { DevHistory } from "../service/dev/devHistory";
import {
  DevTranscript,
  transcriptEntryCost,
} from "../service/dev/devTranscript";

/** Un anneau dont les numéros sautent : 10, 20, 30… */
function sparse(count: number): DevTranscript {
  let seq = 0;
  const t = new DevTranscript({ nextSeq: () => (seq += 10) });
  for (let i = 1; i <= count; i++) t.ingest("server", "out", `l${i}\n`);
  return t;
}

describe("DevTranscript — numéros qui ne se suivent pas", () => {
  it("indexOf trouve un numéro présent, rend -1 pour un numéro absent", () => {
    const t = sparse(50);
    expect(t.indexOf(10)).to.equal(0);
    expect(t.indexOf(260)).to.equal(25);
    expect(t.indexOf(500)).to.equal(49);
    for (const absent of [0, 5, 15, 255, 501, 9999]) {
      expect(t.indexOf(absent), `numéro ${absent}`).to.equal(-1);
    }
  });

  it("since reprend juste après un numéro, présent ou non", () => {
    const t = sparse(5);
    expect(t.since(20).map((e) => e.text)).to.deep.equal(["l3", "l4", "l5"]);
    expect(t.since(25).map((e) => e.text)).to.deep.equal(["l3", "l4", "l5"]);
    expect(t.since(0, 2).map((e) => e.text)).to.deep.equal(["l1", "l2"]);
    expect(t.since(50)).to.deep.equal([]);
  });

  it("countAfter compte des entrées, jamais un écart de numéros", () => {
    const t = sparse(5);
    expect(t.countAfter(30)).to.equal(2);
    expect(t.countAfter(0)).to.equal(5);
    expect(t.countAfter(50)).to.equal(0);
  });

  it("après éviction, la dichotomie part de la nouvelle tête", () => {
    let seq = 0;
    const t = new DevTranscript({ maxEntries: 3, nextSeq: () => (seq += 7) });
    for (let i = 1; i <= 10; i++) t.ingest("server", "out", `l${i}\n`);
    expect(t.since(0).map((e) => e.seq)).to.deep.equal([56, 63, 70]);
    expect(t.indexOf(49)).to.equal(-1);
    expect(t.indexOf(63)).to.equal(1);
    expect(t.lastSeq).to.equal(70);
  });
});

describe("DevHistory — un anneau par canal, une numérotation commune", () => {
  it("ouvre un canal au premier paquet, et pas avant", () => {
    const h = new DevHistory();
    expect(h.channels()).to.deep.equal([]);
    expect(h.channel("server")).to.equal(undefined);
    h.ingest("server", "out", "a\n");
    h.ingest("vite:default", "out", "b\n");
    expect(h.channels()).to.deep.equal(["server", "vite:default"]);
    expect(h.channel("server")?.length).to.equal(1);
  });

  it("les numéros sont globaux, chaque anneau ne garde que les siens", () => {
    const h = new DevHistory();
    h.ingest("server", "out", "s1\n");
    h.ingest("vite:default", "out", "v1\n");
    h.ingest("server", "out", "s2\n");
    expect(
      h
        .channel("server")
        ?.since(0)
        .map((e) => e.seq),
    ).to.deep.equal([1, 3]);
    expect(
      h
        .channel("vite:default")
        ?.since(0)
        .map((e) => e.seq),
    ).to.deep.equal([2]);
    expect(h.lastSeq).to.equal(3);
  });

  it("since rend le fil FUSIONNÉ, dans l'ordre des numéros, borné", () => {
    const h = new DevHistory();
    h.ingest("server", "out", "s1\n");
    h.ingest("vite:default", "out", "v1\nv2\n");
    h.ingest("run:1", "out", "❯ status\n");
    h.ingest("server", "out", "s2\n");
    expect(
      h.since(0).map((e) => `${e.seq}:${e.channel}:${e.text}`),
    ).to.deep.equal([
      "1:server:s1",
      "2:vite:default:v1",
      "3:vite:default:v2",
      "4:run:1:❯ status",
      "5:server:s2",
    ]);
    expect(h.since(2, 2).map((e) => e.seq)).to.deep.equal([3, 4]);
    expect(h.since(5)).to.deep.equal([]);
  });

  it("un ESC[2J est signalé avec le canal qui l'a écrit", () => {
    const cleared: string[] = [];
    const h = new DevHistory({ onClear: (c) => cleared.push(c) });
    h.ingest("vite:default", "out", "\x1b[2Jprêt\n");
    expect(cleared).to.deep.equal(["vite:default"]);
  });

  it("drop ferme un canal et rend ses octets au plafond global", () => {
    const h = new DevHistory();
    h.ingest("agent:1", "out", "réponse\n");
    h.ingest("server", "out", "ok\n");
    const before = h.bytes;
    expect(h.drop("agent:1")).to.equal(true);
    expect(h.channel("agent:1")).to.equal(undefined);
    expect(h.bytes).to.equal(before - transcriptEntryCost("réponse"));
    expect(h.drop("agent:1")).to.equal(false);
  });

  it("flush termine la ligne en cours d'un seul canal", () => {
    const h = new DevHistory();
    h.ingest("server", "out", "sans fin");
    h.ingest("vite:default", "out", "en cours");
    h.flush("server");
    expect(h.since(0).map((e) => e.text)).to.deep.equal(["sans fin"]);
    expect(h.channel("vite:default")?.partial("vite:default")).to.equal(
      "en cours",
    );
  });
});

describe("DevHistory — plafond global", () => {
  const line = (c: string) => `${c.repeat(99)}\n`;
  const cost = transcriptEntryCost("s".repeat(99)); // mémoire d'une ligne retenue

  it("une rafale d'un canal n'évince jamais la pile d'un plus petit", () => {
    const h = new DevHistory({ maxBytes: cost * 40 });
    for (let i = 0; i < 5; i++) h.ingest("server", "err", line("s"));
    for (let i = 0; i < 500; i++) h.ingest("vite:default", "out", line("v"));
    expect(h.bytes).to.be.at.most(cost * 40);
    expect(h.channel("server")?.length).to.equal(5);
    expect(h.channel("vite:default")?.length).to.equal(35);
  });

  it("le plafond tient quelle que soit la répartition entre canaux", () => {
    const h = new DevHistory({ maxBytes: cost * 30 });
    for (let i = 0; i < 300; i++) h.ingest(`run:${i % 7}`, "out", line("r"));
    expect(h.bytes).to.equal(cost * 30);
    let sum = 0;
    for (const c of h.channels()) sum += h.channel(c)?.bytes ?? 0;
    expect(sum).to.equal(h.bytes);
  });

  // Compter les octets UTF-8 du texte laissait passer la mémoire de l'objet,
  // de la chaîne et de la case : 100 000 lignes courtes sur dix canaux
  // retenaient huit fois le plafond (mesuré : 16 Mo pour 2 Mo comptés).
  it("le plafond borne la MÉMOIRE réellement retenue, lignes courtes sur dix canaux", () => {
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    const heap = (): number => {
      gc();
      gc();
      return process.memoryUsage().heapUsed;
    };
    const cap = 1024 * 1024;
    const h = new DevHistory({ maxBytes: cap });
    const before = heap();
    for (let i = 0; i < 100_000; i++) {
      h.ingest(
        `run:${i % 10}`,
        "out",
        `ligne ${String(i).padStart(12, "0")}\n`,
      );
    }
    const retained = heap() - before;
    expect(h.bytes).to.be.at.most(cap);
    expect(retained, `${retained} octets retenus`).to.be.below(2 * cap);
  });

  it("un onClear qui vide l'historique ne fausse pas le compteur", () => {
    const h: DevHistory = new DevHistory({ onClear: () => h.clear() });
    h.ingest("server", "out", "avant\n");
    // Le canal qui efface portait déjà une ligne : son delta, pris avant
    // l'effacement, rendrait le compteur faux (négatif dans le cas mesuré).
    h.ingest("vite:default", "out", "déjà là\n");
    h.ingest("vite:default", "out", "x\x1b[2Jy\n");
    let sum = 0;
    for (const c of h.channels()) sum += h.channel(c)?.bytes ?? 0;
    expect(h.bytes).to.equal(sum);
    expect(h.bytes).to.be.above(0);
  });

  it("le plafond par canal tient sous le plafond global", () => {
    const h = new DevHistory({ channel: { maxEntries: 4 } });
    for (let i = 0; i < 10; i++) h.ingest("server", "out", `l${i}\n`);
    expect(
      h
        .channel("server")
        ?.since(0)
        .map((e) => e.text),
    ).to.deep.equal(["l6", "l7", "l8", "l9"]);
    expect(h.bytes).to.equal(h.channel("server")?.bytes);
  });
});

describe("MergedTranscript — plusieurs canaux lus comme UN historique", () => {
  /** Générateur pseudo-aléatoire à graine (mulberry32) : un échec se rejoue. */
  function random(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const CHANNELS = ["server", "supervisor", "vite:default", "vite:admin"];

  /** Le même flux versé dans l'anneau unique d'avant et dans l'historique par canal. */
  function twin(seed: number, packets: number) {
    const next = random(seed);
    const now = () => 0;
    const single = new DevTranscript({ now });
    const history = new DevHistory({ now });
    for (let p = 0; p < packets; p++) {
      const channel =
        CHANNELS[Math.floor(next() * CHANNELS.length)] ?? "server";
      const stream = next() < 0.2 ? "err" : "out";
      // Fragments sans fin de ligne compris : la ligne en cours est par canal.
      const chunk =
        next() < 0.3 ? `frag${p}` : `l${p}\n${next() < 0.3 ? "x\n" : ""}`;
      single.ingest(channel, stream, chunk);
      history.ingest(channel, stream, chunk);
    }
    return { single, history, next };
  }

  it("mêmes entrées, mêmes numéros, mêmes positions que l'anneau unique d'avant", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const { single, history } = twin(seed, 400);
      const merged = history.merge(() => true);
      expect(merged.length, `graine ${seed}`).to.equal(single.length);
      expect(merged.lastSeq).to.equal(single.lastSeq);
      for (let i = 0; i < single.length; i++) {
        expect(merged.at(i)).to.deep.equal(single.at(i));
      }
      for (let i = single.length - 1; i >= 0; i--) {
        expect(merged.at(i)).to.deep.equal(single.at(i));
      }
      expect(merged.at(-1)).to.deep.equal(single.at(-1));
      expect(merged.at(single.length)).to.equal(undefined);
    }
  });

  it("accès dans le désordre, indexOf et countAfter : le curseur ne dérive jamais", () => {
    const { single, history, next } = twin(99, 300);
    const merged = history.merge(() => true);
    for (let k = 0; k < 500; k++) {
      const i = Math.floor(next() * single.length);
      expect(merged.at(i), `position ${i}`).to.deep.equal(single.at(i));
      const seq = single.at(i)?.seq ?? 0;
      expect(merged.indexOf(seq)).to.equal(i);
      expect(merged.at(i + 1)).to.deep.equal(single.at(i + 1));
      expect(merged.countAfter(seq)).to.equal(single.countAfter(seq));
    }
    expect(merged.indexOf(0)).to.equal(-1);
    expect(merged.indexOf(single.lastSeq + 1)).to.equal(-1);
  });

  it("indexOf SAUTE le curseur sur l'ancre : les voisins se lisent depuis elle", () => {
    const { single, history, next } = twin(5, 300);
    const merged = history.merge(() => true);
    for (let k = 0; k < 200; k++) {
      const i = 1 + Math.floor(next() * (single.length - 2));
      merged.at(Math.floor(next() * single.length)); // curseur ailleurs
      expect(merged.indexOf(single.at(i)?.seq ?? 0)).to.equal(i);
      expect(merged.at(i - 1), `avant ${i}`).to.deep.equal(single.at(i - 1));
      merged.indexOf(single.at(i)?.seq ?? 0);
      expect(merged.at(i + 1), `après ${i}`).to.deep.equal(single.at(i + 1));
    }
  });

  it("une écriture périme le curseur : la lecture suivante voit la nouvelle entrée", () => {
    const history = new DevHistory();
    const merged = history.merge(() => true);
    history.ingest("server", "out", "a\n");
    expect(merged.at(-1)?.text).to.equal("a");
    history.ingest("vite:default", "out", "b\n");
    expect(merged.at(-1)?.text).to.equal("b");
    expect(merged.length).to.equal(2);
  });

  it("ne lit que les canaux retenus, y compris ceux ouverts après lui", () => {
    const history = new DevHistory();
    const vite = history.merge((c) => c.startsWith("vite:"));
    history.ingest("server", "out", "s\n");
    history.ingest("vite:default", "out", "v1\n");
    history.ingest("vite:admin", "out", "v2\n");
    expect([0, 1].map((i) => vite.at(i)?.text)).to.deep.equal(["v1", "v2"]);
    expect(vite.indexOf(1)).to.equal(-1); // « s » n'est pas dans la vue
    history.drop("vite:admin");
    expect(vite.length).to.equal(1);
  });
});
