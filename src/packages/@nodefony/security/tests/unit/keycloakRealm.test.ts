import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  buildKeycloakRealm,
  keycloakDefaultRole,
  mergeKeycloakRealm,
  renderKeycloakRealm,
  type IKeycloakRealmInput,
  type TKeycloakJson,
  type TKeycloakObject,
} from "../../nodefony/src/oauth/keycloakRealm.js";

/**
 * Le realm Keycloak se CONSTRUIT depuis ce que dit la configuration, et la
 * régénération ne détruit rien de ce qu'un humain a écrit.
 *
 * Le décor de référence est le realm du dépôt, éprouvé par le banc Keycloak
 * réel : une régénération depuis la config de l'application de dev doit le
 * rendre À L'IDENTIQUE — sinon la commande réécrirait un realm qui marche.
 */

const repoRealmPath = fileURLToPath(
  new URL(
    "../../../../../../docker/keycloak/import/realm-nodefony.json",
    import.meta.url,
  ),
);

function readRepoRealm(): TKeycloakObject {
  return JSON.parse(readFileSync(repoRealmPath, "utf8")) as TKeycloakObject;
}

/** Ce que la configuration de l'application de dev dit du realm. */
const devInput: IKeycloakRealmInput = {
  realm: "nodefony",
  clientId: "nodefony-dev",
  clientSecret: "nodefony-dev-keycloak-secret",
  redirectUris: [
    "https://localhost:5152/nodefony/security/api/oauth2/keycloak/callback",
    "http://localhost:5151/nodefony/security/api/oauth2/keycloak/callback",
  ],
  postLogoutRedirectUris: [
    "https://localhost:5152/*",
    "http://localhost:5151/*",
  ],
  backchannelLogoutUrl:
    "http://host.docker.internal:5151/nodefony/security/api/oauth2/keycloak/backchannel-logout",
  audiences: ["https://localhost:5152/nodefony/test/keycloak"],
  clientRoles: [{ name: "admin" }, { name: "admin-nodefony" }],
  realmRoles: [],
  machine: { clientId: "nodefony-machine", secret: null },
  themes: { login: "nodefony" },
};

function client(realm: TKeycloakObject, clientId: string): TKeycloakObject {
  const clients = realm.clients as TKeycloakObject[];
  const found = clients.find((c) => c.clientId === clientId);
  assert.isDefined(found, `client ${clientId} absent`);
  return found as TKeycloakObject;
}

describe("realm Keycloak — construction depuis la configuration", () => {
  it("régénérer le realm du dépôt depuis la config de dev le laisse À L'IDENTIQUE", () => {
    const existing = readRepoRealm();
    const merged = mergeKeycloakRealm(existing, buildKeycloakRealm(devInput));
    assert.deepEqual(merged, existing);
    // Le texte aussi : l'ordre des clés est celui du fichier, donc la
    // régénération ne produit aucun diff.
    assert.equal(
      renderKeycloakRealm(merged),
      readFileSync(repoRealmPath, "utf8"),
    );
  });

  it("une audience changée dans la config REMPLACE le mapper, sans en ajouter un", () => {
    const existing = readRepoRealm();
    const merged = mergeKeycloakRealm(
      existing,
      buildKeycloakRealm({
        ...devInput,
        audiences: ["https://api.example.com"],
      }),
    );
    for (const id of ["nodefony-dev", "nodefony-machine"]) {
      const mappers = client(merged, id).protocolMappers as TKeycloakObject[];
      assert.lengthOf(mappers, 1);
      const config = mappers[0]?.config as TKeycloakObject;
      assert.equal(
        config["included.custom.audience"],
        "https://api.example.com",
      );
    }
  });

  it("aucune audience ⇒ aucun mapper d'audience, mais les autres mappers survivent", () => {
    const existing = readRepoRealm();
    const roles: TKeycloakObject = {
      name: "client-roles",
      protocol: "openid-connect",
      protocolMapper: "oidc-usermodel-client-role-mapper",
      config: {},
    };
    (client(existing, "nodefony-dev").protocolMappers as TKeycloakJson[]).push(
      roles,
    );
    const merged = mergeKeycloakRealm(
      existing,
      buildKeycloakRealm({ ...devInput, audiences: [] }),
    );
    assert.deepEqual(client(merged, "nodefony-dev").protocolMappers, [roles]);
    assert.deepEqual(client(merged, "nodefony-machine").protocolMappers, []);
  });

  it("deux audiences ⇒ deux mappers aux noms distincts", () => {
    const realm = buildKeycloakRealm({
      ...devInput,
      audiences: ["https://a.example", "https://b.example"],
    });
    const names = (
      client(realm, "nodefony-dev").protocolMappers as TKeycloakObject[]
    ).map((m) => m.name);
    assert.deepEqual(names, [
      "audience-nodefony-api",
      "audience-nodefony-api-2",
    ]);
  });

  it("ce qu'un humain a écrit survit : comptes, titre, textes, secret machine, rôles", () => {
    const existing = readRepoRealm();
    const merged = mergeKeycloakRealm(
      existing,
      buildKeycloakRealm({
        ...devInput,
        displayName: "autre titre",
        clientName: "autre nom",
        machine: { clientId: "nodefony-machine", secret: "autre-secret" },
        users: [],
      }),
    );
    assert.equal(merged.displayName, "Nodefony SSO");
    assert.equal(client(merged, "nodefony-dev").name, "Nodefony Studio (dev)");
    assert.equal(
      client(merged, "nodefony-machine").secret,
      "nodefony-machine-dev-secret",
    );
    assert.deepEqual(merged.users, existing.users);
    assert.deepEqual(merged.roles, existing.roles);
  });

  it("ce que la config DIT gagne : URL de retour et secret du client navigateur", () => {
    const existing = readRepoRealm();
    const merged = mergeKeycloakRealm(
      existing,
      buildKeycloakRealm({
        ...devInput,
        clientSecret: "secret-de-la-config",
        redirectUris: ["https://app.example/cb"],
      }),
    );
    const browser = client(merged, "nodefony-dev");
    assert.equal(browser.secret, "secret-de-la-config");
    assert.deepEqual(browser.redirectUris, ["https://app.example/cb"]);
  });

  it("un rôle neuf de roleMapping s'ajoute, les rôles déclarés restent", () => {
    const merged = mergeKeycloakRealm(
      readRepoRealm(),
      buildKeycloakRealm({
        ...devInput,
        clientRoles: [
          { name: "admin" },
          { name: "editor", description: "éditeur" },
        ],
      }),
    );
    const roles = (merged.roles as TKeycloakObject).client as TKeycloakObject;
    const names = (roles["nodefony-dev"] as TKeycloakObject[]).map(
      (r) => r.name,
    );
    assert.deepEqual(names, ["admin", "admin-nodefony", "editor"]);
  });

  it("un secret à `null` (production) n'écrit aucun secret", () => {
    const realm = buildKeycloakRealm({ ...devInput, clientSecret: null });
    assert.notProperty(client(realm, "nodefony-dev"), "secret");
  });

  it("refuse un realm existant qui n'est pas un objet", () => {
    assert.throws(
      () => mergeKeycloakRealm([], buildKeycloakRealm(devInput)),
      /n'est pas un objet JSON/,
    );
  });

  it("chaque compte importé porte le rôle par défaut du realm — sinon la console du compte rend 401", () => {
    // L'import n'accorde QUE les rôles listés : sans `default-roles-<realm>`,
    // le compte n'a ni `manage-account` ni `view-profile`.
    const built = buildKeycloakRealm({
      ...devInput,
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          username: "dora",
          email: "dora@nodefony.test",
          firstName: "Dora",
          lastName: "Test",
          password: "dora-dev",
        },
      ],
    });
    const role = keycloakDefaultRole("nodefony");
    assert.strictEqual(role, "default-roles-nodefony");
    for (const realm of [built, readRepoRealm()]) {
      const users = realm.users as TKeycloakObject[];
      assert.isAbove(users.length, 0);
      for (const user of users) {
        assert.include(
          user.realmRoles as string[],
          role,
          `${JSON.stringify(user.username)} sans ${role}`,
        );
      }
    }
  });
});
