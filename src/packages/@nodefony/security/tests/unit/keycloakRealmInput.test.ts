import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildKeycloakRealm,
  mergeKeycloakRealm,
  renderKeycloakRealm,
  type TKeycloakObject,
} from "nodefony";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";
import type { ISecurityConfigInput } from "../../nodefony/config/config";
import {
  deriveKeycloakRealmInput,
  KeycloakRealmError,
  realmNameFromIssuer,
  type IKeycloakRealmContext,
} from "../../nodefony/src/oauth/keycloakRealmInput";

/**
 * Le realm Keycloak se DÉRIVE de la configuration de l'application (#520).
 *
 * Le décor de référence reproduit la configuration de l'application de dev
 * du dépôt (fournisseur `keycloak` + les deux zones external-jwt du module
 * test) : la dérivation, fusionnée dans `realm-nodefony.json`, doit le rendre
 * octet pour octet — c'est ce realm que le banc Keycloak réel éprouve.
 */

const repoRealmPath = fileURLToPath(
  new URL(
    "../../../../../../docker/keycloak/import/realm-nodefony.json",
    import.meta.url,
  ),
);

const CALLBACK = "/nodefony/security/api/oauth2/keycloak/callback";

function devConfig(
  provider: Partial<{
    audiences: string[];
    rolesSource: ("client" | "realm" | "groups")[];
  }> = {
    audiences: ["https://localhost:5152/nodefony/test/keycloak"],
  },
): ISecurityConfigInput {
  return {
    areas: {
      "test-foreign-audience": {
        pattern: "^/nodefony/test/foreign-audience",
        authenticators: ["external-jwt"],
        stateless: true,
        resource: "https://api.foreign.example/v1",
      },
      "test-keycloak": {
        pattern: "^/nodefony/test/keycloak",
        authenticators: ["external-jwt"],
        stateless: true,
        resource: "https://localhost:5152/nodefony/test/keycloak",
      },
    },
    oauth2: {
      providers: {
        keycloak: {
          issuer: "https://localhost:8444/realms/nodefony",
          clientId: "nodefony-dev",
          clientSecret: "nodefony-dev-keycloak-secret",
          redirectUri: `https://localhost:5152${CALLBACK}`,
          roleMapping: {
            admin: "ROLE_ADMIN",
            "admin-nodefony": "ROLE_NODEFONY_ADMIN",
          },
          allowPlatformRoles: true,
          ...provider,
        },
      },
    },
  };
}

function context(
  input: ISecurityConfigInput,
  over: Partial<IKeycloakRealmContext> = {},
): IKeycloakRealmContext {
  return {
    providerName: "keycloak",
    config: defineSecurityConfig(input),
    servers: { httpPort: 5151, httpsPort: 5152 },
    production: false,
    machine: { clientId: "nodefony-machine", secret: null },
    ...over,
  };
}

describe("realm Keycloak — dérivé de la configuration", () => {
  it("la config de l'app de dev, fusionnée dans le realm du dépôt, le rend OCTET POUR OCTET", () => {
    const raw = readFileSync(repoRealmPath, "utf8");
    const { input, warnings } = deriveKeycloakRealmInput(context(devConfig()));
    const merged = mergeKeycloakRealm(
      JSON.parse(raw) as TKeycloakObject,
      buildKeycloakRealm(input),
    );
    assert.equal(renderKeycloakRealm(merged), raw);
    assert.deepEqual(warnings, []);
  });

  it("sans `audiences`, TOUTES les zones external-jwt — et le risque est DIT", () => {
    const { input, warnings } = deriveKeycloakRealmInput(
      context(devConfig({})),
    );
    assert.deepEqual(input.audiences, [
      "https://api.foreign.example/v1",
      "https://localhost:5152/nodefony/test/keycloak",
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /oauth2\.providers\.keycloak\.audiences/);
  });

  it("une audience qu'aucune zone ne porte est signalée", () => {
    const { warnings } = deriveKeycloakRealmInput(
      context(devConfig({ audiences: ["https://nulle.part"] })),
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /aucune zone external-jwt/);
  });

  it("URL de retour : l'hôte de redirectUri sur CHAQUE serveur local, jamais l'adresse d'écoute", () => {
    const { input } = deriveKeycloakRealmInput(
      context(devConfig(), { servers: { httpPort: 6161, httpsPort: null } }),
    );
    assert.deepEqual(input.redirectUris, [
      `https://localhost:5152${CALLBACK}`,
      `http://localhost:6161${CALLBACK}`,
    ]);
    assert.equal(
      input.backchannelLogoutUrl,
      "http://host.docker.internal:6161/nodefony/security/api/oauth2/keycloak/backchannel-logout",
    );
  });

  it("production : aucun secret, aucune adresse locale, canal arrière sur l'origine publique", () => {
    const cfg = devConfig();
    const providers = (
      cfg.oauth2 as { providers: Record<string, { redirectUri: string }> }
    ).providers;
    (providers.keycloak as { redirectUri: string }).redirectUri =
      `https://app.example${CALLBACK}`;
    const { input } = deriveKeycloakRealmInput(
      context(cfg, { production: true }),
    );
    assert.equal(input.clientSecret, null);
    assert.deepEqual(input.redirectUris, [`https://app.example${CALLBACK}`]);
    assert.deepEqual(input.postLogoutRedirectUris, ["https://app.example/*"]);
    assert.equal(
      input.backchannelLogoutUrl,
      "https://app.example/nodefony/security/api/oauth2/keycloak/backchannel-logout",
    );
  });

  it("rolesSource range les rôles : client par défaut, realm si demandé", () => {
    const client = deriveKeycloakRealmInput(context(devConfig())).input;
    assert.deepEqual(
      client.clientRoles.map((r) => r.name),
      ["admin", "admin-nodefony"],
    );
    assert.deepEqual(client.realmRoles, []);
    const realm = deriveKeycloakRealmInput(
      context(devConfig({ rolesSource: ["realm"] })),
    ).input;
    assert.deepEqual(realm.clientRoles, []);
    assert.deepEqual(
      realm.realmRoles.map((r) => r.name),
      ["admin", "admin-nodefony"],
    );
  });

  it("refuse un fournisseur absent en nommant ceux qui existent", () => {
    assert.throws(
      () =>
        deriveKeycloakRealmInput(context(devConfig(), { providerName: "kc" })),
      (e: unknown) =>
        e instanceof KeycloakRealmError &&
        e.message.includes("déclarés : keycloak"),
    );
  });

  it("le nom du realm se lit dans l'émetteur, et un émetteur qui n'est pas un realm est refusé", () => {
    assert.equal(
      realmNameFromIssuer("https://kc.example/realms/mon%20app/"),
      "mon app",
    );
    assert.throws(
      () => realmNameFromIssuer("https://accounts.google.com"),
      KeycloakRealmError,
    );
    assert.throws(() => realmNameFromIssuer(undefined), KeycloakRealmError);
  });

  it("la clé `audiences` est validée par le schéma : une entrée vide est refusée", () => {
    assert.throws(() => defineSecurityConfig(devConfig({ audiences: [""] })));
  });
});
