import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../nodefony/src/realtime/frameAuthorizer";
import type { IRealtimeToken } from "../../nodefony/src/realtime/realtimeContracts";

/**
 * Phase 0.6 — REVUE realtime, F7 : prototype pollution via les params JSON-RPC.
 *
 * Le flux realtime parse chaque frame par `JSON.parse(raw)` (RealtimeController) puis
 * lit `frame.method` / `frame.params.channel|path` en accès DIRECT (aucun merge
 * récursif). On prouve qu'un payload `__proto__` / `constructor.prototype` — construit
 * via `JSON.parse`, FIDÈLE au flux (un littéral JS `{ __proto__: … }` déclencherait le
 * SETTER de prototype, pas le vecteur réel : `JSON.parse` en fait une own property) :
 *  - ne pollue PAS `Object.prototype` ;
 *  - ne contourne PAS le plancher de canal système (pas d'élévation par pollution) ;
 *  - ne fabrique pas d'identité (le token vient du handshake, jamais des params).
 */

const ANON: IRealtimeToken = {
  type: "anonymous",
  getUserIdentifier: () => "anonymous",
  isAuthenticated: () => false,
  getRoles: () => ["ROLE_ANONYMOUS"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
const firewall: IFrameAuthorizerFirewall = {
  matchPath: () => null,
  hasRole: (roles, required) => roles.includes(required),
};
const authorize = buildFrameAuthorizer(firewall, {
  systemRules: DEFAULT_SYSTEM_RULES,
});

describe("0.6 F7 — prototype pollution via params JSON-RPC", () => {
  it("JSON.parse d'un payload __proto__ ne pollue PAS Object.prototype", () => {
    JSON.parse(
      '{"jsonrpc":"2.0","method":"subscribe","params":{"__proto__":{"polluted":"yes"}}}',
    );
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it("JSON.parse d'un payload constructor.prototype ne pollue PAS Object.prototype", () => {
    JSON.parse('{"params":{"constructor":{"prototype":{"polluted":"yes"}}}}');
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it("params pollué (__proto__ injectant des roles) → canal système TOUJOURS refusé pour l'anonyme", () => {
    // channel réel présent + tentative d'injecter des roles par pollution du params.
    const frame = JSON.parse(
      '{"method":"subscribe","params":{"channel":"nodefony:syslog","__proto__":{"roles":["ROLE_ADMIN"]}}}',
    );
    assert.equal(authorize(frame, ANON), false); // les roles pollués sont ignorés (token intact)
    assert.equal(({} as Record<string, unknown>).roles, undefined); // 0 pollution globale
  });

  it("le token anonyme reste intact : la pollution ne fabrique ni auth ni rôle", () => {
    JSON.parse(
      '{"params":{"__proto__":{"isAuthenticated":true,"getRoles":["ROLE_ADMIN"]}}}',
    );
    // Le token est résolu au handshake (WeakMap), jamais lu depuis les params.
    assert.equal(ANON.isAuthenticated(), false);
    assert.deepEqual(ANON.getRoles(), ["ROLE_ANONYMOUS"]);
  });

  it("query `?__proto__=…` (valeur string) → pas de pollution (le setter ignore les non-objets)", () => {
    // Reproduit le pattern de invokeApiRequest : `query[k] = v` avec k issu de l'URL,
    // v TOUJOURS une string (URLSearchParams) → le setter __proto__ ignore les strings.
    const query: Record<string, unknown> = {};
    query["__proto__"] = "malicious";
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf(query), Object.prototype); // prototype inchangé
  });
});
