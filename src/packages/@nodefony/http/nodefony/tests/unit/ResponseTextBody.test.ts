/**
 * Corps texte — une chaîne reste une chaîne jusqu'à `res.end`. Node colle alors
 * en-têtes et corps en UNE écriture ; un Buffer l'oblige à un `writev` en deux
 * morceaux après une copie d'encodage. Le contrat public ne bouge pas : `body`
 * rend toujours des octets, `Content-Length` compte toujours des octets.
 */
import { expect } from "chai";
import HttpResponse from "../../src/context/http/Response";

function make() {
  const h: Record<string, string> = {};
  const ended: Array<[unknown, unknown]> = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    getHeader: (n: string) => h[n],
    setHeader: (n: string, v: string) => {
      h[n] = v;
    },
    removeHeader: (n: string) => {
      delete h[n];
    },
    end: (chunk: unknown, enc: unknown) => {
      ended.push([chunk, enc]);
    },
  };
  const context = {
    isRedirect: false,
    method: "GET",
    httpKernel: null,
    type: "http",
  };
  const r = new HttpResponse(res as never, context as never);
  return { r, h, ended };
}

describe("HttpResponse — corps texte écrit tel quel", () => {
  it("send(chaîne) : res.end reçoit la CHAÎNE, pas un Buffer", async () => {
    const { r, ended } = make();
    await r.send('{"ok":true}');
    expect(ended).to.have.length(1);
    expect(ended[0]![0]).to.equal('{"ok":true}');
    expect(ended[0]![1]).to.equal("utf-8");
  });

  it("setBody(objet) : sérialisé en JSON et écrit en texte", async () => {
    const { r, ended } = make();
    r.setBody({ a: 1 });
    await r.send();
    expect(ended[0]![0]).to.equal('{"a":1}');
  });

  it("body : rend toujours des octets (contrat public inchangé)", () => {
    const { r } = make();
    r.setBody("é");
    expect(Buffer.isBuffer(r.body)).to.equal(true);
    expect(r.body!.equals(Buffer.from("é"))).to.equal(true);
  });

  it("Content-Length compte les OCTETS du texte, pas ses caractères", () => {
    const { r, h } = make();
    r.setBody("é€");
    r.setLength();
    expect(h["content-length"]).to.equal(String(Buffer.byteLength("é€")));
  });

  it("encodage posé avec le texte : longueur et écriture le respectent", async () => {
    const { r, ended, h } = make();
    r.setBody("é", "latin1");
    r.setLength();
    await r.send();
    expect(h["content-length"]).to.equal("1");
    expect(ended[0]).to.deep.equal(["é", "latin1"]);
  });

  it("Buffer posé : écrit tel quel", async () => {
    const { r, ended } = make();
    const b = Buffer.from([1, 2, 3]);
    r.setBody(b);
    await r.send();
    expect(Buffer.isBuffer(ended[0]![0])).to.equal(true);
  });

  it("corps absent : un vide légal, jamais null", async () => {
    const { r, ended } = make();
    await r.send();
    expect(ended[0]![0]).to.equal("");
  });
});
