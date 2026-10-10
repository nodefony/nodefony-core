import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it } from "vitest";
import { assert } from "chai";
import { createAppContributionContext, runScaffold } from "nodefony";
import {
  APP_KEYCLOAK_REALM_FILE,
  APP_KEYCLOAK_THEME_DIR,
  APP_KEYCLOAK_THEMES_DIR,
  devClientSecret,
  keycloakThemeSource,
  keycloakThemesSource,
} from "../../nodefony/keycloak/scaffold";
import { contribute } from "../../nodefony/scaffold/contribute";

/**
 * La contribution de `@nodefony/security` à une application neuve : realm
 * d'import et thème Keycloak, posés APRÈS l'installation par le cœur, qui n'en
 * connaît rien (#520).
 *
 * Décor : une application générée par le VRAI moteur du cœur, puis la
 * contribution jouée sur la SOURCE du paquet — exactement ce que fait
 * `create app`, sans exiger un paquet bâti et installé.
 */

const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-sec-contrib-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** Une app générée par le cœur, sans contribution. */
const scaffoldApp = (
  name: string,
  preset: "complete" | "minimal" = "complete",
) => {
  counter += 1;
  const dest = path.join(tmp, `${name}-${String(counter)}`);
  runScaffold(
    {
      type: "app",
      answers:
        preset === "complete"
          ? { name, preset, frontend: "none" }
          : { name, preset },
      dir: dest,
      force: false,
    },
    "10.0.0-test",
  );
  return dest;
};
/** Une app `complete` neuve, contribution jouée. */
const scaffoldWithContribution = (name = "kcapp") => {
  const dest = scaffoldApp(name);
  const run = createAppContributionContext(dest);
  contribute(run.context);
  return { dest, ...run };
};
const dossierKeycloak = () => scaffoldWithContribution().dest;
const lire = (dest: string, ...rel: string[]) =>
  readFileSync(path.join(dest, ...rel), "utf8");

describe("contribution Keycloak de @nodefony/security", () => {
  it("pose le realm et TOUS les thèmes, en vrais fichiers, à l'endroit que le compose monte", () => {
    const { dest, written, kept } = scaffoldWithContribution();
    assert.include(written, APP_KEYCLOAK_REALM_FILE);
    assert.isEmpty(kept);
    const compose = lire(dest, "compose.yaml");
    // Le dossier ENTIER est monté : un thème d'habillage non monté ferait
    // retomber Keycloak sur son thème par défaut, avec un simple avertissement.
    assert.include(
      compose,
      `./${APP_KEYCLOAK_THEMES_DIR}:/opt/keycloak/themes:`,
    );
    assert.include(compose, "./docker/keycloak/import:");
    // Chaque fichier des thèmes livrés a sa copie, octet pour octet.
    const source = keycloakThemesSource();
    const files = written.filter((f) =>
      f.startsWith(`${APP_KEYCLOAK_THEMES_DIR}/`),
    );
    assert.isNotEmpty(files);
    for (const rel of files) {
      const inPackage = path.join(
        source,
        ...rel.slice(APP_KEYCLOAK_THEMES_DIR.length + 1).split("/"),
      );
      assert.isTrue(
        readFileSync(path.join(dest, ...rel.split("/"))).equals(
          readFileSync(inPackage),
        ),
        rel,
      );
    }
    assert.include(files, `${APP_KEYCLOAK_THEME_DIR}/login/theme.properties`);
    assert.include(
      files,
      `${APP_KEYCLOAK_THEMES_DIR}/nodefony-blueprint/login/theme.properties`,
    );
  });

  it("le realm déclare le thème livré, et seulement les types qu'il couvre", () => {
    const realm = JSON.parse(
      lire(dossierKeycloak(), ...APP_KEYCLOAK_REALM_FILE.split("/")),
    ) as Record<string, unknown>;
    const source = keycloakThemeSource();
    for (const type of ["login", "account", "email", "admin"]) {
      const key = `${type}Theme`;
      if (existsSync(path.join(source, type))) {
        assert.strictEqual(realm[key], "nodefony", key);
      } else {
        assert.notProperty(realm, key);
      }
    }
    assert.strictEqual(realm.loginTheme, "nodefony");
  });

  it("le thème livré couvre les CINQ types, et les deux consoles portent la même feuille", () => {
    const source = keycloakThemeSource();
    for (const type of ["login", "account", "email", "admin", "welcome"]) {
      assert.isTrue(
        existsSync(path.join(source, type, "theme.properties")),
        `type ${type} absent du thème livré`,
      );
    }
    // Keycloak ne sert à un type que SES ressources : la feuille des consoles
    // existe en deux exemplaires, qui ne doivent pas diverger.
    const sheet = (type: string) =>
      readFileSync(path.join(source, type, "resources", "css", "nodefony.css"));
    assert.isTrue(
      sheet("account").equals(sheet("admin")),
      "account/ et admin/ : nodefony.css divergent",
    );
    // La page d'accueil ne se choisit PAS par realm : c'est le serveur qui la
    // désigne, dans le compose de l'application.
    const compose = lire(dossierKeycloak(), "compose.yaml");
    assert.include(compose, "KC_SPI_THEME__WELCOME_THEME: nodefony");
    assert.include(compose, "KC_SPI_THEME__DEFAULT: nodefony");
  });

  it("ne remplace JAMAIS un fichier présent : une retouche de l'app survit à une nouvelle passe", () => {
    const { dest } = scaffoldWithContribution();
    const css = path.join(
      dest,
      ...APP_KEYCLOAK_THEME_DIR.split("/"),
      "login",
      "resources",
      "css",
      "nodefony.css",
    );
    writeFileSync(css, "/* aux couleurs de l'app */\n");
    const realmBefore = lire(dest, ...APP_KEYCLOAK_REALM_FILE.split("/"));
    const again = createAppContributionContext(dest);
    contribute(again.context);
    assert.isEmpty(again.written);
    assert.include(again.kept, APP_KEYCLOAK_REALM_FILE);
    assert.strictEqual(
      readFileSync(css, "utf8"),
      "/* aux couleurs de l'app */\n",
    );
    // Le realm garde ses `sub` : une régénération les aurait changés.
    assert.strictEqual(
      lire(dest, ...APP_KEYCLOAK_REALM_FILE.split("/")),
      realmBefore,
    );
  });

  it("en simulation, n'écrit rien mais annonce tout", () => {
    const dest = scaffoldApp("dry");
    const run = createAppContributionContext(dest, { dryRun: true });
    contribute(run.context);
    assert.include(run.written, APP_KEYCLOAK_REALM_FILE);
    assert.isFalse(existsSync(path.join(dest, "docker", "keycloak")));
  });

  it("une app qui ne monte pas de Keycloak ne reçoit rien", () => {
    const dest = scaffoldApp("kcmin", "minimal");
    const run = createAppContributionContext(dest);
    contribute(run.context);
    assert.isEmpty(run.written);
    assert.isFalse(existsSync(path.join(dest, "docker", "keycloak")));
  });

  it("le secret du realm est celui que le gabarit .env du cœur écrit", () => {
    // Deux paquets, une règle : la frontière empêche de l'appeler, ce test
    // compare donc les deux sorties.
    assert.include(
      lire(dossierKeycloak(), ".env"),
      `# NF_KEYCLOAK_CLIENT_SECRET=${devClientSecret("kcapp")}\n`,
    );
  });

  it("le realm importé est celui de CETTE app : nom, client, secret et retours alignés", () => {
    const dest = dossierKeycloak();
    const realm = JSON.parse(
      lire(dest, "docker", "keycloak", "import", "realm.json"),
    ) as {
      realm: string;
      clients: {
        clientId: string;
        secret: string;
        redirectUris: string[];
        attributes: Record<string, string>;
      }[];
      users: { id: string; username: string }[];
    };
    assert.strictEqual(realm.realm, "kcapp");
    const client = realm.clients.find((c) => c.clientId === "kcapp");
    assert.isDefined(client, "client navigateur `kcapp` absent du realm");
    assert.strictEqual(client?.clientId, "kcapp");
    // PKCE exigé côté serveur : le framework l'envoie, Keycloak le vérifie.
    assert.strictEqual(
      client?.attributes["pkce.code.challenge.method"],
      "S256",
    );
    // Le retour que la configuration générée calcule par défaut — exact match.
    assert.include(
      client?.redirectUris ?? [],
      "https://localhost:5152/nodefony/security/api/oauth2/keycloak/callback",
    );
    const security = lire(dest, "nodefony", "config", "security.ts");
    assert.include(security, "/nodefony/security/api/oauth2/keycloak/callback");
    assert.include(
      security,
      "https://localhost:${ctx.env.NF_PORT_HTTPS ?? 5152}",
    );
    // Le même secret aux deux bouts, sinon le premier login échoue.
    assert.include(
      lire(dest, ".env"),
      `# NF_KEYCLOAK_CLIENT_SECRET=${client.secret}\n`,
    );
    // L'`id` est FIXÉ dans le fichier : laissé à Keycloak, il change au
    // réimport, et la connexion suivante est refusée.
    assert.match(realm.users[0]?.id ?? "", /^[0-9a-f-]{36}$/u);
    // Les valeurs de `.env` désignent ce realm et ce client.
    const env = lire(dest, ".env");
    assert.include(
      env,
      "# NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/kcapp\n",
    );
    assert.include(env, "# NF_KEYCLOAK_CLIENT_ID=kcapp\n");
  });

  it("le realm généré a la MÊME forme que celui que le dépôt éprouve", () => {
    // Deux realms, UN constructeur (`buildKeycloakRealm`) : le banc Keycloak
    // réel joue celui du dépôt. Ce qu'il porte (client machine, PKCE, pas de
    // front-channel, canal arrière) existe dans celui de l'app. L'AUDIENCE,
    // elle, dérive des zones `external-jwt` (#520) : l'app née n'en a pas,
    // donc pas de mapper — `security:keycloak:realm --write` le pose quand la
    // zone arrive. Une audience écrite d'avance ne valait que si l'utilisateur
    // choisissait exactement cette ressource.
    type Client = {
      clientId: string;
      standardFlowEnabled?: boolean;
      serviceAccountsEnabled?: boolean;
      frontchannelLogout?: boolean;
      attributes?: Record<string, string>;
      protocolMappers?: { protocolMapper: string }[];
    };
    const forme = (clients: Client[]) =>
      clients
        .map((c) =>
          JSON.stringify({
            standard: c.standardFlowEnabled ?? false,
            service: c.serviceAccountsEnabled ?? false,
            frontchannel: c.frontchannelLogout ?? false,
            pkce: c.attributes?.["pkce.code.challenge.method"] ?? null,
            backchannel: c.attributes?.["backchannel.logout.url"] ?? null,
            backchannelSid:
              c.attributes?.["backchannel.logout.session.required"] ?? null,
            mappers: (c.protocolMappers ?? [])
              .map((m) => m.protocolMapper)
              .filter((m) => m !== "oidc-audience-mapper")
              .sort(),
          }),
        )
        .sort();
    const depot = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../docker/keycloak/import/realm-nodefony.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as { clients: Client[] };
    const genere = JSON.parse(
      lire(dossierKeycloak(), "docker", "keycloak", "import", "realm.json"),
    ) as { clients: Client[] };
    assert.deepEqual(forme(genere.clients), forme(depot.clients));
    for (const c of genere.clients) {
      assert.notInclude(
        (c.protocolMappers ?? []).map((m) => m.protocolMapper),
        "oidc-audience-mapper",
        `${c.clientId} : aucune zone external-jwt, donc aucune audience`,
      );
    }
    // Le front-channel exige une page que l'app n'a pas : back-channel seul.
    for (const c of [...depot.clients, ...genere.clients]) {
      assert.notStrictEqual(c.frontchannelLogout, true, c.clientId);
    }
    // Le client qui ouvre des sessions est prévenu de leur fin par Keycloak,
    // sur la route que le framework monte (#517).
    for (const c of [...depot.clients, ...genere.clients]) {
      if (c.standardFlowEnabled !== true) continue;
      assert.match(
        c.attributes?.["backchannel.logout.url"] ?? "",
        /\/nodefony\/security\/api\/oauth2\/keycloak\/backchannel-logout$/,
        c.clientId,
      );
    }
  });

  it("les deux realms portent le rôle client `admin` et `bob` qui le détient (#519)", () => {
    interface Realm {
      clients: { clientId: string }[];
      roles?: { client?: Record<string, { name: string }[]> };
      users: {
        id: string;
        username: string;
        clientRoles?: Record<string, string[]>;
      }[];
    }
    // Ce que le banc réel exige d'un realm : le client navigateur déclare
    // `admin`, `bob` le porte, `alice` non.
    const forme = (realm: Realm, client: string) => ({
      roles: (realm.roles?.client?.[client] ?? [])
        .map((r) => r.name)
        .filter((n) => n === "admin"),
      users: realm.users
        .filter((u) => u.username === "alice" || u.username === "bob")
        .map((u) => ({
          username: u.username,
          roles: u.clientRoles?.[client] ?? [],
        }))
        .sort((a, b) => a.username.localeCompare(b.username)),
    });
    const attendu = {
      roles: ["admin"],
      users: [
        { username: "alice", roles: [] },
        { username: "bob", roles: ["admin"] },
      ],
    };
    const depot = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../docker/keycloak/import/realm-nodefony.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as Realm;
    const dest = dossierKeycloak();
    const genere = JSON.parse(
      lire(dest, "docker", "keycloak", "import", "realm.json"),
    ) as Realm;
    assert.deepEqual(forme(depot, "nodefony-dev"), attendu);
    assert.deepEqual(forme(genere, "kcapp"), attendu);
    // Deux `sub` FIXÉS et distincts : un réimport ne doit relier aucun
    // compte local à une autre personne.
    const ids = genere.users.map((u) => u.id);
    for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/u);
    assert.strictEqual(new Set(ids).size, ids.length);
    // La table qui traduit `admin` est posée par la configuration générée.
    assert.include(
      lire(dest, "nodefony", "config", "security.ts"),
      'roleMapping: { admin: "ROLE_ADMIN" }',
    );
  });
});
