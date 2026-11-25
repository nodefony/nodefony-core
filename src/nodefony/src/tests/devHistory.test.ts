/**
 * L'historique par canal (`service/dev/devHistory.ts`) et ce qu'il exige de
 * l'anneau (`devTranscript.ts`) : numérotation commune, recherche par
 * dichotomie, fil fusionné, plafond global qui épargne le petit canal.
 */
import { describe, it, expect } from "vitest";
import { DevHistory } from "../service/dev/devHistory";
import { DevTranscript } from "../service/dev/devTranscript";

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
    expect(h.bytes).to.equal(before - Buffer.byteLength("réponse"));
    expect(h.drop("agent:1")).to.equal(false);
  });

  it("flush termine la ligne en cours d'un seul canal", () => {
    const h = new DevHistory();
    h.ingest("server", "out", "sans fin");
    h.ingest("vite:default", "out", "en cours");
    h.flush("server");
    expect(h.since(0).map((e) => e.text)).to.deep.equal(["sans fin"]);
    expect(h.channel("vite:default")?.partial("vite:default", "out")).to.equal(
      "en cours",
    );
  });
});

describe("DevHistory — plafond global", () => {
  const line = (c: string) => `${c.repeat(99)}\n`; // 99 octets retenus

  it("une rafale d'un canal n'évince jamais la pile d'un plus petit", () => {
    const h = new DevHistory({ maxBytes: 99 * 40 });
    for (let i = 0; i < 5; i++) h.ingest("server", "err", line("s"));
    for (let i = 0; i < 500; i++) h.ingest("vite:default", "out", line("v"));
    expect(h.bytes).to.be.at.most(99 * 40);
    expect(h.channel("server")?.length).to.equal(5);
    expect(h.channel("vite:default")?.length).to.equal(35);
  });

  it("le plafond tient quelle que soit la répartition entre canaux", () => {
    const h = new DevHistory({ maxBytes: 99 * 30 });
    for (let i = 0; i < 300; i++) h.ingest(`run:${i % 7}`, "out", line("r"));
    expect(h.bytes).to.equal(99 * 30);
    let sum = 0;
    for (const c of h.channels()) sum += h.channel(c)?.bytes ?? 0;
    expect(sum).to.equal(h.bytes);
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
