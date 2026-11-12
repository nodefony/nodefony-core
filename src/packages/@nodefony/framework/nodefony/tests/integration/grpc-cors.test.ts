/// <reference types="node" />
//
// ─── gRPC servi à un navigateur d'une autre origine (#695, ADR-0026 D9) ──────
//
// Décor : serveur de dev (skill `nodefony-start-server`) ; politique CORS du
// module `test` = une origine de confiance, `https://trusted.example`, et la
// liste d'en-têtes PAR DÉFAUT de l'application (`Authorization, Content-Type,
// X-Requested-With`) — celle qui refusait un client gRPC-Web au préflight.
//
// Critère 35 : préflight d'une origine autorisée → 204 avec les en-têtes de
// Connect ; statut lisible en gRPC-Web ; origine inconnue → refus gRPC ;
// aucune route HTTP n'expose `grpc-status`.
//
import { expect } from "vitest";

const H1 = "http://127.0.0.1:5151";
const SAY = "/nodefony.test.v1.EchoService/Say";
const TRUSTED = "https://trusted.example";
const UNKNOWN = "https://evil.example";

/** Ce qu'un client gRPC-Web navigateur demande au préflight. */
const REQUESTED_HEADERS = "content-type,x-grpc-web,x-user-agent,grpc-timeout";

const listOf = (value: string | null): string[] =>
  (value ?? "").split(",").map((entry) => entry.trim().toLowerCase());

/** Un appel gRPC-Web binaire, message vide, depuis `origin`. */
async function grpcWebFrom(origin: string): Promise<Response> {
  return fetch(H1 + SAY, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      // Une requête navigateur d'une autre origine porte cette métadonnée.
      "sec-fetch-site": "cross-site",
    },
    body: new Uint8Array([0, 0, 0, 0, 0]),
  });
}

describe("gRPC — navigateur d'une autre origine (critère 35, ADR-0026 D9)", () => {
  it("préflight d'une origine autorisée : 204, en-têtes et méthodes de Connect autorisés", async () => {
    const r = await fetch(H1 + SAY, {
      method: "OPTIONS",
      headers: {
        origin: TRUSTED,
        "access-control-request-method": "POST",
        "access-control-request-headers": REQUESTED_HEADERS,
      },
    });
    expect(r.status).to.equal(204);
    expect(r.headers.get("access-control-allow-origin")).to.equal(TRUSTED);
    const allowed = listOf(r.headers.get("access-control-allow-headers"));
    for (const name of REQUESTED_HEADERS.split(",")) {
      expect(allowed, name).to.include(name);
    }
    // La liste de l'application est gardée.
    expect(allowed).to.include("authorization");
    expect(listOf(r.headers.get("access-control-allow-methods"))).to.include(
      "post",
    );
  });

  it("appel gRPC-Web d'une origine autorisée : le statut est lisible par le script", async () => {
    const r = await grpcWebFrom(TRUSTED);
    await r.arrayBuffer();
    expect(r.headers.get("access-control-allow-origin")).to.equal(TRUSTED);
    const exposed = listOf(r.headers.get("access-control-expose-headers"));
    for (const name of [
      "grpc-status",
      "grpc-message",
      "grpc-status-details-bin",
    ]) {
      expect(exposed, name).to.include(name);
    }
  });

  it("origine inconnue : préflight sans aucun en-tête CORS (le navigateur bloque)", async () => {
    const r = await fetch(H1 + SAY, {
      method: "OPTIONS",
      headers: {
        origin: UNKNOWN,
        "access-control-request-method": "POST",
        "access-control-request-headers": REQUESTED_HEADERS,
      },
    });
    expect(r.status).to.equal(204);
    expect(r.headers.get("access-control-allow-origin")).to.equal(null);
    expect(r.headers.get("access-control-allow-headers")).to.equal(null);
  });

  it("origine inconnue : l'appel est refusé AU FORMAT gRPC, jamais en page HTML", async () => {
    const r = await grpcWebFrom(UNKNOWN);
    const body = new TextDecoder().decode(await r.arrayBuffer());
    expect(r.headers.get("access-control-allow-origin")).to.equal(null);
    const status =
      r.headers.get("grpc-status") ??
      /grpc-status:\s*(\d+)/i.exec(body)?.[1] ??
      null;
    expect(status, "statut gRPC du refus").not.to.equal(null);
    expect(status).not.to.equal("0");
    expect(body).not.to.match(/<html/i);
  });

  it("une route HTTP d'une origine autorisée n'expose rien de gRPC", async () => {
    const r = await fetch(`${H1}/nodefony/test/trace-channel/ok`, {
      headers: { origin: TRUSTED },
    });
    await r.arrayBuffer();
    expect(r.headers.get("access-control-allow-origin")).to.equal(TRUSTED);
    expect(
      listOf(r.headers.get("access-control-expose-headers")),
    ).not.to.include("grpc-status");
  });
});
