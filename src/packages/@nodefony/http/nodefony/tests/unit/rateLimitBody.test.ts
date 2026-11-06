/// <reference types="node" />
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import HttpKernel from "../../service/http-kernel";

/**
 * RFC 9110 §15.5 — un 4xx porte un corps qui dit pourquoi (#734). Le 429 du
 * limiteur de débit sortait d'un `end()` nu. Vrai noyau, vrai serveur Node :
 * c'est le fil qui dit ce que le client reçoit.
 */

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function limitedKernel(): HttpKernel {
  const module = {
    container: new Container(),
    notificationsCenter: new Event(),
    options: {
      http: { responseTimeout: 1_000 },
      https: { responseTimeout: 1_000 },
      websocket: { closeTimeout: 1_000 },
      websocketSecure: { closeTimeout: 1_000 },
      securityHeaders: { contentTypeOptions: "nosniff", frameOptions: "DENY" },
      rateLimit: { enabled: true, windowS: 60, max: 1, maxTracked: 10 },
    },
  } as unknown as Module;
  const kernel = new HttpKernel(module);
  // Armé au boot par le noyau ; appelé ici, sans boot.
  (kernel as unknown as { configureRateLimit(): void }).configureRateLimit();
  stops.push(() =>
    (
      kernel as unknown as { rateLimitGc: { stop(): void } | null }
    ).rateLimitGc?.stop(),
  );
  return kernel;
}

const limiter = (k: HttpKernel) =>
  (k as unknown as { rateLimiter: { hit(ip: string): unknown } | null })
    .rateLimiter;

describe("limiteur de débit — le 429 dit pourquoi", () => {
  it("corps JSON aux champs du contrat d'erreur, longueur exacte", async () => {
    const kernel = limitedKernel();
    // Le plafond (1) est déjà consommé par cette adresse, sous ses deux formes.
    for (const ip of ["127.0.0.1", "::ffff:127.0.0.1"]) {
      for (let i = 0; i < 3; i++) limiter(kernel)?.hit(ip);
    }
    const dispatch = (
      HttpKernel.prototype as unknown as {
        dispatchHttpRequest: (
          q: http.IncomingMessage,
          s: http.ServerResponse,
          t: string,
        ) => unknown;
      }
    ).dispatchHttpRequest;
    const server = http.createServer((q, s) => {
      void dispatch.call(kernel, q, s, "http");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    stops.push(() => server.close());
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/x`);
    const text = await res.text();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(JSON.parse(text)).toEqual({
      code: 429,
      message: "Too Many Requests",
    });
    expect(Number(res.headers.get("content-length"))).toBe(
      Buffer.byteLength(text),
    );
  });
});
