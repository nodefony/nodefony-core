import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import {
  KeycloakAdminClient,
  KeycloakAdminError,
  keycloakLoginThemeCheck,
  readKeycloakLoginTheme,
  type IKeycloakAdminClientOptions,
} from "../../nodefony/keycloak/keycloakAdmin";
import { KeycloakService } from "../../nodefony/service/keycloak";
import { KeycloakRealmError } from "../../nodefony/keycloak/keycloakRealmInput";

const ISSUER = "https://kc.test:8444/realms/demo";

interface ICall {
  method: string;
  url: string;
  body: string | null;
  authorization: string | null;
}

/** Un Keycloak simulé : jeton, lecture puis écriture du realm. */
function fakeKeycloak(options: {
  loginTheme?: string | null;
  tokenStatus?: number;
  realmStatus?: number;
  /** Nombre de réponses 401 rendues par l'API avant d'accepter. */
  expiredOnce?: boolean;
}): { fetch: typeof globalThis.fetch; calls: ICall[] } {
  const calls: ICall[] = [];
  let tokens = 0;
  let expired = options.expiredOnce === true;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url,
      body: typeof init?.body === "string" ? init.body : null,
      authorization: headers.get("authorization"),
    });
    if (url.endsWith("/realms/master/protocol/openid-connect/token")) {
      const status = options.tokenStatus ?? 200;
      tokens += 1;
      return new Response(
        status === 200
          ? JSON.stringify({ access_token: `jeton-${tokens}`, expires_in: 60 })
          : "{}",
        { status },
      );
    }
    if (expired) {
      expired = false;
      return new Response(null, { status: 401 });
    }
    if (method === "GET") {
      const status = options.realmStatus ?? 200;
      const realm =
        options.loginTheme === null || options.loginTheme === undefined
          ? { realm: "demo" }
          : { realm: "demo", loginTheme: options.loginTheme };
      return new Response(JSON.stringify(realm), { status });
    }
    return new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(
  over: Partial<IKeycloakAdminClientOptions> = {},
): KeycloakAdminClient {
  return new KeycloakAdminClient({
    issuer: ISSUER,
    admin: { username: "admin", password: "mdp" },
    environment: "development",
    ...over,
  });
}

const tokenCalls = (calls: ICall[]): number =>
  calls.filter((c) => c.url.endsWith("/openid-connect/token")).length;

describe("KeycloakAdminClient — les gardes, tenues au constructeur", () => {
  it("refuse hors développement, AVANT tout appel réseau", () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony" });
    for (const environment of ["production", "test", "staging"]) {
      assert.throws(
        () => client({ environment, fetch: kc.fetch }),
        (e: unknown) =>
          e instanceof KeycloakAdminError && e.message.includes(environment),
      );
    }
    assert.equal(kc.calls.length, 0);
  });

  it("refuse un émetteur en clair : le mot de passe ne part qu'en https", () => {
    assert.throws(
      () => client({ issuer: "http://kc.test/realms/demo" }),
      KeycloakAdminError,
    );
  });

  it("refuse un émetteur qui n'est pas un realm", () => {
    assert.throws(
      () => client({ issuer: "https://kc.test/oidc" }),
      KeycloakAdminError,
    );
  });
});

describe("KeycloakAdminClient — le jeton", () => {
  it("🔴 un jeton pour plusieurs appels, tant qu'il n'a pas expiré", async () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony" });
    const admin = client({ fetch: kc.fetch });
    await admin.getRealm();
    await admin.getRealm();
    await admin.applyLoginTheme("horizon");
    assert.equal(tokenCalls(kc.calls), 1);
    const token = kc.calls[0];
    assert.match(token?.body ?? "", /client_id=admin-cli/u);
    assert.match(token?.body ?? "", /grant_type=password/u);
  });

  it("un 401 de l'API renouvelle le jeton UNE fois, puis rejoue l'appel", async () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony", expiredOnce: true });
    const realm = await client({ fetch: kc.fetch }).getRealm();
    assert.equal(realm.loginTheme, "nodefony");
    assert.equal(tokenCalls(kc.calls), 2);
    const api = kc.calls.filter((c) => c.url.includes("/admin/realms/"));
    assert.deepEqual(
      api.map((c) => c.authorization),
      ["Bearer jeton-1", "Bearer jeton-2"],
    );
  });

  it("compte refusé → message qui nomme les variables, sans le mot de passe", async () => {
    const kc = fakeKeycloak({ tokenStatus: 401 });
    await assert.rejects(
      client({ fetch: kc.fetch }).getRealm(),
      (e: unknown) =>
        e instanceof KeycloakAdminError &&
        e.status === 401 &&
        e.message.includes("NF_KEYCLOAK_ADMIN_PASSWORD") &&
        !e.message.includes("mdp"),
    );
  });

  it("Keycloak injoignable → KeycloakAdminError, pas une TypeError nue", async () => {
    const fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    await assert.rejects(
      client({ fetch }).getRealm(),
      (e: unknown) =>
        e instanceof KeycloakAdminError && e.message.includes("injoignable"),
    );
  });

  it("realm absent → 404 nommé", async () => {
    const kc = fakeKeycloak({ realmStatus: 404 });
    await assert.rejects(
      client({ fetch: kc.fetch }).getRealm(),
      (e: unknown) =>
        e instanceof KeycloakAdminError && e.message.includes("introuvable"),
    );
  });
});

describe("KeycloakAdminClient.applyLoginTheme — thème d'un realm existant", () => {
  it("pose le thème de l'habillage par un PUT partiel (loginTheme seul)", async () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony" });
    const result = await client({ fetch: kc.fetch }).applyLoginTheme("horizon");
    assert.deepEqual(result, {
      realm: "demo",
      previous: "nodefony",
      theme: "nodefony-horizon",
      outcome: "applied",
    });
    const put = kc.calls.find((c) => c.method === "PUT");
    assert.equal(put?.url, "https://kc.test:8444/admin/realms/demo");
    assert.deepEqual(JSON.parse(put?.body ?? "null"), {
      loginTheme: "nodefony-horizon",
    });
  });

  it("habillage par défaut → thème parent `nodefony`", async () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony-console" });
    const result = await client({ fetch: kc.fetch }).applyLoginTheme(
      "frontispiece",
    );
    assert.equal(result.theme, "nodefony");
    assert.equal(result.outcome, "applied");
  });

  it("n'écrit rien quand le realm porte déjà le thème", async () => {
    const kc = fakeKeycloak({ loginTheme: "nodefony-horizon" });
    const result = await client({ fetch: kc.fetch }).applyLoginTheme("horizon");
    assert.equal(result.outcome, "unchanged");
    assert.equal(kc.calls.filter((c) => c.method === "PUT").length, 0);
  });

  it("ne touche JAMAIS un thème de l'application, ni un realm sans thème", async () => {
    for (const loginTheme of ["acme", null]) {
      const kc = fakeKeycloak({ loginTheme });
      const result = await client({ fetch: kc.fetch }).applyLoginTheme(
        "horizon",
      );
      assert.equal(result.outcome, "unmanaged");
      assert.equal(result.previous, loginTheme);
      assert.equal(kc.calls.filter((c) => c.method === "PUT").length, 0);
    }
  });
});

/** Le service, branché sur un conteneur minimal et un kernel donné. */
function service(
  options: unknown,
  environment: string,
  appPath = process.cwd(),
): KeycloakService {
  const container = new Container();
  container.set("kernel", {
    container,
    environment,
    path: appPath,
    options: { servers: { http: { port: 5151 }, https: { port: 5152 } } },
    once() {},
  });
  return new KeycloakService({
    container,
    notificationsCenter: false,
    options,
  } as unknown as Module);
}

const KEYCLOAK = {
  issuer: ISSUER,
  clientId: "app",
  clientSecret: "secret",
  redirectUri:
    "https://app.test/nodefony/security/api/oauth2/keycloak/callback",
};

const WITH_ADMIN = {
  oauth2: {
    providers: {
      keycloak: { ...KEYCLOAK, admin: { username: "a", password: "b" } },
    },
  },
};

describe("KeycloakService.admin — le client d'administration", () => {
  it("rend le client du fournisseur, et le GARDE (jeton réutilisé)", () => {
    const keycloak = service(WITH_ADMIN, "development");
    const first = keycloak.admin();
    assert.equal(first.realm, "demo");
    assert.equal(keycloak.admin("keycloak"), first);
  });

  it("sans compte d'administration → refus qui nomme les variables", () => {
    const keycloak = service(
      { oauth2: { providers: { keycloak: KEYCLOAK } } },
      "development",
    );
    assert.throws(
      () => keycloak.admin(),
      (e: unknown) =>
        e instanceof KeycloakAdminError &&
        e.message.includes("NF_KEYCLOAK_ADMIN_USERNAME"),
    );
  });

  it("fournisseur inconnu → refus nommé", () => {
    assert.throws(
      () => service({}, "development").admin("autre"),
      KeycloakAdminError,
    );
  });

  it("🔴 en production, refus — même compte posé", () => {
    assert.throws(
      () => service(WITH_ADMIN, "production").admin(),
      KeycloakAdminError,
    );
  });

  it("le thème attendu suit loginPage.skin, ou l'habillage d'un aperçu", () => {
    const keycloak = service(
      { ...WITH_ADMIN, loginPage: { skin: "ledger" } },
      "development",
    );
    assert.equal(keycloak.expectedLoginTheme(), "nodefony-ledger");
    assert.equal(keycloak.expectedLoginTheme("frontispiece"), "nodefony");
  });
});

describe("KeycloakService.realmPlan / writeRealm — le realm d'import", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nf-kc-realm-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("🔴 dérive, écrit, puis se dit à jour — et une seconde écriture ne fait rien", () => {
    const keycloak = service(WITH_ADMIN, "development", dir);
    const plan = keycloak.realmPlan();
    assert.equal(
      plan.file,
      path.join(dir, "docker", "keycloak", "import", "realm.json"),
    );
    assert.equal(plan.current, null);
    assert.equal(plan.upToDate, false);
    const realm = JSON.parse(plan.text) as { realm: string };
    assert.equal(realm.realm, "demo");
    assert.equal(keycloak.writeRealm(plan), true);
    assert.equal(readFileSync(plan.file, "utf8"), plan.text);
    const again = keycloak.realmPlan();
    assert.equal(again.upToDate, true);
    assert.equal(keycloak.writeRealm(again), false);
  });

  it("fusionne : ce qu'un humain a ajouté au fichier survit", () => {
    const keycloak = service(WITH_ADMIN, "development", dir);
    const file = path.join(dir, "fusion.json");
    writeFileSync(
      file,
      JSON.stringify({ realm: "demo", displayName: "Démo à la main" }),
    );
    const plan = keycloak.realmPlan({ file: "fusion.json" });
    assert.equal(plan.file, file);
    assert.equal(
      (JSON.parse(plan.text) as { displayName?: string }).displayName,
      "Démo à la main",
    );
  });

  it("un fichier qui n'est pas un realm → KeycloakRealmError nommant le fichier", () => {
    const keycloak = service(WITH_ADMIN, "development", dir);
    writeFileSync(path.join(dir, "liste.json"), "[]");
    assert.throws(
      () => keycloak.realmPlan({ file: "liste.json" }),
      (e: unknown) =>
        e instanceof KeycloakRealmError && e.message.includes("liste.json"),
    );
  });

  it("fournisseur absent → KeycloakRealmError", () => {
    assert.throws(
      () => service({}, "development", dir).realmPlan(),
      KeycloakRealmError,
    );
  });
});

const PAGE = (theme: string): string =>
  `<html><head><link href="/resources/x1y2z/login/${theme}/css/login.css" rel="stylesheet"></head></html>`;

describe("readKeycloakLoginTheme / keycloakLoginThemeCheck — le thème vu de la page", () => {
  it("lit le thème dans le chemin des ressources", () => {
    assert.equal(
      readKeycloakLoginTheme(PAGE("nodefony-dots")),
      "nodefony-dots",
    );
    assert.equal(readKeycloakLoginTheme("<html>Google</html>"), null);
  });

  it("écart → sonde en échec qui nomme les deux thèmes et le geste", () => {
    const check = keycloakLoginThemeCheck("horizon")(PAGE("nodefony"));
    assert.equal(check?.status, "failed");
    assert.equal(check?.kind, "login-theme-mismatch");
    assert.match(check?.message ?? "", /nodefony-horizon/u);
    assert.match(check?.message ?? "", /--apply/u);
  });

  it("accord → sonde verte", () => {
    const check = keycloakLoginThemeCheck("horizon")(PAGE("nodefony-horizon"));
    assert.equal(check?.status, "ok");
  });

  it("thème de l'application → jamais signalé", () => {
    const check = keycloakLoginThemeCheck("horizon")(PAGE("acme"));
    assert.equal(check?.status, "ok");
  });

  it("page qui n'est pas de Keycloak → aucune sonde", () => {
    assert.equal(keycloakLoginThemeCheck("horizon")("<html></html>"), null);
  });
});
