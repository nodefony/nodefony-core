import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IAppContributionContext } from "nodefony";
import {
  buildKeycloakRealm,
  renderKeycloakRealm,
  type IKeycloakRealmInput,
} from "./keycloakRealm.js";

/**
 * Le décor Keycloak de développement que `@nodefony/security` livre à une
 * application : realm d'import et thème aux couleurs du framework.
 *
 * Appelé par le point de contribution du paquet (`scaffold/contribute.ts`,
 * déclaré dans son `package.json` sous `nodefony.contribute`), que le cœur
 * joue sans en rien connaître : `create app` après l'installation, puis
 * `nodefony scaffold:sync` à la demande. Un fichier déjà présent n'est jamais
 * remplacé — il appartient à l'application, qui a pu le retoucher.
 *
 * @module
 */

/** Le nom du paquet — sert à retrouver sa racine, en source comme en `dist`. */
const PACKAGE_NAME = "@nodefony/security";

/** Le nom du thème, tel que le realm le déclare et que Keycloak le monte. */
export const KEYCLOAK_THEME_NAME = "nodefony";

/** Où l'application reçoit le décor Keycloak (chemins qui voyagent : `/`). */
export const APP_KEYCLOAK_REALM_FILE = "docker/keycloak/import/realm.json";
export const APP_KEYCLOAK_THEMES_DIR = "docker/keycloak/themes";
export const APP_KEYCLOAK_THEME_DIR = `${APP_KEYCLOAK_THEMES_DIR}/${KEYCLOAK_THEME_NAME}`;

/** Les types de thème que le realm sait déclarer, et la clé qui les porte. */
const THEME_TYPES = ["login", "account", "email", "admin"] as const;
type TThemeType = (typeof THEME_TYPES)[number];

/**
 * La racine du paquet, trouvée en remontant depuis ce fichier : il vit à une
 * profondeur différente en source (`nodefony/scaffold/`) et une fois bâti
 * (`dist/nodefony/scaffold/`).
 *
 * @returns le dossier qui porte le `package.json` du paquet
 * @throws Si aucun ancêtre n'est le paquet (installation corrompue)
 */
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      const name = (
        JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }
      ).name;
      if (name === PACKAGE_NAME) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`racine du paquet ${PACKAGE_NAME} introuvable`);
    }
    dir = parent;
  }
}

/**
 * Le dossier du thème Keycloak livré par le paquet.
 *
 * @returns chemin natif absolu (`<paquet>/keycloak/themes/nodefony`)
 */
export function keycloakThemeSource(): string {
  return path.join(keycloakThemesSource(), KEYCLOAK_THEME_NAME);
}

/**
 * Le dossier de TOUS les thèmes Keycloak livrés : `nodefony` et ses thèmes
 * enfants `nodefony-<habillage>`, un par habillage de la page `/login`.
 * Keycloak les monte côte à côte (`/opt/keycloak/themes/`).
 *
 * @returns chemin natif absolu (`<paquet>/keycloak/themes`)
 */
export function keycloakThemesSource(): string {
  return path.join(packageRoot(), "keycloak", "themes");
}

/**
 * Les types que le thème livré couvre — un dossier par type. Le realm ne
 * déclare QUE ceux-là : déclarer un type absent ferait retomber Keycloak sur
 * son thème par défaut, avec un avertissement à chaque page.
 *
 * @param themeDir - dossier du thème
 * @returns les types présents, dans l'ordre de {@link THEME_TYPES}
 */
export function deliveredThemeTypes(themeDir: string): TThemeType[] {
  const present = new Set(readdirSync(themeDir));
  return THEME_TYPES.filter((type) => present.has(type));
}

/**
 * Le secret du client navigateur dans le décor de développement d'une app.
 *
 * ⚠️ Même règle que le gabarit `.env` du cœur (`keycloak.clientSecret` dans
 * `engine.ts`) : la frontière de paquets empêche de l'appeler, un test de ce
 * paquet compare donc les deux sorties.
 *
 * @param appName - nom de l'application
 * @returns le secret, PUBLIC par nature (écrit dans le realm versionné)
 */
export function devClientSecret(appName: string): string {
  return `${appName}-dev-keycloak-secret`;
}

/**
 * Ce que dit la configuration rendue par le gabarit `security.ts` d'une app
 * neuve : client `<app>`, URL de retour sur les deux ports de développement,
 * rôle client `admin` (`roleMapping: { admin: "ROLE_ADMIN" }`). AUCUNE
 * audience : l'app née n'a pas de zone `external-jwt` ; sa zone posée,
 * `security:keycloak:realm --write` ajoute le mapper.
 *
 * @param appName - nom de l'application (= realm = identifiant de client)
 * @param themes - types de thème à déclarer
 * @param ids - `sub` des comptes de démonstration, FIXÉS dans le fichier :
 *   laissés à Keycloak, ils changent à chaque réimport et la connexion
 *   suivante est refusée (identifiant déjà lié à un autre `sub`)
 * @returns l'entrée du constructeur de realm
 */
export function appDevRealmInput(
  appName: string,
  themes: readonly TThemeType[],
  ids: { readonly user: string; readonly admin: string },
): IKeycloakRealmInput {
  const callback = "/nodefony/security/api/oauth2/keycloak/callback";
  return {
    realm: appName,
    clientId: appName,
    clientSecret: devClientSecret(appName),
    clientName: `${appName} (dev)`,
    clientDescription:
      "Client confidentiel de l'application en développement — secret PUBLIC, jamais en production.",
    redirectUris: [
      `https://localhost:5152${callback}`,
      `http://localhost:5151${callback}`,
    ],
    postLogoutRedirectUris: [
      "https://localhost:5152/*",
      "http://localhost:5151/*",
    ],
    backchannelLogoutUrl:
      "http://host.docker.internal:5151/nodefony/security/api/oauth2/keycloak/backchannel-logout",
    audiences: [],
    clientRoles: [
      {
        name: "admin",
        description:
          "Administrateur de l'application — traduit en ROLE_ADMIN par la table roleMapping du fournisseur keycloak.",
      },
    ],
    realmRoles: [],
    machine: {
      clientId: `${appName}-machine`,
      secret: `${appName}-machine-dev-secret`,
      name: `${appName} — appelant machine (compte de service)`,
      description:
        "Appelant machine : obtient un jeton d'accès par client_credentials, sans utilisateur. Secret PUBLIC, jamais en production.",
    },
    themes: Object.fromEntries(
      themes.map((type) => [type, KEYCLOAK_THEME_NAME]),
    ),
    users: [
      {
        id: ids.user,
        username: "alice",
        email: `alice@${appName}.test`,
        firstName: "Alice",
        lastName: "Keycloak",
        password: "alice-dev",
      },
      {
        id: ids.admin,
        username: "bob",
        email: `bob@${appName}.test`,
        firstName: "Bob",
        lastName: "Keycloak",
        password: "bob-dev",
        clientRoles: ["admin"],
      },
    ],
  };
}

/**
 * L'application monte-t-elle un décor Keycloak ? Seul son compose le dit : on
 * ne pose que ce que quelqu'un lit — une application sans profil `keycloak`
 * (preset minimal, sécurité ajoutée plus tard) ne reçoit rien.
 *
 * @param context - contexte de contribution
 * @returns `true` si le compose monte `./docker/keycloak/…`
 */
function mountsKeycloak(context: IAppContributionContext): boolean {
  return ["compose.yaml", "compose.yml", "docker-compose.yml"].some(
    (file) => context.read(file)?.includes("./docker/keycloak/") === true,
  );
}

/**
 * Recopie les thèmes livrés dans l'application — `nodefony` et ses thèmes
 * d'habillage —, fichier par fichier, sans jamais remplacer un fichier présent.
 *
 * @param context - contexte de contribution
 */
export function copyKeycloakTheme(context: IAppContributionContext): void {
  context.copyTree(keycloakThemesSource(), APP_KEYCLOAK_THEMES_DIR);
}

/**
 * Pose le realm d'import et le thème Keycloak, si l'application monte un
 * décor Keycloak.
 *
 * @param context - contexte fourni par le cœur (`runAppContributions`)
 */
export function contributeKeycloak(context: IAppContributionContext): void {
  if (!mountsKeycloak(context)) return;
  const themes = deliveredThemeTypes(keycloakThemeSource());
  // Construit à chaque passe, posé seulement s'il manque : un realm présent
  // est celui de l'application (`security:keycloak:realm --write` le fait
  // évoluer depuis sa configuration), le contexte le garde et le rapporte.
  const realm = buildKeycloakRealm(
    appDevRealmInput(context.appName, themes, {
      user: randomUUID(),
      admin: randomUUID(),
    }),
  );
  context.write(APP_KEYCLOAK_REALM_FILE, renderKeycloakRealm(realm));
  copyKeycloakTheme(context);
}
