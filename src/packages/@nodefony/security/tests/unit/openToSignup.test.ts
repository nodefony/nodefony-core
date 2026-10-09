import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import { Firewall } from "../../nodefony/service/firewall";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";
import type { ISecurityConfigInput } from "../../nodefony/config/defineModuleConfig";
import { findZonesOpenToSignup } from "../../nodefony/src/openToSignup";

/**
 * Une zone sans rôle + l'inscription OAuth à la volée = une zone ouverte à
 * tout compte du fournisseur. La règle (`findZonesOpenToSignup`) est la seule
 * implémentation : chaque condition qui en sort doit éteindre l'alerte, et le
 * cas complet doit l'allumer — sinon une condition retirée passerait inaperçue.
 */

const PROVIDERS = {
  keycloak: {
    clientId: "id",
    clientSecret: "sec",
    redirectUri: "https://app/cb",
  },
};

/** Le cas complet : zone `secure` session, sans rôle ; OAuth actif, inscription par défaut. */
function input(
  area: Record<string, unknown> = {},
  oauth2: Record<string, unknown> = {},
): ISecurityConfigInput {
  return {
    areas: {
      secure: {
        pattern: "^/secure",
        security: true,
        authenticators: ["session"],
        ...area,
      },
    },
    oauth2: { enabled: true, providers: PROVIDERS, ...oauth2 },
  } as ISecurityConfigInput;
}

function open(config: ISecurityConfigInput): string[] {
  return findZonesOpenToSignup(defineSecurityConfig(config)).map((z) => z.zone);
}

describe("findZonesOpenToSignup — la règle", () => {
  it("🔴 le cas complet est signalé, avec le fournisseur et les deux gestes", () => {
    const [z] = findZonesOpenToSignup(defineSecurityConfig(input()));
    assert.equal(z?.zone, "secure");
    assert.deepEqual(z?.providers, ["keycloak"]);
    assert.match(z?.message ?? "", /« secure ».*keycloak/u);
    assert.match(z?.action ?? "", /roles: \["ROLE_USER"\]/u);
    assert.match(z?.action ?? "", /allowSignup: false/u);
  });

  it("une zone qui DÉCLARE ses rôles n'est pas signalée — l'intention est écrite", () => {
    assert.deepEqual(open(input({ roles: ["ROLE_USER"] })), []);
  });

  it("une zone qui accepte l'anonyme est hors règle — elle est déjà publique", () => {
    assert.deepEqual(
      open(input({ authenticators: ["session", "anonymous"] })),
      [],
    );
  });

  it("une zone sans session est hors règle — un compte OAuth n'y entre pas", () => {
    assert.deepEqual(open(input({ authenticators: ["jwt"] })), []);
  });

  it("une zone publique (`security: false`) est hors règle", () => {
    assert.deepEqual(open(input({ security: false })), []);
  });

  it("`allowSignup: false` éteint l'alerte — plus aucun compte n'est créé", () => {
    assert.deepEqual(open(input({}, { allowSignup: false })), []);
  });

  it("`oauth2` inactif, ou sans fournisseur, éteint l'alerte", () => {
    assert.deepEqual(open(input({}, { enabled: false })), []);
    assert.deepEqual(open(input({}, { providers: {} })), []);
  });
});

describe("Firewall — le constat au démarrage et dans describe()", () => {
  function boot(options: ISecurityConfigInput): {
    firewall: Firewall;
    logs: string[];
  } {
    const container = new Container();
    const cbs: Array<() => void> = [];
    container.set("kernel", {
      container,
      once(ev: string, cb: () => void) {
        if (ev === "onBoot") cbs.push(cb);
      },
    });
    const firewall = new Firewall({
      container,
      notificationsCenter: new Event(),
      options,
    } as unknown as Module);
    const logs: string[] = [];
    firewall.log = ((msg: unknown, severity?: unknown) => {
      if (severity === "WARNING") logs.push(String(msg));
      return undefined as never;
    }) as Firewall["log"];
    cbs.forEach((cb) => cb());
    return { firewall, logs };
  }

  it("🔴 expose `roles`, `openToSignup` et le constat rédigé, et le dit UNE fois au démarrage", () => {
    const { firewall, logs } = boot(input());
    const zone = firewall.describe().zones.find((z) => z.name === "secure");
    assert.deepEqual(zone?.roles, []);
    assert.equal(zone?.openToSignup, true);
    assert.match(zone?.openToSignupNotice?.message ?? "", /keycloak/u);
    assert.equal(logs.filter((l) => /« secure »/u.test(l)).length, 1);
  });

  it("avec `roles` déclarés : ni constat, ni avertissement", () => {
    const { firewall, logs } = boot(input({ roles: ["ROLE_USER"] }));
    const zone = firewall.describe().zones.find((z) => z.name === "secure");
    assert.deepEqual(zone?.roles, ["ROLE_USER"]);
    assert.equal(zone?.openToSignup, false);
    assert.equal(zone?.openToSignupNotice, null);
    assert.equal(logs.filter((l) => /« secure »/u.test(l)).length, 0);
  });
});
