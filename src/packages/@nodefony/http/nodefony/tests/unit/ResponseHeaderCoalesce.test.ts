/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import HttpResponse from "../../src/context/http/Response.js";
import type HttpContext from "../../src/context/http/HttpContext.js";

/**
 * Une réponse unique part en UNE écriture sur la socket : en-têtes et corps
 * collés.
 *
 * Node ne colle les en-têtes au premier morceau du corps que pour l'encodage
 * `"utf8"` ou `"latin1"` EXACTEMENT (`OutgoingMessage._send`). Sous l'alias
 * `"utf-8"` — le défaut de la réponse — ils partaient en morceau séparé, et
 * `end()` vidait la socket par `writev` : deux morceaux par réponse. Mesuré au
 * profil comparé 404/200 : ~13 µs de `writev` sur chaque réponse d'erreur, que
 * le chemin du contrôleur (qui passe `"utf8"`) ne payait pas.
 *
 * Le décor est un VRAI serveur `node:http` : la règle à éprouver est celle de
 * Node, qu'aucun objet factice ne reproduirait.
 */
type Body = { value: unknown; encoding?: BufferEncoding };

const CASES: Record<string, Body> = {
  "/object": { value: { error: "Not Found", code: 404 } },
  "/text-default": { value: "hello" },
  "/text-utf-8": { value: "héllo", encoding: "utf-8" },
};

describe("HttpResponse.send() — en-têtes et corps en UNE écriture", () => {
  let server: http.Server;
  let port = 0;
  const writevCalls = new Map<string, number>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = CASES[req.url ?? ""];
      if (body === undefined) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const socket = res.socket as
        (http.ServerResponse["socket"] & { _writev?: unknown }) | null;
      const original = socket?._writev;
      if (socket && typeof original === "function") {
        socket._writev = function (this: unknown, ...args: unknown[]) {
          writevCalls.set(
            req.url ?? "",
            (writevCalls.get(req.url ?? "") ?? 0) + 1,
          );
          return Reflect.apply(original, this, args);
        };
      }
      const ctx = {
        type: "http",
        method: req.method,
        isRedirect: false,
        log: () => undefined,
      } as unknown as HttpContext;
      const response = new HttpResponse(res, ctx);
      response.setBody(body.value, body.encoding);
      // Réponse unique : `send` termine de façon SYNCHRONE (`end(corps)`).
      void response.send();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const fetchBody = async (path: string): Promise<string> => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.text();
  };

  it("corps objet (JSON, chemin des réponses d'erreur) : aucune écriture en deux morceaux", async () => {
    expect(await fetchBody("/object")).to.equal(
      '{"error":"Not Found","code":404}',
    );
    expect(writevCalls.get("/object") ?? 0).to.equal(0);
  });

  it("texte à l'encodage par défaut : aucune écriture en deux morceaux", async () => {
    expect(await fetchBody("/text-default")).to.equal("hello");
    expect(writevCalls.get("/text-default") ?? 0).to.equal(0);
  });

  it('texte demandé en "utf-8" (alias) : une écriture, octets UTF-8 intacts', async () => {
    expect(await fetchBody("/text-utf-8")).to.equal("héllo");
    expect(writevCalls.get("/text-utf-8") ?? 0).to.equal(0);
  });
});
