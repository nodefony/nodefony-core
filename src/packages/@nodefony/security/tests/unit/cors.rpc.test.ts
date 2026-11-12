/// <reference types="node" />
//
// ─── CORS d'un service gRPC : l'union au démarrage (#695, ADR-0026 D9) ────────
//
// Le préflight part AVANT le routage et ne connaît pas la route : dès qu'un
// service gRPC est déclaré, la politique UNIQUE de l'application reçoit à
// `onReady` les méthodes et en-têtes de Connect. Sans eux, un client gRPC-Web
// qui envoie `x-grpc-web` ou `grpc-timeout` est refusé au préflight.
//
// L'ordre des cas compte : la déclaration d'une route gRPC est un état du
// processus (`markGrpcRoute`), jamais retiré — les cas « sans service » passent
// d'abord.
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `Firewall` : l'abonnement `onReady` → `#widenCorsForRpc` ;
//   - `withMissing` : la comparaison sans casse (doublon de `Content-Type`).
//
import { EventEmitter } from "node:events";
import { expect, vi } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { markGrpcRoute } from "@nodefony/http/grpc";
import { Firewall } from "../../nodefony/service/firewall";

const ORIGIN = "https://app.example";

/** Pare-feu réel, noyau factice : rend aussi de quoi émettre `onReady`. */
function firewall(cors: Record<string, unknown>): {
  fw: Firewall;
  kernel: EventEmitter;
} {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options: { cors },
  } as unknown as Module);
  kernel.emit("onBoot");
  return { fw, kernel };
}

/** Les en-têtes d'un préflight `OPTIONS` d'`ORIGIN`. */
function preflight(fw: Firewall): Record<string, string> {
  const set: Record<string, string> = {};
  const context = {
    method: "OPTIONS",
    request: {
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
      },
    },
    response: {
      setHeader(name: string, value: string) {
        set[name.toLowerCase()] = value;
      },
    },
  };
  expect(fw.handleCors(context as unknown as ContextType)).to.equal(204);
  return set;
}

const listOf = (value: string | undefined): string[] =>
  (value ?? "").split(",").map((entry) => entry.trim().toLowerCase());

describe("CORS — sans service gRPC déclaré", () => {
  it("onReady ne change rien : la liste de l'application, telle quelle", () => {
    const { fw, kernel } = firewall({ origins: [ORIGIN] });
    kernel.emit("onReady");
    const headers = preflight(fw);
    expect(listOf(headers["access-control-allow-headers"])).to.deep.equal([
      "authorization",
      "content-type",
      "x-requested-with",
    ]);
  });
});

describe("CORS — service gRPC déclaré : union au démarrage (critère 35)", () => {
  it("préflight : les en-têtes et méthodes de Connect s'ajoutent à ceux de l'application, annoncés au journal", () => {
    markGrpcRoute({});
    // Écriture de l'application en minuscules : Connect écrit `Content-Type`.
    const { fw, kernel } = firewall({
      origins: [ORIGIN],
      methods: ["PUT"],
      allowedHeaders: ["Authorization", "content-type"],
    });
    const log = vi.spyOn(fw, "log");
    kernel.emit("onReady");
    const headers = preflight(fw);
    const allowed = listOf(headers["access-control-allow-headers"]);
    for (const name of [
      "authorization",
      "x-grpc-web",
      "grpc-timeout",
      "connect-protocol-version",
      "connect-timeout-ms",
    ]) {
      expect(allowed, name).to.include(name);
    }
    // `Content-Type` déjà dans la liste de l'application : pas de doublon.
    expect(allowed.filter((name) => name === "content-type")).to.have.length(1);
    expect(listOf(headers["access-control-allow-methods"])).to.deep.equal([
      "put",
      "post",
      "get",
    ]);
    expect(
      log.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("gRPC") &&
          message.includes("X-Grpc-Web"),
      ),
    ).to.equal(true);
  });

  it("origine inconnue : toujours aucun en-tête (la liste s'élargit, pas l'origine)", () => {
    const { fw, kernel } = firewall({ origins: [ORIGIN] });
    kernel.emit("onReady");
    const set: Record<string, string> = {};
    const context = {
      method: "OPTIONS",
      request: {
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      },
      response: {
        setHeader(name: string, value: string) {
          set[name] = value;
        },
      },
    };
    expect(fw.handleCors(context as unknown as ContextType)).to.equal(204);
    expect(set).to.deep.equal({});
  });

  it("CORS désactivé : rien à élargir, aucune politique créée", () => {
    const { fw, kernel } = firewall({ enabled: false, origins: [ORIGIN] });
    kernel.emit("onReady");
    const context = {
      method: "OPTIONS",
      request: {
        headers: { origin: ORIGIN, "access-control-request-method": "POST" },
      },
      response: { setHeader: () => undefined },
    };
    expect(fw.handleCors(context as unknown as ContextType)).to.equal(
      undefined,
    );
  });
});
