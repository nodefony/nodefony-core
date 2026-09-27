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
  // Clés en minuscules : c'est ce que `setHeader` pose sur la réponse native.
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const res = {
    headersSent: false,
    getHeader: (name: string) => h[name.toLowerCase()],
    setHeader: (name: string, value: string) => {
      h[name.toLowerCase()] = value;
    },
    removeHeader: (name: string) => {
      delete h[name.toLowerCase()];
    },
  };
  const s = new HttpResponse(
    res as never,
    { method, httpKernel: null, type: "http" } as never,
  );
  s.statusCode = statusCode;
  return { s, h };
}

const BODY = '{"ok":true,"é":1}';
const LEN = String(Buffer.byteLength(BODY));

describe("HttpResponse.setLength — Content-Length exact (RFC 9110 §8.6, RFC 9112 §6.2)", () => {
  it("GET : longueur réelle en octets", () => {
    const { s, h } = stub("GET");
    s.setLength(BODY);
    expect(h["content-length"]).to.equal(LEN);
  });

  it("HEAD : la longueur qu'aurait eue le GET, jamais 0", () => {
    const { s, h } = stub("HEAD");
    s.setLength(BODY);
    expect(h["content-length"]).to.equal(LEN);
  });

  for (const method of ["OPTIONS", "TRACE"]) {
    it(`${method} : longueur réelle du corps (il en porte un)`, () => {
      const { s, h } = stub(method, 405);
      s.setLength(BODY);
      expect(h["content-length"]).to.equal(LEN);
    });
  }

  it("chunked : AUCUN Content-Length, même un posé avant", () => {
    const { s, h } = stub("GET", 200, {
      "Transfer-Encoding": "chunked",
      "Content-Length": "12",
    });
    s.setLength(BODY);
    expect(h["content-length"]).to.equal(undefined);
  });

  it("204 : aucun Content-Length", () => {
    const { s, h } = stub("GET", 204);
    s.setLength(BODY);
    expect(h["content-length"]).to.equal(undefined);
  });
});
