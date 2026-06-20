import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../nodefony/src/realtime/frameAuthorizer";
import type { IRealtimeToken } from "../../nodefony/src/realtime/realtimeContracts";

/**
 * P6 RED-TEAM — Firewall/WS data plane (J3b/J8), passe 2 (code-first).
 *
 * Complément ADVERSARIAL du banc fonctionnel `realtimeFrameLock.test.ts` : on
 * attaque le PLANCHER de canal système (`matchSystemPolicy`), invariant déclaré
 * « non contournable par une déclaration métier » (frameAuthorizer.ts:36,173). Un
 * plancher de sécurité ne doit pas non plus être contournable par une
 * transformation TRIVIALE du nom de canal (casse, suffixe de cadence) — sinon
 * defense-in-depth cassée (Zero Trust). On vise les branches non couvertes par le
 * banc fonctionnel : casse du namespace, suffixe de cadence, push inbound système.
 */

const ANON: IRealtimeToken = {
  type: "anonymous",
  getUserIdentifier: () => "anonymous",
  isAuthenticated: () => false,
  getRoles: () => ["ROLE_ANONYMOUS"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
const USER: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "alice",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
const ADMIN: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "boss",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_ADMIN"],
  getScopes: () => [],
  getAttribute: () => undefined,
};

const firewall: IFrameAuthorizerFirewall = {
  matchPath: () => null,
  hasRole: (roles, required) =>
    roles.includes(required) ||
    (required === "ROLE_USER" && roles.includes("ROLE_ADMIN")),
};
const authorize = buildFrameAuthorizer(firewall, {
  systemRules: DEFAULT_SYSTEM_RULES,
});
const sub = (channel: string) => ({ method: "subscribe", params: { channel } });

describe("RED-TEAM frameAuthorizer — contournement du plancher de canal système", () => {
  // ── A. Casse du namespace réservé (le vecteur principal) ───────────────────
  // `syslog:stream` exige ROLE_ADMIN ; `SYSLOG:stream` doit l'exiger AUSSI (sinon
  // un client change juste la casse pour échapper au plancher). Le hub route par
  // nom, mais la GARDE ne doit jamais dépendre d'un détail de casse (Zero Trust).
  it("A1 namespace système en CASSE différente → anonyme REFUSÉ (plancher tient)", () => {
    for (const ch of [
      "SYSLOG:stream",
      "Syslog:stream",
      "ORM:health",
      "Orm:flow",
      "DASHBOARD:supervision",
      "Node:stream",
      "Debugbar:stats",
      "REALTIME:health",
      "Cluster:peers",
    ]) {
      assert.equal(authorize(sub(ch), ANON), false, `anonyme/${ch}`);
    }
  });

  it("A2 namespace système en CASSE différente → user SIMPLE REFUSÉ (exige ROLE_ADMIN)", () => {
    for (const ch of ["SYSLOG:stream", "ORM:HEALTH", "Dashboard:Supervision"]) {
      assert.equal(authorize(sub(ch), USER), false, `user/${ch}`);
    }
  });

  it("A3 convention :health/:stats en casse mixte → user REFUSÉ", () => {
    assert.equal(authorize(sub("mymod:HEALTH"), USER), false);
    assert.equal(authorize(sub("mymod:Stats"), USER), false);
  });

  it("A0 contrôle positif : namespace système (casse quelconque) + ADMIN → AUTORISÉ", () => {
    // Prouve que la garde n'est pas un « refus tout » : l'admin légitime passe.
    assert.equal(authorize(sub("SYSLOG:stream"), ADMIN), true);
    assert.equal(authorize(sub("syslog:stream"), ADMIN), true);
  });

  // ── B. Suffixe de cadence / drill (anti-régression du startsWith) ──────────
  // Le client peut suffixer un canal d'une cadence (`:5000`) ou d'un drill worker
  // (`@pid`) : le plancher matche le PRÉFIXE de namespace, donc le suffixe ne
  // contourne pas. Couvre `channelRate` (parseRate) côté garde.
  it("B1 suffixe de cadence ne contourne pas le plancher (user REFUSÉ)", () => {
    for (const ch of [
      "syslog:stream:5000",
      "orm:health:1000",
      "dashboard:supervision@1234:1000",
      "realtime:health:2000",
    ]) {
      assert.equal(authorize(sub(ch), USER), false, ch);
    }
  });

  // ── C. Push inbound full-duplex sur un canal système ───────────────────────
  // Un client ne doit pas POUSSER (notification = method=canal) sur un namespace
  // d'observabilité, ni en casse exacte ni altérée.
  it("C1 inbound push sur canal système → user REFUSÉ (casse exacte ET altérée)", () => {
    assert.equal(
      authorize({ method: "syslog:stream", params: {} }, USER),
      false,
    );
    assert.equal(
      authorize({ method: "SYSLOG:stream", params: {} }, USER),
      false,
    );
    assert.equal(authorize({ method: "orm:flow", params: {} }, ANON), false);
  });
});
