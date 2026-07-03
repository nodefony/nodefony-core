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

/**
 * 0.6 F2 — PLANCHER irréductible : une règle de config `realtimeChannels` est
 * placée AVANT les défauts (1ᵉʳ match gagne) → sans plancher, elle pourrait OUVRIR
 * un namespace réservé plateforme à l'anonyme. Le plancher garantit `authenticated`
 * au minimum sur ces namespaces : la config peut RESSERRER/re-cibler, jamais
 * DESCENDRE sous authenticated. Un namespace APPLICATIF (non réservé) reste, lui,
 * librement ouvrable (y compris anonyme). Cf project_realtime_dos_limits_kit (F2).
 */
describe("0.6 F2 — plancher irréductible des namespaces réservés (anti-desserrage config)", () => {
  // Config MALVEILLANTE/ERRONÉE : tente d'ouvrir des namespaces réservés à l'anonyme,
  // + re-cible un namespace applicatif (légitime). Placée AVANT les défauts.
  const looseRules = [
    { prefix: "security:", policy: { authenticated: false } }, // tente d'ouvrir l'audit
    { prefix: "syslog:", policy: {} }, // policy vide = aucune contrainte
    { prefix: "chat:", policy: {} }, // namespace APPLICATIF → librement public
    ...DEFAULT_SYSTEM_RULES,
  ];
  const authz = buildFrameAuthorizer(firewall, { systemRules: looseRules });

  it("[F2] config ouvre security: à l'anonyme → REFUSÉ (plancher force authenticated)", () => {
    assert.equal(authz(sub("security:audit"), ANON), false);
  });

  it("[F2] config met une policy VIDE sur syslog: → anonyme REFUSÉ (plancher)", () => {
    assert.equal(authz(sub("syslog:stream"), ANON), false);
  });

  it("[F2] la config PEUT desserrer jusqu'à authenticated (pas en-dessous) : USER autorisé", () => {
    // Le plancher n'IMPOSE pas ROLE_ADMIN : si l'opérateur re-cible délibérément à
    // authenticated-only, un user authentifié passe. Il bloque SEULEMENT l'anonyme.
    assert.equal(authz(sub("security:audit"), USER), true);
    assert.equal(authz(sub("syslog:stream"), USER), true);
  });

  it("[F2] anti-bypass : un prefixe de config plus COURT ne contourne pas le plancher", () => {
    // Règle {prefix:"sec"} → matche "security:audit" en 1er, policy ouverte. Le
    // plancher se base sur le NAMESPACE du canal (security:), pas le prefixe matché.
    const sneaky = [
      { prefix: "sec", policy: { authenticated: false } },
      ...DEFAULT_SYSTEM_RULES,
    ];
    const a = buildFrameAuthorizer(firewall, { systemRules: sneaky });
    assert.equal(a(sub("security:audit"), ANON), false);
  });

  it("[F2] un namespace APPLICATIF (non réservé) reste librement ouvrable à l'anonyme", () => {
    // Le plancher ne s'applique QU'AUX namespaces réservés plateforme : un canal
    // métier que la config ouvre reste public (le framework ne bride pas l'app).
    assert.equal(authz(sub("chat:room-42"), ANON), true);
  });
});
