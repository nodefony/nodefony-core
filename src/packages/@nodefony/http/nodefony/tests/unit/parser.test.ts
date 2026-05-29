/// <reference types="node" />
import { expect } from "chai";
import { EventEmitter } from "node:events";
import {
  Parser,
  ParserQs,
  ParserXml,
  acceptParser,
} from "../../src/context/http/parser.js";
import type HttpRequest from "../../src/context/http/Request.js";

// Stub minimal d'une HttpRequest : le flux `request.request` est un EventEmitter
// (le Parser y attache .on("data")), + les champs lus par les parsers concrets.
function makeReq(): { req: HttpRequest; stream: EventEmitter } {
  const stream = new EventEmitter();
  const req = {
    request: stream,
    data: Buffer.alloc(0),
    query: {},
    queryPost: {},
    queryStringOptions: {},
    charset: "utf8",
    context: { requestEnded: false },
  } as unknown as HttpRequest;
  return { req, stream };
}

// Négociation de contenu — parsing du header `Accept` (RFC 9110 §12.5.1).
// acceptParser(str) → tableau d'entrées { type: RegExp, subtype: RegExp, q?, … }
// trié par qualité `q` décroissante. Fonction pure (string → tableau).
describe("acceptParser — négociation de contenu (Accept header)", () => {
  it("sans argument → wildcard par défaut */*", () => {
    const r = acceptParser();
    expect(r).to.have.length(1);
    expect(r[0].type.test("text")).to.equal(true);
    expect(r[0].subtype.test("html")).to.equal(true);
  });

  it("type/subtype concret → regex correspondantes", () => {
    const r = acceptParser("text/html");
    expect(r[0].type.test("text")).to.equal(true);
    expect(r[0].subtype.test("html")).to.equal(true);
    expect(r[0].type.test("image")).to.equal(false);
  });

  it("'*/*' → wildcards qui matchent tout", () => {
    const r = acceptParser("*/*");
    expect(r[0].type.test("anything")).to.equal(true);
    expect(r[0].subtype.test("anything")).to.equal(true);
  });

  it("type wildcardé 'image/*'", () => {
    const r = acceptParser("image/*");
    expect(r[0].type.test("image")).to.equal(true);
    expect(r[0].subtype.test("png")).to.equal(true);
  });

  it("liste multiple → un objet par type", () => {
    const r = acceptParser("text/html,application/json");
    expect(r).to.have.length(2);
  });

  it("trie par q décroissant (qualité)", () => {
    const r = acceptParser("text/html;q=0.3,application/json;q=0.9");
    expect(r[0].subtype.test("json")).to.equal(true);
    expect(r[1].subtype.test("html")).to.equal(true);
    expect(r[0].q).to.equal(0.9);
  });

  it("q par défaut = 1 quand absent (passe avant un q explicite < 1)", () => {
    const r = acceptParser("text/html,application/json;q=0.5");
    expect(r[0].subtype.test("html")).to.equal(true);
  });

  it("parse les paramètres additionnels (charset)", () => {
    const r = acceptParser("text/html;charset=utf-8");
    expect(r[0].charset).to.equal("utf-8");
  });

  it("throw si un type est vide (media-range manquant)", () => {
    expect(() => acceptParser(";q=1")).to.throw();
  });
});

describe("Parser — accumulation des chunks de corps", () => {
  it("concatène les chunks 'data' dans request.data", async () => {
    const { req, stream } = makeReq();
    const p = new Parser(req);
    stream.emit("data", Buffer.from("hel"));
    stream.emit("data", Buffer.from("lo"));
    await p.parse();
    expect(req.data.toString()).to.equal("hello");
  });
});

describe("ParserQs — corps application/x-www-form-urlencoded", () => {
  it("parse le corps urlencoded dans queryPost + fusionne dans query", async () => {
    const { req, stream } = makeReq();
    const p = new ParserQs(req);
    stream.emit("data", Buffer.from("a=1&b=2"));
    await p.parse();
    expect(req.queryPost).to.deep.equal({ a: "1", b: "2" });
    expect(req.query).to.deep.equal({ a: "1", b: "2" });
    expect(req.context.requestEnded).to.equal(true);
  });

  it("supporte les structures imbriquées (qs)", async () => {
    const { req, stream } = makeReq();
    const p = new ParserQs(req);
    stream.emit("data", Buffer.from("user[name]=bob&user[age]=3"));
    await p.parse();
    expect(req.queryPost).to.deep.equal({
      user: { name: "bob", age: "3" },
    });
  });
});

describe("ParserXml — corps application/xml", () => {
  it("parse le XML dans queryPost", async () => {
    const { req, stream } = makeReq();
    const p = new ParserXml(req);
    stream.emit("data", Buffer.from("<root><a>1</a></root>"));
    await p.parse();
    expect(req.queryPost).to.have.property("root");
    expect(req.context.requestEnded).to.equal(true);
  });

  it("rejette un XML malformé", async () => {
    const { req, stream } = makeReq();
    const p = new ParserXml(req);
    stream.emit("data", Buffer.from("<root><a>1</root>"));
    let threw = false;
    try {
      await p.parse();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});
