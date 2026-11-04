import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { SecurityHeaders } from "../../nodefony/service/securityHeaders";
import { securityConfigSchema } from "../../nodefony/config/config";
import { parseCsp, withoutDirective } from "../../nodefony/src/csp";

/**
 * ADR-0024 §C6 — `upgrade-insecure-requests` part dans la politique d'une page
 * servie en `https`, jamais d'une page en clair (elle y réécrirait les
 * sous-ressources vers un `https` que le serveur ne sert pas). Les deux
 * variantes sont composées au démarrage ; par requête, un booléen choisit.
 */

const UIR = "upgrade-insecure-requests";
const has = (csp: string): boolean => parseCsp(csp).some(([n]) => n === UIR);
const DEFAULT_CSP = securityConfigSchema.parse({}).headers.csp;

describe("csp — withoutDirective (pur)", () => {
  it("retire la directive, insensible à la casse, sans toucher au reste", () => {
    assert.equal(
      withoutDirective(
        "default-src 'self'; Upgrade-Insecure-Requests; img-src data:",
        UIR,
      ),
      "default-src 'self'; img-src data:",
    );
  });

  it("rend la MÊME chaîne quand la directive est absente", () => {
    const csp = "default-src  'self' ;";
    assert.equal(withoutDirective(csp, UIR), csp);
  });

  it("garde le placeholder de nonce intact", () => {
    assert.equal(
      withoutDirective(`script-src 'nonce-{{nonce}}'; ${UIR}`, UIR),
      "script-src 'nonce-{{nonce}}'",
    );
  });
});

describe("SecurityHeaders — variante TLS et variante en clair", () => {
  const make = (csp: string, cspNonces = true): SecurityHeaders =>
    new SecurityHeaders({
      enabled: true,
      csp,
      cspNonces,
      referrerPolicy: "no-referrer",
    });

  it("le défaut porte la directive", () => {
    assert.ok(has(DEFAULT_CSP), DEFAULT_CSP);
  });

  it("nonce : TLS la garde, en clair la perd ; le nonce est le même", () => {
    const sh = make(DEFAULT_CSP);
    const tls = sh.cspFor("N0nce==", true);
    const plain = sh.cspFor("N0nce==", false);
    assert.ok(has(tls), tls);
    assert.ok(!has(plain), plain);
    assert.match(plain, /'nonce-N0nce=='/);
    assert.equal(withoutDirective(tls, UIR), plain);
  });

  it("par défaut (appel sans transport), la variante en clair : comportement d'avant", () => {
    assert.ok(!has(make(DEFAULT_CSP).cspFor("N0nce==")));
  });

  it("CSP statique (nonce coupé) : la table figée suit le transport", () => {
    const sh = make(DEFAULT_CSP, false);
    assert.ok(has(sh.headersFor(true)["Content-Security-Policy"] ?? ""));
    assert.ok(!has(sh.headersFor(false)["Content-Security-Policy"] ?? ""));
    assert.equal(sh.headers, sh.headersFor(false));
  });

  it("@Csp de route : les deux variantes, composées une fois", () => {
    const sh = make(DEFAULT_CSP);
    const extra = Object.freeze({ "img-src": ["https://cdn.example"] });
    const tls = sh.cspForExtra("N1", extra, true);
    const plain = sh.cspForExtra("N1", extra, false);
    assert.ok(has(tls) && !has(plain));
    assert.match(plain, /img-src [^;]*https:\/\/cdn\.example/);
  });

  it("l'application qui retire la directive de sa politique ne la reçoit jamais", () => {
    const sh = make(withoutDirective(DEFAULT_CSP, UIR));
    assert.ok(!has(sh.cspFor("N", true)));
    // Une seule variante : même objet, aucun coût de plus.
    assert.equal(sh.headersFor(true), sh.headersFor(false));
  });
});

/** Pare-feu réel sur la config par défaut. */
const firewall = (): Firewall => {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  kernel.emit("onBoot");
  return fw;
};

/** La CSP posée sur une réponse servie selon `scheme`. */
const cspOf = (fw: Firewall, scheme: "http" | "https"): string => {
  const headers: Record<string, string> = {};
  fw.applySecurityHeaders({
    scheme,
    cspNonce: "N0nce==",
    cspDirectives: null,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType);
  return headers["Content-Security-Policy"] ?? "";
};

describe("pare-feu — upgrade-insecure-requests selon le transport (ADR-0024 §C6)", () => {
  it("page servie en https → la directive est posée", () => {
    assert.ok(has(cspOf(firewall(), "https")));
  });

  it("page servie en clair → la directive est absente", () => {
    assert.ok(!has(cspOf(firewall(), "http")));
  });
});
