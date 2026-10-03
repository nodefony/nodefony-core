/// <reference types="node" />
import { expect } from "vitest";
import type http from "node:http";
import { describe, it } from "vitest";
import HttpRequest from "../../src/context/http/Request.js";
import type HttpContext from "../../src/context/http/HttpContext.js";
import { isCanonicalAuthority } from "../../src/context/http/urlFastPath.js";

/**
 * #508 — le nom d'hôte brut est découpé UNE fois au ctor et relu par
 * `getHostName()` / `getDomain()`. L'oracle est le comportement d'AVANT :
 * `#url?.hostname`, sinon `host.split(":")[0]` sur l'en-tête RELU à chaque appel.
 * Le cache ne doit jamais servir une valeur que l'ancien code n'aurait pas rendue
 * — sauf le littéral IPv6, que l'ancien découpage réduisait à `[` : l'oracle y
 * suit `URL.hostname`, la sémantique du WebSocket et du proxy inverse.
 */

function makeRequest(host: string | undefined, url = "/p"): HttpRequest {
  const headers: Record<string, string> = {};
  if (host !== undefined) headers.host = host;
  const nodeReq = {
    headers,
    url,
    method: "GET",
    socket: { remoteAddress: "192.0.2.1", encrypted: false },
  } as unknown as http.IncomingMessage;
  const context = { httpKernel: null, type: "http", log: () => undefined };
  return new HttpRequest(nodeReq, context as unknown as HttpContext);
}

const rawSplit = (host: string | undefined): string => {
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0] ?? "";
};

// Ce que rendait l'ancien `getDomain()` juste après le ctor : l'URL n'est
// construite QUE hors fast-path.
function oracleDomain(host: string | undefined): string {
  if (host && isCanonicalAuthority(host, "http")) return rawSplit(host);
  return new URL(`http://${host}/p`).hostname || rawSplit(host);
}

const HOSTS = [
  "127.0.0.1:5151",
  "127.0.0.1",
  "localhost",
  "localhost:5151",
  "example.com",
  "web-1.example.io:8080",
  "Example.COM:81", // hors fast-path : WHATWG met en minuscules
  "127.1", // hors fast-path : WHATWG normalise en 127.0.0.1
  "[::1]:5151", // IPv6 : crochets gardés, comme `URL.hostname` (et non « [ »)
  "example.com:80", // port par défaut élidé par WHATWG
];
// Autorités que `new URL` refuse : le ctor lève, avant comme après.
const THROWING = ["a.b.c:1:2", "[::1"];

describe("HttpRequest — nom d'hôte découpé une fois (#508)", () => {
  for (const host of HOSTS) {
    it(`« ${host} » : hostname, domain et getHostName identiques à l'ancien calcul`, () => {
      const req = makeRequest(host);
      // l'argument explicite est découpé, jamais servi par le cache — lu AVANT
      // tout accès à `req.url`, dont le getter construit l'URL.
      const slow = !isCanonicalAuthority(host, "http");
      expect(req.getHostName("autre.test:9")).to.equal(
        slow ? oracleDomain(host) : "autre.test",
      );
      expect(req.hostname).to.equal(rawSplit(host));
      expect(req.domain).to.equal(oracleDomain(host));
      expect(req.getHostName()).to.equal(oracleDomain(host));
      expect(req.getDomain()).to.equal(oracleDomain(host));
    });
  }

  for (const host of THROWING) {
    it(`« ${host} » : le ctor lève, comme avant`, () => {
      expect(() => makeRequest(host)).to.throw();
    });
  }

  it("sans en-tête Host : hostname vide, getHostName vide hors URL construite", () => {
    // `http://undefined/p` est une URL valide : le ctor ne lève pas, et comme
    // `undefined` n'est pas une autorité canonique, l'URL est construite.
    const req = makeRequest(undefined);
    expect(req.hostname).to.equal("");
    expect(req.domain).to.equal("undefined");
  });

  it("setUrl réécrit l'hôte : getHostName suit l'URL, pas le cache", () => {
    const req = makeRequest("127.0.0.1:5151");
    expect(req.getHostName()).to.equal("127.0.0.1");
    req.setUrl("http://rewritten.test:5151/q");
    expect(req.getHostName()).to.equal("rewritten.test");
    expect(req.getDomain()).to.equal("rewritten.test");
  });

  it("en-tête Host modifié après le ctor : redécoupé, comme avant", () => {
    const req = makeRequest("127.0.0.1:5151");
    req.headers.host = "changed.test:1";
    expect(req.getHostName()).to.equal("changed.test");
  });

  it("request.host ET en-tête réassignés à la même valeur : pas de cache périmé", () => {
    const req = makeRequest("127.0.0.1:5151");
    req.host = "both.test:2";
    req.headers.host = "both.test:2";
    expect(req.getHostName()).to.equal("both.test");
  });

  it("request.hostname réassigné par du code tiers : getHostName l'ignore, comme avant", () => {
    const req = makeRequest("127.0.0.1:5151");
    req.hostname = "tampered";
    expect(req.getHostName()).to.equal("127.0.0.1");
  });
});
