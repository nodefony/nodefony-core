import { describe, it, expect, afterEach } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import HttpKernel from "../../service/http-kernel";
import type { IFirewallGate } from "../../interfaces/ISecurity";

/**
 * ADR-0024 §C5 — `securityHeaders.frameOptions` pilote `X-Frame-Options` (posé
 * ici) ET `frame-ancestors` (posé par le pare-feu). Une édition à chaud doit
 * donc prévenir le pare-feu, sinon les deux en-têtes divergent.
 */

const kernels: Array<{ rateLimitGc: { stop(): void } | null }> = [];
afterEach(() => {
  for (const k of kernels.splice(0)) k.rateLimitGc?.stop();
});

function kernelWithFirewall(firewall: Partial<IFirewallGate>): HttpKernel {
  const module = {
    container: new Container(),
    notificationsCenter: new Event(),
    options: {
      http: { responseTimeout: 1_000 },
      https: { responseTimeout: 1_000 },
      websocket: { closeTimeout: 1_000 },
      websocketSecure: { closeTimeout: 1_000 },
      securityHeaders: { contentTypeOptions: "nosniff", frameOptions: "DENY" },
      rateLimit: { enabled: false, windowS: 60, max: 1, maxTracked: 10 },
    },
  } as unknown as Module;
  const kernel = new HttpKernel(module);
  kernel.firewall = firewall as IFirewallGate;
  kernels.push(kernel as unknown as { rateLimitGc: { stop(): void } | null });
  return kernel;
}

describe("HttpKernel.onConfigChanged — prévient le pare-feu (frame-ancestors)", () => {
  it("le pare-feu relit les en-têtes APRÈS leur recalcul", () => {
    const seen: Array<string | null> = [];
    const kernel = kernelWithFirewall({
      onTransportHeadersChanged: () => {
        seen.push(kernel.describeTransportSecurityHeaders().frameOptions);
      },
    });
    (
      kernel.options as { securityHeaders: { frameOptions: string | null } }
    ).securityHeaders.frameOptions = "SAMEORIGIN";
    kernel.onConfigChanged();
    expect(seen).toEqual(["SAMEORIGIN"]);
  });

  it("un pare-feu sans le crochet (optionnel) ne casse rien", () => {
    const kernel = kernelWithFirewall({});
    expect(() => kernel.onConfigChanged()).not.toThrow();
  });
});
