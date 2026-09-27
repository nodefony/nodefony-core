/**
 * `setLength` — le Content-Length DÉLIMITE le message (RFC 9112 §6.3) : une
 * valeur fausse n'est pas une imprécision, c'est une désynchronisation de la
 * connexion. Trois règles, citées de la RFC 9110 §8.6 et de la RFC 9112 §6.2 :
 *
 * - HEAD : Content-Length absent ou ÉGAL à celui du GET — jamais `0` quand le
 *   GET aurait un corps (le corps est rendu, Node l'écarte lui-même) ;
 * - OPTIONS / TRACE : ils portent un corps — la longueur réelle, sinon le corps
 *   écrit déborde sur la réponse suivante ;
 * - `Transfer-Encoding: chunked` : AUCUN Content-Length.
 */
import { expect } from "chai";
import HttpResponse from "../../src/context/http/Response";

function stub(
  method: string,
  statusCode = 200,
  headers: Record<string, string> = {},
) {
  const h: Record<string, string> = { ...headers };
  const s = {
    context: { method },
    statusCode,
    body: "",
    response: {
      headersSent: false,
      removeHeader: (name: string) => {
        delete h[name];
      },
    },
    getHeader: (name: string) => h[name],
    setHeader: (name: string, value: string) => {
      h[name] = value;
    },
  };
  return { s: s as unknown as HttpResponse, h };
}

const BODY = '{"ok":true,"é":1}';
const LEN = String(Buffer.byteLength(BODY));

describe("HttpResponse.setLength — Content-Length exact (RFC 9110 §8.6, RFC 9112 §6.2)", () => {
  it("GET : longueur réelle en octets", () => {
    const { s, h } = stub("GET");
    HttpResponse.prototype.setLength.call(s, BODY);
    expect(h["Content-Length"]).to.equal(LEN);
  });

  it("HEAD : la longueur qu'aurait eue le GET, jamais 0", () => {
    const { s, h } = stub("HEAD");
    HttpResponse.prototype.setLength.call(s, BODY);
    expect(h["Content-Length"]).to.equal(LEN);
  });

  for (const method of ["OPTIONS", "TRACE"]) {
    it(`${method} : longueur réelle du corps (il en porte un)`, () => {
      const { s, h } = stub(method, 405);
      HttpResponse.prototype.setLength.call(s, BODY);
      expect(h["Content-Length"]).to.equal(LEN);
    });
  }

  it("chunked : AUCUN Content-Length, même un posé avant", () => {
    const { s, h } = stub("GET", 200, {
      "Transfer-Encoding": "chunked",
      "Content-Length": "12",
    });
    HttpResponse.prototype.setLength.call(s, BODY);
    expect(h["Content-Length"]).to.equal(undefined);
  });

  it("204 : aucun Content-Length", () => {
    const { s, h } = stub("GET", 204);
    HttpResponse.prototype.setLength.call(s, BODY);
    expect(h["Content-Length"]).to.equal(undefined);
  });
});
