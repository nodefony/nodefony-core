import { expect } from "vitest";
import {
  SseLimitError,
  SseParser,
  type ISseEvent,
} from "../client/sse/SseParser";

/**
 * L'analyseur `text/event-stream` contre WHATWG HTML §9.2.5-9.2.6 — une règle de
 * la norme par cas. Copie hors ligne :
 * `.claude/skills/nodefony-framework-dev/references/rfc/specs/whatwg-sse.md`.
 */
function parse(chunks: string[], lastEventId = "") {
  const events: ISseEvent[] = [];
  const retries: number[] = [];
  const parser = new SseParser(
    {
      onEvent: (e) => events.push(e),
      onRetry: (ms) => retries.push(ms),
    },
    lastEventId,
  );
  for (const chunk of chunks) parser.push(chunk);
  return { events, retries, parser };
}

describe("SseParser — WHATWG HTML §9.2", () => {
  it("rend un événement par bloc clos d'une ligne vide, type message par défaut", () => {
    const { events } = parse(["data: un\n\ndata: deux\n\n"]);
    expect(events).to.deep.equal([
      { type: "message", data: "un", lastEventId: "" },
      { type: "message", data: "deux", lastEventId: "" },
    ]);
  });

  it("joint les champs data multiples par LF", () => {
    const { events } = parse(["data: a\ndata: b\ndata\n\n"]);
    expect(events[0]?.data).to.equal("a\nb\n");
  });

  it("retire UNE espace après les deux-points, pas davantage", () => {
    const { events } = parse(["data:  deux espaces\n\ndata:collé\n\n"]);
    expect(events.map((e) => e.data)).to.deep.equal([" deux espaces", "collé"]);
  });

  it("admet CRLF, CR et LF comme fins de ligne", () => {
    const { events } = parse(["data: a\r\n\r\ndata: b\r\rdata: c\n\n"]);
    expect(events.map((e) => e.data)).to.deep.equal(["a", "b", "c"]);
  });

  it("recolle un CRLF coupé entre deux morceaux sans inventer de ligne vide", () => {
    const { events } = parse(["data: a\r", "\ndata: b\r", "\n\r", "\n"]);
    expect(events).to.have.length(1);
    expect(events[0]?.data).to.equal("a\nb");
  });

  it("recolle une ligne et un champ coupés n'importe où", () => {
    const { events } = parse(["da", "ta: é", "té\nev", "ent: maj\n", "\n"]);
    expect(events).to.deep.equal([
      { type: "maj", data: "été", lastEventId: "" },
    ]);
  });

  it("ignore les commentaires, les champs inconnus et la casse différente", () => {
    const { events } = parse([": battement\nfoo: x\nData: y\ndata: z\n\n"]);
    expect(events).to.deep.equal([
      { type: "message", data: "z", lastEventId: "" },
    ]);
  });

  it("ne rend pas un bloc sans data, mais y retient l'identifiant", () => {
    const { events, parser } = parse(["id: 7\n\ndata: x\n\n"]);
    expect(parser.lastEventId).to.equal("7");
    expect(events).to.deep.equal([
      { type: "message", data: "x", lastEventId: "7" },
    ]);
  });

  it("un id vide remet l'identifiant à zéro ; un id contenant NUL est ignoré", () => {
    const { events } = parse([
      "id: 1\ndata: a\n\nid\ndata: b\n\nid: 2\u0000\ndata: c\n\n",
    ]);
    expect(events.map((e) => e.lastEventId)).to.deep.equal(["1", "", ""]);
  });

  it("retry n'accepte que des chiffres ASCII", () => {
    const { retries } = parse(["retry: 1500\nretry: 1e3\nretry: -1\n\n"]);
    expect(retries).to.deep.equal([1500]);
  });

  it("écarte le BOM en tête du flux, et lui seul", () => {
    const { events } = parse(["﻿data: a\n\n", "data: ﻿b\n\n"]);
    expect(events.map((e) => e.data)).to.deep.equal(["a", "﻿b"]);
  });

  it("jette un bloc inachevé à la fin du flux", () => {
    const { events, parser } = parse(["data: complet\n\ndata: coupé\n"]);
    parser.end();
    parser.push("\n");
    expect(events.map((e) => e.data)).to.deep.equal(["complet"]);
  });

  it("reprend l'identifiant connu avant le flux", () => {
    const { events } = parse(["data: suite\n\n"], "41");
    expect(events[0]?.lastEventId).to.equal("41");
  });

  it("lève SseLimitError sur une ligne sans fin au-delà de la borne", () => {
    const parser = new SseParser({ onEvent: () => undefined }, "", 16);
    parser.push("data: 0123456");
    expect(() => parser.push("789abcdefghij")).to.throw(SseLimitError);
  });

  it("lève SseLimitError quand les data d'un bloc cumulent au-delà de la borne", () => {
    const parser = new SseParser({ onEvent: () => undefined }, "", 16);
    parser.push("data: 0123456789\n");
    expect(() => parser.push("data: 0123456789\n")).to.throw(SseLimitError);
  });
});
