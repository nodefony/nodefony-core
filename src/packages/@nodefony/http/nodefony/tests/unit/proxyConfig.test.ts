/// <reference types="node" />
/**
 * Unit — section `proxy` de la configuration de `@nodefony/http`.
 *
 * Une faute dans un montage doit interrompre le démarrage EN NOMMANT la clé
 * fautive (`BootConfigurationError`, seule fatale en développement), jamais
 * démarrer sur un défaut ni relayer quelque chose d'imprévu. Les refus sont
 * ceux de `src/proxy/rules.ts`, partagés avec `ReverseProxy.mount()` : le
 * banc réseau (`reverseProxy.test.ts`) éprouve le même jeu côté code.
 */
import { describe, it, expect } from "vitest";
import { BootConfigurationError } from "nodefony";
import { defineHttpConfig } from "../../config/defineModuleConfig";
import {
  isAmbiguousPath,
  websocketHandshakeProblem,
} from "../../src/proxy/rules";
import type { IHttpConfigInput } from "../../config/config";

type Mounts = NonNullable<NonNullable<IHttpConfigInput["proxy"]>["mounts"]>;

function boot(mounts: Mounts, extra: Record<string, unknown> = {}) {
  return defineHttpConfig({ proxy: { mounts, ...extra } } as IHttpConfigInput);
}

/** Message d'erreur de démarrage, ou `null` si la config passe. */
function refusal(
  mounts: Mounts,
  extra: Record<string, unknown> = {},
): string | null {
  try {
    boot(mounts, extra);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(BootConfigurationError);
    return (e as Error).message;
  }
}

describe("config `proxy` — défauts", () => {
  it("sans section : aucun montage, délais et pool par défaut", () => {
    const cfg = defineHttpConfig({});
    expect(cfg.proxy).toEqual({
      timeoutMs: 30_000,
      connectTimeoutMs: 5_000,
      maxSockets: 256,
      mounts: {},
    });
  });

  it("un montage reçoit ses défauts explicites ; méthodes et en-têtes gardés tels qu'écrits (normalisés au montage)", () => {
    const cfg = boot({
      "/billing/": {
        target: "http://127.0.0.1:8080",
        methods: ["get", "Post"],
        stripHeaders: ["Cookie"],
      },
    });
    expect(cfg.proxy.mounts["/billing/"]).toEqual({
      target: "http://127.0.0.1:8080",
      methods: ["get", "Post"],
      websocket: false,
      stripPrefix: false,
      preserveHost: false,
      stripHeaders: ["Cookie"],
      secure: true,
    });
  });
});

describe("config `proxy` — refus au démarrage, clé nommée", () => {
  it.each<[string, Mounts, RegExp]>([
    [
      "préfixe /",
      { "/": { target: "http://127.0.0.1:1" } },
      /TOUTE l'application/,
    ],
    [
      "administration",
      { "/nodefony/api/": { target: "http://127.0.0.1:1" } },
      /réservé au framework/,
    ],
    [
      "préfixe du frontend",
      { "/_vite/x/": { target: "http://127.0.0.1:1" } },
      /@nodefony\/frontend/,
    ],
    ["segment ..", { "/a/../b/": { target: "http://127.0.0.1:1" } }, /segment/],
    [
      "cible avec chemin",
      { "/svc/": { target: "http://127.0.0.1:1/base" } },
      /origine http\(s\) nue/,
    ],
    [
      "cible sans scheme",
      { "/svc/": { target: "127.0.0.1:8080" } },
      /origine http\(s\) nue/,
    ],
    [
      "identifiants",
      { "/svc/": { target: "https://u:p@api.test" } },
      /identifiants/,
    ],
    [
      "secure:false distant",
      { "/svc/": { target: "https://api.example.test", secure: false } },
      /NODE_EXTRA_CA_CERTS/,
    ],
    [
      "secure:false en http",
      { "/svc/": { target: "http://127.0.0.1:1", secure: false } },
      /ne concerne qu'une cible https/,
    ],
    [
      "méthode invalide",
      { "/svc/": { target: "http://127.0.0.1:1", methods: ["GE T"] } },
      /méthode/,
    ],
    [
      "méthodes vides",
      { "/svc/": { target: "http://127.0.0.1:1", methods: [] } },
      /vide/,
    ],
    [
      "host retiré",
      { "/svc/": { target: "http://127.0.0.1:1", stripHeaders: ["Host"] } },
      /preserveHost/,
    ],
    [
      "délai non entier",
      { "/svc/": { target: "http://127.0.0.1:1", timeoutMs: 1.5 } },
      /délai/,
    ],
  ])("%s", (_label, mounts, message) => {
    const m = refusal(mounts);
    expect(m).not.toBeNull();
    expect(m).toMatch(message);
    // La clé fautive est nommée : on corrige sans chercher.
    expect(m).toContain(Object.keys(mounts)[0] ?? "");
  });

  it("deux clés qui désignent le même préfixe", () => {
    expect(
      refusal({
        "/svc": { target: "http://127.0.0.1:1" },
        "/svc/": { target: "http://127.0.0.1:2" },
      }),
    ).toMatch(/même préfixe/);
  });

  it("clé inconnue dans un montage (faute de frappe) : refusée, pas ignorée", () => {
    expect(
      refusal({
        "/svc/": { target: "http://127.0.0.1:1", websockets: true } as never,
      }),
    ).toMatch(/websockets/);
  });

  it("rend TOUS les refus d'un coup", () => {
    const m = refusal({
      "/": { target: "ftp://x", secure: false, methods: [] },
    });
    expect(m).toMatch(/TOUTE l'application/);
    expect(m).toMatch(/origine http\(s\) nue/);
    expect(m).toMatch(/vide/);
  });

  it("accepte secure:false vers la boucle locale", () => {
    expect(
      refusal({ "/svc/": { target: "https://127.0.0.1:8443", secure: false } }),
    ).toBeNull();
  });
});

describe("règles pures — chemin et handshake", () => {
  it.each([
    "/a/../b",
    "/a/./b",
    "/a/..",
    "/a%2f..",
    "/%2E%2E/",
    "/a\\b",
    "/a%5Cb",
    "/a%00",
    "/a%252e",
  ])("chemin ambigu : %s", (p) => expect(isAmbiguousPath(p)).toBe(true));
  it.each(["/a/b", "/a%20b/c.ts", "/a/b?x=../y", "/@fs/C:/x/y.ts", "/a/...b"])(
    "chemin sûr : %s",
    (p) => expect(isAmbiguousPath(p)).toBe(false),
  );

  const ok = {
    upgrade: "WebSocket",
    connection: "keep-alive, Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  };
  it("handshake conforme (casse et liste Connection tolérées)", () => {
    expect(websocketHandshakeProblem("GET", ok)).toBeNull();
  });
  it.each<[string, string | undefined, Record<string, string>]>([
    ["POST", "POST", ok],
    ["h2c", "GET", { ...ok, upgrade: "h2c" }],
    ["sans Connection: upgrade", "GET", { ...ok, connection: "keep-alive" }],
    ["version 8", "GET", { ...ok, "sec-websocket-version": "8" }],
    ["clé courte", "GET", { ...ok, "sec-websocket-key": "abc==" }],
  ])("handshake refusé : %s", (_l, method, headers) => {
    expect(websocketHandshakeProblem(method, headers)).not.toBeNull();
  });
});
