import assert from "node:assert/strict";
import type { ContextType } from "@nodefony/http";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { defineSecurityConfig } from "../../nodefony/config/defineSecurityConfig";

/**
 * Contrat de zone (J3b Étape 1) — VERROUILLE :
 * - la propagation des champs `realtime` / `sessionContext` config → instance,
 * - le pattern du data plane `^/nodefony/[^/]+/api(/|$)` contre l'inventaire RÉEL
 *   des namespaces (kernel/http/framework/orm/frontend/profiler/documentation/studio).
 *
 * Le pattern est un PONT : un faux négatif laisse un namespace ouvert (fuite),
 * un faux positif protège une page SPA publique (casse l'UX). Les deux sont testés.
 */

/** Context HTTP minimal pour `SecuredArea.match` (url + vhost). */
function ctx(url: string, domain?: string): ContextType {
  return { domain, request: { url: new URL(url) } } as unknown as ContextType;
}

/** Construit l'instance de zone à partir d'une config validée (source de vérité). */
function area(cfg: Parameters<typeof defineSecurityConfig>[0]): SecuredArea {
  const validated = defineSecurityConfig(cfg);
  const name = Object.keys(validated.areas)[0];
  return new SecuredArea(name, validated.areas[name]);
}

describe("SecuredArea — propagation des champs (J3b Étape 1)", () => {
  it("propage realtime depuis la config validée", () => {
    const z = area({
      areas: {
        admin: { pattern: "^/nodefony/[^/]+/api(/|$)", realtime: true },
      },
    });
    assert.equal(z.realtime, true);
  });

  it("défaut : realtime=true (Zero Trust — la zone protégée ferme AUSSI le WS)", () => {
    const z = area({ areas: { app: { pattern: "^/app" } } });
    assert.equal(z.realtime, true);
  });

  it("opt-out explicite : realtime=false (zone strictement HTTP)", () => {
    const z = area({ areas: { app: { pattern: "^/app", realtime: false } } });
    assert.equal(z.realtime, false);
  });
});

describe("SecuredArea — pattern data plane vs inventaire réel (PONT)", () => {
  const dataPlane = area({
    areas: { admin: { pattern: "^/nodefony/[^/]+/api(/|$)", realtime: true } },
  });

  // Inventaire RÉEL des producteurs data plane (kit J3b : framework, frontend,
  // orm-core, documentation, studio) — chacun doit tomber dans la zone.
  for (const path of [
    "/nodefony/kernel/api/config",
    "/nodefony/http/api/stats",
    "/nodefony/framework/api/routes",
    "/nodefony/orm/api/schema",
    "/nodefony/frontend/api/bundles",
    "/nodefony/documentation/api/tree",
    "/nodefony/studio/api/realtime", // handshake WS Studio
    "/nodefony/profiler/api", // SANS slash final : le (/|$) DOIT capturer
  ]) {
    it(`capture le data plane : ${path}`, () => {
      assert.equal(dataPlane.match(ctx(`http://h${path}`)), true);
    });
  }

  // Hors zone : coquilles SPA (publiques, l'AuthGuard front redirige) + autres espaces.
  for (const path of [
    "/nodefony/kernel", // page SPA, pas /api
    "/nodefony/studio", // page SPA
    "/nodefony/studio/dashboard", // route SPA profonde
    "/nodefony", // racine
    "/nodefony/kernel/apiX/y", // 'api' n'est pas un segment isolé
    "/nodefony/kernel/sub/api", // 'api' en 3e segment (pas le contrat <ns>/api)
    "/api/users", // espace applicatif
    "/app", // hors /nodefony
  ]) {
    it(`laisse PUBLIC (hors data plane) : ${path}`, () => {
      assert.equal(dataPlane.match(ctx(`http://h${path}`)), false);
    });
  }
});

describe("SecuredArea — filtre vhost", () => {
  const z = area({
    areas: { vh: { pattern: "^/x", host: "admin.example.com" } },
  });

  it("matche uniquement le host déclaré", () => {
    assert.equal(
      z.match(ctx("http://admin.example.com/x", "admin.example.com")),
      true,
    );
  });

  it("rejette un autre host même si le path matche", () => {
    assert.equal(
      z.match(ctx("http://other.example.com/x", "other.example.com")),
      false,
    );
  });
});

describe("SecuredArea — matchPath sans contexte (verrou WebSocket)", () => {
  // Le verrou WS n'a qu'un path (frame api.request) : matchPath doit décider
  // SANS ContextType — source UNIQUE partagée avec isSecure (HTTP), garante de
  // l'invariant `api.request {path}` ≤ `GET {path}`.
  it("décide sur un path nu, sans ContextType", () => {
    const z = area({
      areas: {
        admin: { pattern: "^/nodefony/[^/]+/api(/|$)", realtime: true },
      },
    });
    assert.equal(z.matchPath("/nodefony/kernel/api/config"), true);
    assert.equal(z.matchPath("/nodefony/kernel"), false);
  });

  it("filtre vhost sur le host fourni (2ᵉ arg)", () => {
    const z = area({
      areas: { vh: { pattern: "^/x", host: "admin.example.com" } },
    });
    assert.equal(z.matchPath("/x", "admin.example.com"), true);
    assert.equal(z.matchPath("/x", "autre.com"), false);
    assert.equal(z.matchPath("/x"), false); // host requis mais absent
  });

  it("sans host configuré : matche quel que soit le host (ou absent)", () => {
    const z = area({ areas: { a: { pattern: "^/nodefony/[^/]+/api(/|$)" } } });
    assert.equal(z.matchPath("/nodefony/http/api/stats"), true);
    assert.equal(z.matchPath("/nodefony/http/api/stats", "whatever"), true);
  });
});
